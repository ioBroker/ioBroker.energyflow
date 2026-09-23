/**
 * Formatting numbers for display.
 *
 * The part that earns its keep is the automatic unit scaling. Almost every inverter, meter and
 * wallbox in ioBroker reports watts, so a PV diagram that prints the raw state shows "8734 W" at
 * noon and "0 W" at night, while everybody talks in kilowatts. The predecessor solves this with a
 * per-element `calculate_kw` switch that the user has to remember to set on each of a dozen
 * elements. Here the unit carries the information: a value in `W` is shown as `W`, `kW` or `MW`
 * depending on how large it currently is, and the decimal places follow.
 */
import type { TimestampFormat, ValueFormat } from './types';

/** Units that are scaled by powers of 1000 when `autoScale` is not explicitly turned off */
const SCALABLE_BASES = ['Wh', 'Wp', 'VAh', 'VA', 'varh', 'var', 'W', 'J'];

/** Ordered small to large; the code walks it backwards to find the largest prefix that fits */
const PREFIXES: { prefix: string; factor: number }[] = [
    { prefix: '', factor: 1 },
    { prefix: 'k', factor: 1e3 },
    { prefix: 'M', factor: 1e6 },
    { prefix: 'G', factor: 1e9 },
    { prefix: 'T', factor: 1e12 },
];

interface ParsedUnit {
    /** The unit without its SI prefix, e.g. `W` for `kW` */
    base: string;
    /** Factor of the prefix the value is currently expressed in, e.g. 1000 for `kW` */
    factor: number;
}

/**
 * Split a unit into its SI prefix and its base.
 *
 * Returns null for anything that is not a scalable unit -- `%`, `degC`, `A` and whatever else an
 * adapter puts there are printed exactly as configured.
 *
 * @param unit the unit as configured
 * @returns the base unit and the factor of its prefix, or null
 */
function parseUnit(unit: string): ParsedUnit | null {
    // Longest base first, so `Wh` is not read as `W` with a stray `h`
    for (const base of SCALABLE_BASES) {
        if (unit === base) {
            return { base, factor: 1 };
        }
        if (unit.length === base.length + 1 && unit.endsWith(base)) {
            const found = PREFIXES.find(entry => entry.prefix && entry.prefix === unit[0]);
            if (found) {
                return { base, factor: found.factor };
            }
        }
    }
    return null;
}

/**
 * The base of a unit and the factor that converts a value in it into that base: `kW` is `W` times
 * 1000. A unit without SI multiples -- `%`, `A`, `degC` -- is its own base.
 *
 * @param unit the unit
 * @returns base and factor; an empty base when there is no unit
 */
export function unitScale(unit: string | undefined): { base: string; factor: number } {
    if (!unit) {
        return { base: '', factor: 1 };
    }
    return parseUnit(unit) ?? { base: unit, factor: 1 };
}

/**
 * Decimal places when the configuration does not prescribe any.
 *
 * For a scalable unit the prefix already decides the resolution, and following it is what makes the
 * numbers look like the ones on an inverter display: whole watts, two decimals once it is kilowatts.
 * A magnitude rule alone gets this wrong at the bottom of the range -- 40 W would print as "40,0 W"
 * and a meter reading zero as "0,00 W".
 *
 * Everything else -- percent, amperes, degrees -- has no prefix to go by, so the magnitude decides.
 *
 * @param value the value after scaling
 * @param scaled the result of {@link scaleUnit}
 * @returns the number of decimals
 */
function defaultDecimals(value: number, scaled: ScaledValue): number {
    if (scaled.scalable) {
        // In the base unit the resolution the prefix implies is one whole unit, and that includes a
        // value of exactly zero -- which no magnitude rule can get right
        return scaled.scaled ? 2 : 0;
    }
    const magnitude = Math.abs(value);
    if (magnitude >= 100) {
        return 0;
    }
    if (magnitude >= 10) {
        return 1;
    }
    return 2;
}

export interface ScaledValue {
    value: number;
    unit: string;
    /** Whether the unit was upgraded to a larger multiple, e.g. W to kW */
    scaled?: boolean;
    /** Whether the unit has multiples at all and scaling was allowed */
    scalable?: boolean;
}

