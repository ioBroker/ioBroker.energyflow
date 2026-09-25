/**
 * Reading and writing the diagrams stored in the adapter's namespace.
 *
 * Shared by the admin tab, the vis-2 attribute and the device manager's settings -- all three talk to
 * the same objects through the same socket API, and a diagram saved in one of them has to look the
 * same in the others. See `storage.ts` in the core for what those objects are.
 */
import React from 'react';
import type { Connection } from '@iobroker/gui-components';

import {
    diagramFromNative,
    diagramNative,
    diagramPrefix,
    mediumOf,
    newDiagramId,
    type FlowConfig,
    type MediumId,
} from '@flow/core';

/**
 * The ioBroker convention for "the end of this key range" in an object view: U+9999 sorts after every
 * character an id can contain. Kept as an escape in a named constant, because the literal character is
 * a CJK ideograph and reads like a typo.
 */
export const RANGE_END = '\u9999';

export interface StoredDiagramInfo {
    /** Full object id */
    id: string;
    name: string;
    /** What it carries, read out of the document the object holds */
    medium: MediumId;
}

/** The display name of a stored diagram, whatever language shape `common.name` has */
function nameOf(object: ioBroker.Object | undefined, id: string): string {
    const name = object?.common?.name;
    if (typeof name === 'string') {
        return name;
    }
    if (name && typeof name === 'object') {
        return (name as Record<string, string>).en || Object.values(name)[0] || id;
    }
    return id.split('.').pop() || id;
}

/**
 * Every stored diagram of the instance, sorted by name.
 *
 * @param socket the connection
 * @param instance the adapter instance
 * @returns id and name of each
 */
/**
 * Every object of a type, as rows rather than as a map.
 *
 * The `config` view of the object database is `emit(doc.common.name, doc)`: its rows are keyed by the
 * display name, not by the id. The id range still selects the right objects -- that is what the
 * database filters on -- but the keys that come back are names, so two diagrams called the same would
 * land on the same key and the wrapper's map would keep only one of them. The rows are therefore read
 * as rows through the raw socket, which is what the wrapper does internally anyway, and the fallback
 * takes the values of the map rather than its keys.
 *
 * @param socket the connection
 * @param type the object type to list
 * @param start first id of the range
 * @param end last id of the range
 * @returns the objects
 */
async function viewOf(socket: Connection, type: 'config', start: string, end: string): Promise<ioBroker.AnyObject[]> {
    const raw = typeof socket.getRawSocket === 'function' ? socket.getRawSocket() : null;
    if (raw && typeof raw.emit === 'function') {
        return await new Promise((resolve, reject) => {
            raw.emit(
                'getObjectView',
                'system',
                type,
                { startkey: start, endkey: end },
                (error: unknown, result: { rows?: { value?: ioBroker.AnyObject }[] } | undefined) => {
                    if (error) {
                        reject(error instanceof Error ? error : new Error(JSON.stringify(error)));
                    } else {
                        resolve((result?.rows || []).map(row => row.value).filter(Boolean) as ioBroker.AnyObject[]);
                    }
                },
            );
        });
    }
    const mapped = await socket.getObjectView(start, end, type);
    return Object.values(mapped || {});
}

export async function listDiagrams(socket: Connection, instance = 0): Promise<StoredDiagramInfo[]> {
    const prefix = diagramPrefix(instance);
    // One call brings the documents with it: the diagram is the object, not a value beside it
    const objects = await viewOf(socket, 'config', prefix, `${prefix}${RANGE_END}`);
    return objects
        .filter(object => typeof object?._id === 'string' && object._id.startsWith(prefix))
        .map(object => ({
            id: object._id,
            name: nameOf(object as ioBroker.Object, object._id),
            medium: mediumOf(diagramFromNative(object.native) ?? undefined).id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load one stored diagram.
 *
 * @param socket the connection
 * @param id full object id
 * @returns the diagram, or null if the object is empty or missing
 */
export async function loadDiagram(socket: Connection, id: string): Promise<FlowConfig | null> {
    const object = (await socket.getObject(id)) as ioBroker.AnyObject | null | undefined;
    const config = diagramFromNative(object?.native);
    if (!config) {
        // Not a warning about the user's data but about ours: every diagram we write has one
        console.warn(`flow: ${id} holds no diagram (type ${object?.type ?? 'missing'})`);
    }
    return config;
}

/**
 * Write a diagram back into its object.
 *
 * The whole object is written rather than extended: `extendObject` merges `native` key by key, so a
 * node or a setting the user removed would survive the save and come back on the next load.
 *
 * @param socket the connection
 * @param id full object id
 * @param config the diagram
 */
export async function saveDiagram(socket: Connection, id: string, config: FlowConfig): Promise<void> {
    const object = (await socket.getObject(id)) as ioBroker.AnyObject | null | undefined;
    if (!object) {
        throw new Error(`${id} does not exist`);
    }
    await socket.setObject(id, { ...object, native: diagramNative(config) } as ioBroker.SettableObject);
}

/**
 * Create a new stored diagram.
 *
 * @param socket the connection
 * @param name display name
 * @param config its content
 * @param instance the adapter instance
 * @returns the full id it was stored under
 */
export async function createDiagram(
    socket: Connection,
    name: string,
    config: FlowConfig,
    instance = 0,
): Promise<string> {
    const existing = await listDiagrams(socket, instance);
    const id = newDiagramId(
        name,
        existing.map(entry => entry.id),
        instance,
    );

    await socket.setObject(id, {
        type: 'config',
        common: {
            name,
            desc: 'Flow diagram, edited in the admin tab "Flow"',
        },
        native: diagramNative(config),
    });
    return id;
}

/**
 * Rename a stored diagram. Only the display name changes: the id is what every widget refers to, so
 * changing it would break every view that uses the diagram.
 *
 * @param socket the connection
 * @param id full object id
 * @param name the new display name
 */
export async function renameDiagram(socket: Connection, id: string, name: string): Promise<void> {
    await socket.extendObject(id, { common: { name } });
}

/**
 * Delete a stored diagram. Widgets that refer to it show the "not configured" placeholder afterwards,
 * which is why the admin tab asks first.
 *
 * @param socket the connection
 * @param id full object id
 */
export async function deleteDiagram(socket: Connection, id: string): Promise<void> {
    await socket.delObject(id);
}

/**
 * The list of stored diagrams as React state, with a way to reload it after a change.
 *
 * @param socket the connection, or undefined while the host is still connecting
 * @param instance the adapter instance
 * @returns the list, whether it is still loading, and a reload function
 */
export function useStoredDiagrams(
    socket: Connection | undefined,
    instance = 0,
): { diagrams: StoredDiagramInfo[]; loading: boolean; reload: () => void } {
    const [diagrams, setDiagrams] = React.useState<StoredDiagramInfo[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [generation, setGeneration] = React.useState(0);

    React.useEffect(() => {
        if (!socket) {
            return undefined;
        }
        let cancelled = false;
        listDiagrams(socket, instance)
            .then(list => {
                if (!cancelled) {
                    setDiagrams(list);
                    setLoading(false);
                }
            })
            .catch((error: unknown) => {
                console.warn(`flow: cannot list diagrams: ${String(error)}`);
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [socket, instance, generation]);

    const reload = React.useCallback(() => setGeneration(value => value + 1), []);

    return { diagrams, loading, reload };
}
