/**
 * Reading and writing the diagrams stored in the adapter's namespace.
 *
 * Shared by the admin tab, the vis-2 attribute and the device manager's settings -- all three talk to
 * the same states through the same socket API, and a diagram saved in one of them has to look the same
 * in the others. See `storage.ts` in the core for why these are states.
 */
import React from 'react';
import type { Connection } from '@iobroker/gui-components';

import { diagramPrefix, newDiagramId, parseStoredDiagram, serializeDiagram, type FlowConfig } from '@flow/core';

/**
 * The ioBroker convention for "the end of this key range" in an object view: U+9999 sorts after every
 * character an id can contain. Kept as an escape in a named constant, because the literal character is
 * a CJK ideograph and reads like a typo.
 */
export const RANGE_END = '\u9999';

export interface StoredDiagramInfo {
    /** Full state id */
    id: string;
    name: string;
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
export async function listDiagrams(socket: Connection, instance = 0): Promise<StoredDiagramInfo[]> {
    const prefix = diagramPrefix(instance);
    const objects = await socket.getObjectView(prefix, `${prefix}${RANGE_END}`, 'state');
    return Object.entries(objects || {})
        .map(([id, object]) => ({ id, name: nameOf(object as ioBroker.Object, id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load one stored diagram.
 *
 * @param socket the connection
 * @param id full state id
 * @returns the diagram, or null if the state is empty or missing
 */
export async function loadDiagram(socket: Connection, id: string): Promise<FlowConfig | null> {
    const state = await socket.getState(id);
    return parseStoredDiagram(state?.val);
}

/**
 * Write a diagram back into its state.
 *
 * `ack: true` because there is no adapter process that would ever acknowledge it: the adapter is web
 * only, the value written *is* the configuration, and a listener that waits for the ack would wait
 * forever.
 *
 * @param socket the connection
 * @param id full state id
 * @param config the diagram
 */
export async function saveDiagram(socket: Connection, id: string, config: FlowConfig): Promise<void> {
    await socket.setState(id, { val: serializeDiagram(config), ack: true });
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
        type: 'state',
        common: {
            name,
            type: 'string',
            role: 'json',
            read: true,
            write: true,
            desc: 'Flow diagram, edited in the admin tab "Flow"',
        },
        native: {},
    });
    await saveDiagram(socket, id, config);
    return id;
}

/**
 * Rename a stored diagram. Only the display name changes: the id is what every widget refers to, so
 * changing it would break every view that uses the diagram.
 *
 * @param socket the connection
 * @param id full state id
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
 * @param id full state id
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
