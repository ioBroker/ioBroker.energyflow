/**
 * Turning ioBroker state values into the numbers the diagram draws.
 *
 * The core never talks to a socket. It asks a {@link ValueGetter} for a state id and gets a number
 * or `null` back, which is the whole reason the same renderer runs unchanged inside vis-2 (where the
 * values arrive in `this.state.values` keyed `<id>.val`) and inside the device manager (where they
 * come from a `StateContext` subscription).
 */
import {
    isSrcConst,
    isSrcExpr,
    isSrcSame,
    isSrcState,
    type EnergyFlowConfig,
    type Src,
    type SrcScaling,
} from './types';
import { evalExpr, type ExprValue } from './expr';

/** Reads the current value of a state. `null` means "unknown", not "zero". */
export type ValueGetter = (oid: string) => number | null;

/**
 * Coerce whatever an ioBroker state carries into a number.
 *
 * Booleans become 1/0 so that a "wallbox plugged in" flag can drive `if(plugged, power, 0)`.
 * A string is accepted when it parses cleanly -- some adapters deliver numbers as text -- but an
 * empty string is `null` rather than 0, because an empty string is a missing value, not a zero.
 *
 * @param raw the value as stored in the state
 * @returns the number, or null if there is none
 */
export function toNumber(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw === 'boolean') {
        return raw ? 1 : 0;
    }
    if (typeof raw === 'string') {
        // Accept a decimal comma -- a few adapters format their numbers for a German locale
        const parsed = Number(raw.trim().replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Build a {@link ValueGetter} over a flat record, which is the shape both hosts happen to keep.
 *
 * @param values the record of raw values
 * @param suffix appended to the state id before the lookup -- vis-2 stores `<id>.val`
 * @returns a getter over that record
 */
export function createValueGetter(values: Record<string, unknown>, suffix = ''): ValueGetter {
    return (oid: string): number | null => toNumber(values[`${oid}${suffix}`]);
}

/** Apply the rescaling of a source: factor, offset, sign, deadband, clamp -- in that order. */
function applyScaling(value: number, src: SrcScaling): number {
    let result = value;
    if (src.factor !== undefined) {
        result *= src.factor;
    }
    if (src.offset !== undefined) {
        result += src.offset;
    }
    if (src.invert) {
        result = -result;
    }
    // The deadband is checked after the scaling, so it is expressed in the unit the user sees
    if (src.deadband !== undefined && Math.abs(result) < src.deadband) {
        result = 0;
    }
    if (src.min !== undefined && result < src.min) {
        result = src.min;
    }
    if (src.max !== undefined && result > src.max) {
        result = src.max;
    }
    return result;
}

/**
 * Resolve a source to a number.
 *
 * @param src the source, or undefined
 * @param get reads a state
 * @param sameValue the node's value, for a source that refers to it (`SrcSame`); without it, such a
 *   source has no value
 * @returns the value, or null if it is unknown
 */
export function resolveSrc(src: Src | undefined, get: ValueGetter, sameValue?: () => number | null): number | null {
    if (!src) {
        return null;
    }

    if (isSrcSame(src)) {
        const base = sameValue ? sameValue() : null;
        return base === null ? null : applyScaling(base, src);
    }

    if (isSrcConst(src)) {
        return src.const;
    }

    if (isSrcState(src)) {
        if (!src.oid) {
            return null;
        }
        const raw = get(src.oid);
        return raw === null ? null : applyScaling(raw, src);
    }

    if (isSrcExpr(src)) {
        const vars: Record<string, ExprValue> = {};
        for (const [name, inner] of Object.entries(src.vars || {})) {
            vars[name] = resolveSrc(inner, get, sameValue);
        }
        return evalExpr(src.expr, vars);
    }

    return null;
}

/** Walk a source tree and hand every state id to the callback */
function walkSrc(src: Src | undefined, visit: (oid: string) => void): void {
    if (!src) {
        return;
    }
    if (isSrcState(src)) {
        if (src.oid) {
            visit(src.oid);
        }
        return;
    }
    if (isSrcExpr(src)) {
        for (const inner of Object.values(src.vars || {})) {
            walkSrc(inner, visit);
        }
    }
}

/**
 * The states a source reads -- one for a plain state, all of them for a formula.
 *
 * @param src the source
 * @returns their ids, without duplicates
 */
export function srcOids(src: Src | undefined): string[] {
    const ids = new Set<string>();
    walkSrc(src, id => ids.add(id));
    return [...ids];
}

/** When a state was last written (`ts`) and last changed its value (`lc`), in ms since the epoch */
export interface StateTimes {
    ts?: number;
    lc?: number;
}

/** The times of a state, or undefined while none have arrived */
export type TimeGetter = (oid: string) => StateTimes | undefined;

/**
 * Every state id the diagram reads, without duplicates.
 *
 * Both hosts need exactly this list and nothing else: vis-2 declares it so the base class subscribes
 * for us, the device manager subscribes by hand. Deriving it from the document instead of from a
 * fixed set of attribute names is what lets a diagram have any number of producers -- the
 * predecessor is capped at the slots its attribute list happens to define.
 *
 * @param config the diagram
 * @returns the state ids, in a stable order
 */
export function collectOids(config: EnergyFlowConfig | undefined): string[] {
    const ids = new Set<string>();
    if (!config) {
        return [];
    }

    for (const node of config.nodes || []) {
        walkSrc(node.value, id => ids.add(id));
        walkSrc(node.soc, id => ids.add(id));
        for (const badge of node.badges || []) {
            walkSrc(badge.src, id => ids.add(id));
        }
        // A click action that writes or charts a state has to be subscribed too: `toggle` needs the
        // current value to know what to write, and `chart` needs the id to be resolvable
        if (node.action?.oid && (node.action.type === 'toggle' || node.action.type === 'chart')) {
            ids.add(node.action.oid);
        }
    }

    for (const edge of config.edges || []) {
        walkSrc(edge.value, id => ids.add(id));
        walkSrc(edge.reverse, id => ids.add(id));
    }

    return [...ids];
}
