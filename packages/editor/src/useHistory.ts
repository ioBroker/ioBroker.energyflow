/**
 * The recorded past of the states a diagram charts -- see `history.ts` in the core.
 */
import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import {
    cachedEnergyToday,
    cachedHistory,
    energyRequests,
    historyRequests,
    loadEnergyToday,
    loadHistory,
    type EnergyFlowConfig,
    type HistoryGetter,
    type HistoryPoint,
    type HistoryReadOptions,
    type HistoryRequest,
} from '@energyflow/core';

/** How often the charts are checked for staleness; `loadHistory` decides what is actually read */
const CHECK_MS = 60000;

/**
 * The default history adapter of the installation, e.g. `history.0`.
 *
 * @param socket the connection
 * @returns the instance, null when none is configured, undefined while asking
 */
export function useDefaultHistory(socket: Connection | undefined): string | null | undefined {
    const [instance, setInstance] = React.useState<string | null | undefined>(undefined);
    React.useEffect(() => {
        if (!socket) {
            return undefined;
        }
        let cancelled = false;
        socket
            .getSystemConfig()
            .then(config => !cancelled && setInstance(config?.common?.defaultHistory || null))
            .catch(() => !cancelled && setInstance(null));
        return () => {
            cancelled = true;
        };
    }, [socket]);
    return instance;
}

/**
 * Read the histories a diagram needs and keep them fresh.
 *
 * @param socket the connection
 * @param config the diagram
 * @param instance the history adapter to read from
 * @returns a getter over what has arrived
 */
export function useHistory(
    socket: Connection | undefined,
    config: EnergyFlowConfig,
    instance: string | null | undefined,
): HistoryGetter {
    const [known, setKnown] = React.useState<Record<string, HistoryPoint[]>>({});
    const key = JSON.stringify(historyRequests(config));

    React.useEffect(() => {
        const requests = JSON.parse(key) as HistoryRequest[];
        if (!socket || !instance || !requests.length) {
            return undefined;
        }
        let cancelled = false;
        const read = (oid: string, options: HistoryReadOptions): Promise<unknown> =>
            socket.getHistory(oid, { instance, aggregate: 'average', ignoreNull: true, ...options });
        const run = (): void => {
            loadHistory(requests, read)
                .then(() => {
                    if (!cancelled) {
                        const snapshot: Record<string, HistoryPoint[]> = {};
                        for (const { oid, period } of requests) {
                            snapshot[`${oid}|${period}`] = cachedHistory(oid, period) ?? [];
                        }
                        setKnown(snapshot);
                    }
                })
                .catch(() => undefined);
        };
        run();
        const interval = setInterval(run, CHECK_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [socket, instance, key]);

    return React.useCallback((oid, period) => known[`${oid}|${period}`], [known]);
}

/**
 * Today's energy of the states whose nodes show it, integrated by the history adapter since midnight.
 *
 * @param socket the connection
 * @param config the diagram
 * @param instance the history adapter to read from
 * @returns a getter over what has arrived, in the state's unit times hours
 */
export function useEnergyToday(
    socket: Connection | undefined,
    config: EnergyFlowConfig,
    instance: string | null | undefined,
): (oid: string) => number | undefined {
    const [known, setKnown] = React.useState<Record<string, number | undefined>>({});
    const key = JSON.stringify(energyRequests(config));

    React.useEffect(() => {
        const oids = JSON.parse(key) as string[];
        if (!socket || !instance || !oids.length) {
            return undefined;
        }
        let cancelled = false;
        const read = (oid: string, options: HistoryReadOptions): Promise<unknown> =>
            socket.getHistory(oid, { instance, ignoreNull: true, ...options });
        const run = (): void => {
            loadEnergyToday(oids, read)
                .then(() => {
                    if (!cancelled) {
                        setKnown(Object.fromEntries(oids.map(oid => [oid, cachedEnergyToday(oid)])));
                    }
                })
                .catch(() => undefined);
        };
        run();
        const interval = setInterval(run, CHECK_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [socket, instance, key]);

    return React.useCallback((oid: string) => known[oid], [known]);
}

/**
 * Whether a state is recorded by a history adapter, so the inspector can say why a chart stays empty.
 *
 * @param socket the connection
 * @param oid the state
 * @param instance the history adapter
 * @returns true or false once known, undefined while asking
 */
export function useIsRecorded(
    socket: Connection | undefined,
    oid: string | undefined,
    instance: string | null | undefined,
): boolean | undefined {
    const [recorded, setRecorded] = React.useState<{ key: string; value: boolean } | null>(null);
    const key = `${oid}|${instance}`;
    React.useEffect(() => {
        if (!socket || !oid || !instance) {
            return undefined;
        }
        let cancelled = false;
        socket
            .getObject(oid)
            .then(object => {
                const custom = (object?.common as { custom?: Record<string, { enabled?: boolean }> } | undefined)
                    ?.custom;
                if (!cancelled) {
                    setRecorded({ key: `${oid}|${instance}`, value: !!custom?.[instance]?.enabled });
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [socket, oid, instance]);
    return recorded && recorded.key === key ? recorded.value : undefined;
}
