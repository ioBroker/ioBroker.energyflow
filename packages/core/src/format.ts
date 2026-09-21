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
import type { ValueFormat } from './types';

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
export function mergeFormat(own: ValueFormat | undefined, defaults: ValueFormat | undefined): ValueFormat {
    return {
        unit: own?.unit ?? defaults?.unit,
        decimals: own?.decimals ?? defaults?.decimals,
        autoScale: own?.autoScale ?? defaults?.autoScale,
    };
}
