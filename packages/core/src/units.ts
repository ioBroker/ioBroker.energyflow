/**
 * Units and ranges from the state objects.
 *
 * Every ioBroker state object can say what its number is in (`common.unit`), and that is the one
 * source that is right by construction: a battery adapter reporting kW and an inverter reporting W sit
 * side by side in most installations. So a value takes its unit from the object unless the diagram
 * says otherwise -- explicitly on the node or connection, which always wins. The diagram's default
 * unit is only the fallback for objects without one.
 *
 * The same read also brings `common.max`, which is what a node fills against when the diagram does
 * not say otherwise -- an inverter that declares 1400 W needs no maximum typed in a second time.
 *
 * The objects are read by the host, which has the socket; this module only caches what it is given.
 * The cache is module state on purpose: a view with ten widgets reading the same meter asks once.
 */
import { isSrcExpr, isSrcState, type Src } from './types';

/** The unit of a state, or undefined when its object has none or has not been read yet */
export type UnitGetter = (oid: string) => string | undefined;

/** The declared upper end of a state's range (`common.max`), in the state's own unit */
export type MaxGetter = (oid: string) => number | undefined;

/**
 * Reads one object; `socket.getObject` of either host fits. Typed loosely on purpose: the object types
 * of the two hosts differ, and all this looks at is `common.unit` and `common.max`.
 */
export type ObjectReader = (id: string) => Promise<unknown>;

/** Unit per state id; an empty string means the object was read and has no unit */
const known = new Map<string, string>();
/** `common.max` per state id, for those that declare a usable one */
const knownMax = new Map<string, number>();
const reading = new Map<string, Promise<void>>();

/**
 * Read the units of states that are not known yet.
 *
 * A failed read is not remembered, so the next call tries again; an object that does not exist is
 * remembered as "no unit".
 *
 * @param ids the states
 * @param read how to get an object
 * @returns resolves once every one of them is known or has failed
 */
export async function loadUnits(ids: string[], read: ObjectReader): Promise<void> {
    await Promise.all(
        ids
            .filter(id => id && !known.has(id))
            .map(id => {
                let pending = reading.get(id);
                if (!pending) {
                    pending = read(id)
                        .then(
                            object => {
                                const common = (
                                    object as { common?: { unit?: unknown; max?: unknown } } | null | undefined
                                )?.common;
                                known.set(id, typeof common?.unit === 'string' ? common.unit.trim() : '');
                                if (typeof common?.max === 'number' && Number.isFinite(common.max)) {
                                    knownMax.set(id, common.max);
                                } else {
                                    knownMax.delete(id);
                                }
                            },
                            () => undefined,
                        )
                        .finally(() => reading.delete(id));
                    reading.set(id, pending);
                }
                return pending;
            }),
    );
}

/** The cached unit of a state, see {@link loadUnits} */
export const cachedUnit: UnitGetter = oid => known.get(oid) || undefined;

/** The cached maximum of a state, see {@link loadUnits} */
export const cachedMax: MaxGetter = oid => knownMax.get(oid);

/**
 * The unit a source delivers its number in, as far as the objects tell.
 *
 * - A state: its object's unit -- unless a `factor` rescales it, because then the object's unit
 *   no longer describes the number (0.001 turns W into kW, but 2 turns it into nothing nameable).
 * - A formula: the unit its states share, as long as it only adds and subtracts. `a * b` of two
 *   powers is not a power, and a guess would be worse than the diagram's default.
 * - A constant: none.
 *
 * @param src the source
 * @param units the units of the states
 * @returns the unit, or undefined when it cannot be told
 */
export function sourceUnit(src: Src | undefined, units: UnitGetter | undefined): string | undefined {
    if (!src || !units) {
        return undefined;
    }
    if (isSrcState(src)) {
        if (!src.oid || (src.factor !== undefined && src.factor !== 1)) {
            return undefined;
        }
        return units(src.oid);
    }
    if (isSrcExpr(src)) {
        if (/[*/^%]/.test(src.expr)) {
            return undefined;
        }
        const found = Object.values(src.vars || {}).map(variable => sourceUnit(variable, units));
        if (!found.length || found.some(unit => !unit || unit !== found[0])) {
            return undefined;
        }
        return found[0];
    }
    return undefined;
}

/**
 * The upper end of a source's range, as its state object declares it.
 *
 * Only a plain state has one: a factor or an offset makes the number something the object's range no
 * longer describes, and a formula over several states has no single range at all.
 *
 * @param src the source
 * @param maxima the declared maxima of the states
 * @returns the maximum in the state's own unit, or undefined
 */
export function sourceMax(src: Src | undefined, maxima: MaxGetter | undefined): number | undefined {
    if (!src || !maxima || !isSrcState(src) || !src.oid) {
        return undefined;
    }
    if ((src.factor !== undefined && src.factor !== 1) || src.offset) {
        return undefined;
    }
    const max = maxima(src.oid);
    return max !== undefined && max > 0 ? max : undefined;
}
