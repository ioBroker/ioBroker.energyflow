/**
 * The text of a caption, with what it says filled in from states.
 *
 * A caption is otherwise a fixed string, which stops being enough the moment somebody wants to write
 * "Zähler: 4711 kWh, vor 5 Minuten". So its text may carry placeholders: `{{ val }}` is the value of
 * the state the caption is bound to, `{{ userdata.0.hallo.val }}` the value of any other one, and
 * `{{ ts }}` when it was last written -- as "vor 5 Minuten", because that is what a caption is for.
 *
 * Deliberately not an expression language: `expr.ts` computes numbers, this substitutes text. The two
 * are used in different places and a template that could compute would be a second, weaker parser.
 */
import { evalExpr } from './expr';
import { formatTimestamp } from './format';

/** What a placeholder can ask a state for */
const FIELDS = ['val', 'ts', 'lc', 'unit', 'ts_abs', 'lc_abs'] as const;

export type TemplateField = (typeof FIELDS)[number];

/**
 * What a reference looks like inside a calculation: a state id, a field, or a function name. Ids may
 * start with a digit (`0_userdata.0.x`), so the pattern does as well.
 */
const REFERENCE = /[A-Za-z0-9_][A-Za-z0-9_.-]*/g;

/** The names `expr.ts` knows; they are not states */
const FUNCTIONS = ['min', 'max', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow', 'avg', 'sum', 'if'];

/** Whether a token of a calculation names something to read, rather than a number or a function */
function isReference(token: string): boolean {
    return !FUNCTIONS.includes(token) && !/^\d+(\.\d+)?$/.test(token);
}

/** `{{ anything }}`, with the spaces optional */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export interface TemplateContext {
    /** The state the caption itself is bound to; `{{ val }}` without an id means this one */
    own?: string;
    /** The value of a state, in whatever type it carries */
    raw?: (oid: string) => unknown;
    /** When a state was written and when it last changed */
    times?: (oid: string) => { ts?: number; lc?: number } | undefined;
    /** What a state's object declares as its unit */
    units?: (oid: string) => string | undefined;
    /** BCP-47 tag for numbers and for "5 minutes ago" */
    locale?: string;
    /** The present, for the relative times */
    now?: number;
}

/**
 * Whether a placeholder computes something rather than naming one state.
 *
 * A state id may contain a minus (`hm-rpc.0....`), so a minus alone does not make a calculation --
 * spaces or one of the other operators do. `{{ val - 1 }}` therefore computes and `{{ hm-rpc.0.x }}`
 * does not, which is the rule the help text states.
 */
function isCalculation(expression: string): boolean {
    return /\s/.test(expression.trim()) || /[+*/%^()]/.test(expression);
}

/** A placeholder split into the state it reads and the field it wants */
function parse(expression: string, own: string | undefined): { oid: string | undefined; field: TemplateField } {
    const trimmed = expression.trim();
    const dot = trimmed.lastIndexOf('.');
    const tail = dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
    if ((FIELDS as readonly string[]).includes(tail)) {
        const oid = dot >= 0 ? trimmed.slice(0, dot) : '';
        return { oid: oid || own, field: tail as TemplateField };
    }
    // Not a field we know: the whole thing is a state, and what is wanted is its value
    return { oid: trimmed || own, field: 'val' };
}

/**
 * Whether a text has placeholders at all. A caption without them is drawn as it is written.
 *
 * @param text the caption's text
 * @returns true if something would be substituted
 */
export function hasTemplate(text: string | undefined): boolean {
    return !!text && /\{\{\s*[^{}]+?\s*\}\}/.test(text);
}

/**
 * The states a text reads, so the hosts know what to subscribe to.
 *
 * @param text the caption's text
 * @param own the state the caption is bound to
 * @returns the ids, without duplicates
 */
export function templateOids(text: string | undefined, own?: string): string[] {
    if (!text) {
        return [];
    }
    const ids = new Set<string>();
    for (const match of text.matchAll(PLACEHOLDER)) {
        const expression = match[1];
        if (isCalculation(expression)) {
            for (const token of expression.match(REFERENCE) || []) {
                if (!isReference(token)) {
                    continue;
                }
                const { oid } = parse(token, own);
                if (oid) {
                    ids.add(oid);
                }
            }
            continue;
        }
        const { oid } = parse(expression, own);
        if (oid) {
            ids.add(oid);
        }
    }
    return [...ids];
}

/**
 * What a reference is worth as a number: a value that is one, a timestamp in milliseconds, or null.
 *
 * @param token the reference, e.g. `val` or `0_userdata.0.x.val`
 * @param context where the values come from
 * @returns the number, or null where there is none
 */
function referenceNumber(token: string, context: TemplateContext): number | null {
    const { oid, field } = parse(token, context.own);
    if (!oid) {
        return null;
    }
    if (field === 'ts' || field === 'ts_abs' || field === 'lc' || field === 'lc_abs') {
        const time = context.times?.(oid);
        return (field.startsWith('lc') ? time?.lc : time?.ts) ?? null;
    }
    const raw = context.raw?.(oid);
    const value = typeof raw === 'boolean' ? Number(raw) : Number(raw);
    return raw === null || raw === undefined || raw === '' || Number.isNaN(value) ? null : value;
}

/**
 * Compute a placeholder.
 *
 * The expression language is the one the sources use (`expr.ts`), and it knows nothing about state
 * ids -- so every reference in the text is replaced by a generated variable and handed over as a
 * number. An unknown state makes the whole expression null, exactly as it does in a value source.
 *
 * @param expression what stood between the braces
 * @param context where the values come from
 * @returns the result as text, empty where it cannot be computed
 */
function calculate(expression: string, context: TemplateContext): string {
    const vars: Record<string, number | null> = {};
    let index = 0;
    const rewritten = expression.replace(REFERENCE, token => {
        // A bare number, or a function of the expression language, stays what it is
        if (!isReference(token)) {
            return token;
        }
        const name = `_v${index++}`;
        vars[name] = referenceNumber(token, context);
        return name;
    });
    const result = evalExpr(rewritten, vars);
    return result === null ? '' : valueText(result, context.locale);
}

/** A value as text: numbers in the page's language, everything else as it is */
function valueText(value: unknown, locale: string | undefined): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return value.toLocaleString(locale);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    // An object state, which ioBroker allows: its JSON is more use than "[object Object]"
    return JSON.stringify(value) ?? '';
}

/**
 * Fill a caption's placeholders in.
 *
 * A placeholder that reads a state nobody is subscribed to, or a time that never happened, becomes an
 * empty string rather than a word like "undefined": the text around it is the user's and still reads.
 *
 * @param text the caption's text
 * @param context where the values come from
 * @returns the text to draw
 */
export function renderTemplate(text: string, context: TemplateContext): string {
    const now = context.now ?? Date.now();
    return text.replace(PLACEHOLDER, (_all, expression: string) => {
        if (isCalculation(expression)) {
            return calculate(expression, context);
        }
        const { oid, field } = parse(expression, context.own);
        if (!oid) {
            return '';
        }
        if (field === 'unit') {
            return context.units?.(oid) ?? '';
        }
        if (field === 'val') {
            return valueText(context.raw?.(oid), context.locale);
        }
        const time = context.times?.(oid);
        const stamp = field.startsWith('lc') ? time?.lc : time?.ts;
        if (!stamp) {
            return '';
        }
        return formatTimestamp(stamp, field.endsWith('_abs') ? 'datetime' : 'relative', now, context.locale);
    });
}