/**
 * Express a value in the most readable multiple of its unit.
 *
 * @param value the value as configured
 * @param unit its unit, possibly already prefixed
 * @param autoScale explicit override; undefined means "scale if the unit is scalable"
 * @returns the rescaled value and the matching unit
 */
export function scaleUnit(value: number, unit: string | undefined, autoScale?: boolean): ScaledValue {
    const original = unit || '';
    if (autoScale === false || !original) {
        return { value, unit: original, scaled: false, scalable: false };
    }

    const parsed = parseUnit(original);
    if (!parsed) {
        // Not a scalable unit. An explicit `autoScale: true` cannot change that -- there is no
        // sensible "kilo-percent"
        return { value, unit: original, scaled: false, scalable: false };
    }

    const inBase = value * parsed.factor;
    const magnitude = Math.abs(inBase);

    // Exactly zero has no magnitude to speak of; keep the unit the user configured so that a
    // diagram does not flip between "0 W" and "0 kW" as a value crosses the threshold
    if (magnitude === 0) {
        return { value: 0, unit: original, scaled: false, scalable: true };
    }

    let chosen = PREFIXES[0];
    for (const entry of PREFIXES) {
        if (magnitude >= entry.factor) {
            chosen = entry;
        }
    }

    return {
        value: inBase / chosen.factor,
        unit: `${chosen.prefix}${parsed.base}`,
        scaled: chosen.factor > 1,
        scalable: true,
    };
}

/**
 * Format a number with a fixed number of decimals, using the separators of the given locale.
 *
 * @param value the number
 * @param decimals decimal places
 * @param locale BCP-47 tag; undefined uses the browser locale
 * @returns the formatted number
 */
export function formatNumber(value: number, decimals: number, locale?: string): string {
    // A tiny negative value -- 40 mW of standby on a meter, or plain rounding noise -- would print as
    // "-0.00 kW", which reads like a bug. The check has to happen *after* rounding to the requested
    // number of decimals, because that is where the sign becomes meaningless.
    const factor = 10 ** decimals;
    const normalized = Math.round(value * factor) === 0 ? 0 : value;
    return normalized.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

export interface FormattedValue {
    /** Number and unit, ready to print */
    text: string;
    /** Just the number */
    number: string;
    /** The unit actually used, after scaling */
    unit: string;
}

export interface FormatOptions extends ValueFormat {
    locale?: string;
    /** Printed instead of the number while the value is unknown */
    placeholder?: string;
}

/**
 * Format a value for display, including its unit.
 *
 * @param value the value, or null when it is unknown
 * @param options unit, decimals, scaling and locale
 * @returns the pieces of the formatted value
 */
export function formatValue(value: number | null, options: FormatOptions = {}): FormattedValue {
    const placeholder = options.placeholder ?? '--';

    if (value === null || !Number.isFinite(value)) {
        return { text: placeholder, number: placeholder, unit: options.unit || '' };
    }

    const scaled = scaleUnit(value, options.unit, options.autoScale);
    const decimals = options.decimals ?? defaultDecimals(scaled.value, scaled);
    const number = formatNumber(scaled.value, decimals, options.locale);

    return {
        text: scaled.unit ? `${number} ${scaled.unit}` : number,
        number,
        unit: scaled.unit,
    };
}

/**
 * Merge the format of an element with the document defaults, so that setting the unit once on the
 * document is enough for a diagram whose states all report watts.
 *
 * @param own the format of the node or edge
 * @param defaults the document defaults
 * @returns the effective format
 */
export function mergeFormat(
    own: ValueFormat | undefined,
    defaults: ValueFormat | undefined,
    sourceUnit?: string,
): ValueFormat {
    return {
        // The element's own unit, else what the state object says, else the diagram's default. `||` on
        // purpose: an empty unit is an unset one, see `ValueFormat.unit`
        unit: own?.unit || sourceUnit || defaults?.unit,
        decimals: own?.decimals ?? defaults?.decimals,
        autoScale: own?.autoScale ?? defaults?.autoScale,
    };
}

/** Seconds per unit, largest first, for the relative form */
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
];

