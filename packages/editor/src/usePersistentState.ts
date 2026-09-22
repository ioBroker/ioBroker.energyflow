/**
 * React state that survives a reload, kept in `localStorage`.
 *
 * For layout only -- how wide a panel is, whether it is shown. That is a preference of the person at
 * this browser, not part of any diagram, so it belongs neither in the document nor in a state.
 *
 * Every access is guarded: `localStorage` throws in a private window with storage blocked, and a
 * layout preference that cannot be stored must not take the designer down with it.
 */
import React from 'react';

function read<T>(key: string, fallback: T): T {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        const parsed = JSON.parse(raw) as unknown;
        // A stored value of another shape -- from an older version, or edited by hand -- is ignored
        // rather than trusted, key by key for objects so one bad field does not lose the others
        if (fallback && typeof fallback === 'object' && parsed && typeof parsed === 'object') {
            const merged = { ...fallback } as Record<string, unknown>;
            for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
                if (field in merged && typeof value === typeof merged[field]) {
                    merged[field] = value;
                }
            }
            return merged as T;
        }
        return typeof parsed === typeof fallback ? (parsed as T) : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Like `useState`, but initialised from and written back to `localStorage`.
 *
 * @param key the storage key; prefix it, the storage is shared with the rest of the admin
 * @param fallback the value while nothing (usable) is stored
 * @returns the value and its setter
 */
export function usePersistentState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [value, setValue] = React.useState<T>(() => read(key, fallback));

    React.useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage blocked or full: the preference just does not survive the reload
        }
    }, [key, value]);

    return [value, setValue];
}

export default usePersistentState;
