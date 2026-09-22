/**
 * What a node looks like depending on its value: rules, a colour scale, and the key figures of an
 * installation.
 *
 * All pure: the runtime hands in numbers and texts and gets colours, icons and percentages back.
 */
import type { NodeRule } from './types';

/**
 * A raw state value as text: strings as they are, numbers and booleans written out, anything else
 * (an object some adapter put into a state) as JSON rather than "[object Object]".
 *
 * @param value the raw value
 * @returns the text
 */
export function rawText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return value.toString();
    }
    return JSON.stringify(value) ?? '';
}

/**
 * Whether a rule applies to a value.
 *
 * Numbers compare as numbers. Anything else -- a status text, `true` -- only compares for equality,
 * as text: "Charging" == "Charging", and `true` == "true".
 *
 * @param rule the rule
 * @param value the node's value: the number it shows, or the raw state value of a text node
 * @returns true when it matches
 */
export function ruleMatches(rule: NodeRule, value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    const target = rule.value;
    const numeric =
        typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    const limit =
        typeof target === 'number' ? target : typeof target === 'string' && target.trim() !== '' ? Number(target) : NaN;

    if (Number.isFinite(numeric) && Number.isFinite(limit)) {
        switch (rule.op) {
            case '<':
                return numeric < limit;
            case '<=':
                return numeric <= limit;
            case '>':
                return numeric > limit;
            case '>=':
                return numeric >= limit;
            case '==':
                return numeric === limit;
            case '!=':
                return numeric !== limit;
            default:
                return false;
        }
    }
    if (rule.op === '==') {
        return rawText(value) === String(target);
    }
    if (rule.op === '!=') {
        return rawText(value) !== String(target);
    }
    return false;
}

/**
 * The first rule that applies, in the order they are listed -- so the most specific goes first, as
 * in "below 10 % red, below 30 % orange".
 *
 * @param rules the node's rules
 * @param value what they are checked against
 * @returns the rule, or undefined
 */
export function firstMatchingRule(rules: NodeRule[] | undefined, value: unknown): NodeRule | undefined {
    return (rules || []).find(rule => ruleMatches(rule, value));
}

/**
 * A colour between green (at `min`) and red (at `max`), through yellow -- the scale everybody reads a
 * price or a load by.
 *
 * @param value the value
 * @param min where it is green
 * @param max where it is red; may be below `min` for a scale that runs the other way
 * @returns an `hsl()` colour, or undefined for an unknown value or an empty range
 */
export function scaleColor(value: number | null, min: number, max: number): string | undefined {
    if (value === null || !Number.isFinite(value) || min === max) {
        return undefined;
    }
    const position = Math.min(Math.max((value - min) / (max - min), 0), 1);
    const hue = Math.round(120 * (1 - position));
    return `hsl(${hue}, 72%, 46%)`;
}

/** The power balance the key figures are computed from, in the base unit (watts) */
export interface PowerBalance {
    /** Everything produced: the producers nothing else feeds into */
    production: number;
    /** The grid: positive is drawn from it, negative is fed in */
    grid: number;
    /** The storage: positive is discharged, negative is charged */
    storage: number;
}

/**
 * Autarky: the share of the consumption that did not come from the grid.
 *
 * @param balance the power balance
 * @returns percent, or null while there is no consumption to speak of
 */
export function autarky(balance: PowerBalance): number | null {
    const consumption = balance.production + balance.grid + balance.storage;
    if (consumption <= 0) {
        return null;
    }
    return Math.min(Math.max((1 - Math.max(balance.grid, 0) / consumption) * 100, 0), 100);
}

/**
 * Self-consumption: the share of the production that was not fed into the grid.
 *
 * @param balance the power balance
 * @returns percent, or null while nothing is produced
 */
export function selfConsumption(balance: PowerBalance): number | null {
    if (balance.production <= 0) {
        return null;
    }
    return Math.min(Math.max((1 - Math.max(-balance.grid, 0) / balance.production) * 100, 0), 100);
}
