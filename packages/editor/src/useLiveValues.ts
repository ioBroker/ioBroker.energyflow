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

import { toNumber, type StateTimes, type TimeGetter, type ValueGetter } from '@flow/core';

/** How often "12 minutes ago" is recomputed while a diagram shows one */
const CLOCK_MS = 30000;

interface LiveState {
    value: number | null;
    times: StateTimes;
    /** The value as the state holds it -- for a status text */
    raw: unknown;
}

/**
 * Subscribe to a set of states and return getters over their current values and times.
 *
 * The getters change identity whenever a state changes, which is what makes the memoised runtime in
 * the canvas recompute. Changes are collected in a ref first and flushed on a short timer, so a burst
 * of state changes -- which is normal for a PV setup at midday -- costs one re-render, not twenty.
 *
 * @param socket the connection, or undefined while the host is still connecting
 * @param oids the states to watch
 * @returns getters for the current values and for when each state was written and changed
 */
export function useLiveStates(
    socket: Connection | undefined,
    oids: string[],
): { values: ValueGetter; times: TimeGetter; raw: (oid: string) => unknown } {
    const [states, setStates] = React.useState<Record<string, LiveState>>({});
    const pending = React.useRef<Record<string, LiveState>>({});
    const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // The identity of the array changes on every render, so subscribing must depend on its content
    const key = JSON.stringify([...new Set(oids.filter(Boolean))].sort());

    React.useEffect(() => {
        const ids = JSON.parse(key) as string[];
        if (!socket || !ids.length) {
            return undefined;
        }

        let cancelled = false;

        const onChange = (id: string, state: ioBroker.State | null | undefined): void => {
            if (cancelled) {
                return;
            }
            pending.current[id] = {
                value: state ? toNumber(state.val) : null,
                times: { ts: state?.ts, lc: state?.lc },
                raw: state?.val,
            };
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
                setStates(previous => ({ ...previous, ...batch }));
            }, 120);
        };

        socket.subscribeState(ids, onChange).catch(error => console.warn(`flow: cannot subscribe: ${String(error)}`));

        return () => {
            cancelled = true;
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
            socket.unsubscribeState(ids, onChange);
        };
    }, [socket, key]);

    const values = React.useCallback((oid: string) => states[oid]?.value ?? null, [states]);
    const times = React.useCallback((oid: string) => states[oid]?.times, [states]);
    const raw = React.useCallback((oid: string) => states[oid]?.raw, [states]);
    return { values, times, raw };
}

/**
 * Subscribe to a set of states and return a getter over their current values.
 *
 * @param socket the connection, or undefined while the host is still connecting
 * @param oids the states to watch
 * @returns a getter for the current values
 */
export function useLiveValues(socket: Connection | undefined, oids: string[]): ValueGetter {
    return useLiveStates(socket, oids).values;
}

/**
 * The present, advanced every half minute while `enabled` -- so "12 minutes ago" becomes "13 minutes
 * ago" without the state changing.
 *
 * @param enabled whether anything shows a relative time
 * @returns ms since the epoch
 */
export function useClock(enabled: boolean): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        // At once as well: switched on by a setting, the clock would otherwise stand at the moment the
        // designer opened until the first tick, and nothing could be "older than a minute" before that
        const first = setTimeout(() => setNow(Date.now()), 0);
        const interval = setInterval(() => setNow(Date.now()), CLOCK_MS);
        return () => {
            clearTimeout(first);
            clearInterval(interval);
        };
    }, [enabled]);
    return now;
}

export default useLiveValues;
