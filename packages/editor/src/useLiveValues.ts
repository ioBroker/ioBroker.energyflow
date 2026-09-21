/**
 * Live state values for the designer's preview.
 *
 * The designer shows the real diagram with the real numbers while it is being built. That is worth a
 * subscription of its own: seeing "8.7 kW" appear the moment the right state is picked is how a user
 * finds out they picked the wrong one, and it is the difference between configuring a diagram and
 * guessing at one.
 */
import React from 'react';
import type { Connection } from '@iobroker/gui-components';

import { toNumber, type ValueGetter } from '@energyflow/core';

/**
 * Subscribe to a set of states and return a getter over their current values.
 *
 * The getter identity changes whenever a value changes, which is what makes the memoised runtime in
 * the canvas recompute. Values are collected in a ref first and flushed on a short timer, so a burst
 * of state changes -- which is normal for a PV setup at midday -- costs one re-render, not twenty.
 *
 * @param socket the connection, or undefined while the host is still connecting
 * @param oids the states to watch
 * @returns a getter for the current values
 */
export function useLiveValues(socket: Connection | undefined, oids: string[]): ValueGetter {
    const [values, setValues] = React.useState<Record<string, number | null>>({});
    const pending = React.useRef<Record<string, number | null>>({});
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // The identity of the array changes on every render, so subscribing must depend on its content
    const key = oids.filter(Boolean).sort().join('\u0000');

    React.useEffect(() => {
        const ids = key ? key.split('\u0000') : [];
        if (!socket || !ids.length) {
            return undefined;
        }

        let cancelled = false;

        const onChange = (id: string, state: ioBroker.State | null | undefined): void => {
            if (cancelled) {
                return;
            }
            pending.current[id] = state ? toNumber(state.val) : null;
            if (timer.current) {
                return;
            }
            timer.current = setTimeout(() => {
                timer.current = null;
                if (cancelled) {
                    return;
                }
                const batch = pending.current;
                pending.current = {};
                setValues(previous => ({ ...previous, ...batch }));
            }, 120);
        };

        socket
            .subscribeState(ids, onChange)
            .catch(error => console.warn(`energyflow: cannot subscribe: ${String(error)}`));

        return () => {
            cancelled = true;
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
            socket.unsubscribeState(ids, onChange);
        };
    }, [socket, key]);

    return React.useCallback((oid: string) => (oid in values ? values[oid] : null), [values]);
}

export default useLiveValues;