/**
 * Write a point in time.
 *
 * The words come from the browser (`Intl`), not from the dictionary: "vor 12 Minuten", "12 minutes
 * ago" and every other language are built in, with their plural rules, and a date follows the locale's
 * own order.
 *
 * @param time ms since the epoch
 * @param format relative ("12 minutes ago"), a clock time, or date and time
 * @param now the present, for the relative form
 * @param locale BCP-47 tag; undefined uses the browser's
 * @returns the text
 */
export function formatTimestamp(
    time: number,
    format: TimestampFormat = 'relative',
    now = Date.now(),
    locale?: string,
): string {
    const date = new Date(time);
    if (format === 'time') {
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    if (format === 'datetime' || typeof Intl.RelativeTimeFormat !== 'function') {
        return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
    }
    // A clock a few seconds ahead of the server would say "in 3 seconds" -- it is "now"
    const seconds = Math.min(Math.round((time - now) / 1000), 0);
    const [unit, size] = RELATIVE_UNITS.find(([, length]) => Math.abs(seconds) >= length) ?? ['second', 1];
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}

/**
 * Advance width of a character, in font sizes, measured on bold system-ui; the other system fonts are
 * within a few percent. Enough to tell whether a value fits its box, which is all it is used for.
 *
 * @param ch one character
 */
function charWidth(ch: string): number {
    if (ch >= '0' && ch <= '9') {
        return 0.58;
    }
    if (".,:;|!'".includes(ch)) {
        return 0.27;
    }
    if ('ijlftr '.includes(ch)) {
        return 0.33;
    }
    if ('-()'.includes(ch)) {
        return 0.4;
    }
    if ('mwMW%'.includes(ch)) {
        return 0.95;
    }
    if ((ch >= 'A' && ch <= 'Z') || ch.charCodeAt(0) >= 0x2e80) {
        // Capitals, and the ideographs of the Chinese dictionary, which are a full square
        return ch >= 'A' && ch <= 'Z' ? 0.7 : 1;
    }
    return 0.58;
}

/**
 * The rough width of a text, in canvas units. The renderer also runs in node -- the previews, the
 * gallery -- where there is nothing to measure with, so this estimates rather than measures.
 *
 * @param text the text
 * @param size its font size
 * @param bold whether it is drawn bold
 */
export function textWidth(text: string, size: number, bold: boolean): number {
    let units = 0;
    for (const ch of text) {
        units += charWidth(ch);
    }
    return units * size * (bold ? 1 : 0.93);
}

/**
 * The font size at which a text fits into `room`: the given size when it already does, else smaller,
 * but never below half of it -- past that a value is unreadable anyway, and overflowing says more.
 *
 * @param text the text
 * @param size the font size it would have
 * @param room the width available, in canvas units
 * @param bold whether it is drawn bold, which makes it a little wider
 */
export function fitFontSize(text: string, size: number, room: number, bold: boolean): number {
    const width = textWidth(text, size, bold);
    return width <= room ? size : Math.max((size * room) / width, size * 0.5);
}

/**
 * How long a flow in this unit has to be integrated to give an amount, in seconds.
 *
 * A flow says its own time base: `l/min` integrated over minutes gives litres, `m3/h` over hours
 * gives cubic metres. A unit without one is a power -- `W`, `kW`, `VA` -- and those are counted in
 * hours, because that is what `Wh` means. Getting this wrong is not a rounding error: litres out of
 * `l/min` integrated over an hour are off by sixty.
 *
 * @param unit the unit of the flow
 * @returns the number of seconds, 3600 when the unit says nothing
 */
export function integralSeconds(unit: string | undefined): number {
    const per = /\/\s*(s|sec|min|h|hour)\b/i.exec(unit || '');
    if (!per) {
        return 3600;
    }
    const time = per[1].toLowerCase();
    return time.startsWith('s') ? 1 : time === 'min' ? 60 : 3600;
}

/**
 * The unit of the amount that flow adds up to: `W` becomes `Wh`, `l/min` becomes `l`, `m3/h`
 * becomes `m3`.
 *
 * @param unit the unit of the flow
 * @returns the unit of the amount
 */
export function amountUnit(unit: string | undefined): string {
    if (!unit) {
        return '';
    }
    const per = unit.indexOf('/');
    return per === -1 ? `${unit}h` : unit.slice(0, per).trim();
}
