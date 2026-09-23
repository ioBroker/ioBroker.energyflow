/**
 * The units of the states a diagram reads, from their objects -- see `units.ts` in the core.
 *
 * The getter changes identity once new units have arrived, so memoised runtimes recompute.
 */
import React from 'react';

import type { Connection } from '@iobroker/gui-components';

import { cachedUnit, loadUnits, type UnitGetter } from '@flow/core';

export function useObjectUnits(socket: Connection | undefined, oids: string[]): UnitGetter {
    const [units, setUnits] = React.useState<Record<string, string>>({});

    // The identity of the array changes on every render, so loading must depend on its content
    const key = JSON.stringify([...new Set(oids.filter(Boolean))].sort());

    React.useEffect(() => {
        const ids = JSON.parse(key) as string[];
        if (!socket || !ids.length) {
            return undefined;
        }
        let cancelled = false;
        loadUnits(ids, id => socket.getObject(id))
            .then(() => {
                if (!cancelled) {
                    setUnits(Object.fromEntries(ids.map(id => [id, cachedUnit(id) ?? ''])));
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [socket, key]);

    return React.useCallback((oid: string) => units[oid] || cachedUnit(oid), [units]);
}
