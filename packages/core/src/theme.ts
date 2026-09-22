/**
 * The colours the diagram draws with.
 *
 * The core deliberately does not import MUI. vis-2 and the device manager both hand their widgets a
 * MUI theme, but they are separate applications on their own upgrade cycles, and a renderer that
 * reads `theme.palette.*` directly breaks the day one of them moves to the next MUI major. Instead
 * each host flattens its theme into this handful of values once (`themeFromMui()`), and the
 * renderer only ever sees plain colour strings.
 */
import type { NodeKind } from './types';

export type ThemeMode = 'light' | 'dark';

export interface EnergyFlowTheme {
    mode: ThemeMode;
    /** Primary text, e.g. the value inside a node */
    text: string;
    /** Labels and units */
    textSecondary: string;
    /** Behind the whole drawing area */
    background: string;
    /** Fill of a node body */
    surface: string;
    /** Outline of a node, grid lines in the editor */
    border: string;
    /** An edge that carries no energy right now */
    idle: string;
    /** Default accent per node kind */
    kinds: Record<NodeKind, string>;
    /** BCP-47 tag used to format numbers */
    locale?: string;
}

/**
 * Accents chosen to stay apart from each other in both modes and to survive the usual colour vision
 * deficiencies: amber, blue, green and slate differ in lightness as well as in hue, so the diagram
 * is still readable when the hue is not.
 */
const LIGHT_KINDS: Record<NodeKind, string> = {
    source: '#E0901A',
    sink: '#2F6FED',
    storage: '#219A67',
    grid: '#64748B',
    bus: '#94A3B8',
    label: '#1F2933',
    image: '#1F2933',
};

const DARK_KINDS: Record<NodeKind, string> = {
    source: '#F5B84B',
    sink: '#6BA5FF',
    storage: '#4CC58C',
    grid: '#94A3B8',
    bus: '#64748B',
    label: '#E6EAF0',
    image: '#E6EAF0',
};

export const LIGHT_THEME: EnergyFlowTheme = {
    mode: 'light',
    text: '#1F2933',
    textSecondary: '#5A6672',
    background: 'transparent',
    surface: '#FFFFFF',
    border: '#DCE3EA',
    idle: '#C7D0D9',
    kinds: LIGHT_KINDS,
};

export const DARK_THEME: EnergyFlowTheme = {
    mode: 'dark',
    text: '#E6EAF0',
    textSecondary: '#98A3B1',
    background: 'transparent',
    surface: '#232A33',
    border: '#38424E',
    idle: '#414C59',
    kinds: DARK_KINDS,
};

/**
 * Build a theme for a mode, with individual values overridden.
 *
 * @param mode light or dark
 * @param overrides values that replace the defaults
 * @returns the theme
 */
export function createTheme(mode: ThemeMode, overrides?: Partial<EnergyFlowTheme>): EnergyFlowTheme {
    const base = mode === 'dark' ? DARK_THEME : LIGHT_THEME;
    return {
        ...base,
        ...overrides,
        kinds: { ...base.kinds, ...(overrides?.kinds || {}) },
    };
}

/** The subset of a MUI theme this needs -- typed structurally so no MUI import is required */
export interface MuiLikeTheme {
    palette?: {
        mode?: string;
        text?: { primary?: string; secondary?: string };
        background?: { paper?: string; default?: string };
        divider?: string;
        primary?: { main?: string };
        secondary?: { main?: string };
    };
}

/**
 * Flatten whatever MUI theme the host is running into an {@link EnergyFlowTheme}.
 *
 * The node accents deliberately do **not** come from the MUI palette: they encode a meaning (sun,
 * grid, battery) that must stay recognisable across the themes a user picks in vis-2, and a diagram
 * whose photovoltaics turn blue because somebody chose a blue primary colour is worse, not better.
 *
 * @param theme the host theme
 * @param locale BCP-47 tag for number formatting
 * @returns the flattened theme
 */
export function themeFromMui(theme: MuiLikeTheme | undefined, locale?: string): EnergyFlowTheme {
    const mode: ThemeMode = theme?.palette?.mode === 'dark' ? 'dark' : 'light';
    const base = mode === 'dark' ? DARK_THEME : LIGHT_THEME;

    return {
        ...base,
        text: theme?.palette?.text?.primary || base.text,
        textSecondary: theme?.palette?.text?.secondary || base.textSecondary,
        surface: theme?.palette?.background?.paper || base.surface,
        border: theme?.palette?.divider || base.border,
        locale,
    };
}

/**
 * Mix a colour towards the background to mark an edge as idle.
 *
 * Works on `#rgb`, `#rrggbb` and anything else by falling back to the theme's idle colour -- the
 * renderer must not crash on a `rgb()` or `var()` string somebody put into the configuration.
 *
 * @param color the accent colour
 * @param theme the theme
 * @param amount 0 keeps the colour, 1 is fully idle
 * @returns the muted colour
 */
export function muteColor(color: string, theme: EnergyFlowTheme, amount = 0.72): string {
    const rgb = parseHex(color);
    const target = parseHex(theme.idle);
    if (!rgb || !target) {
        return theme.idle;
    }
    const mix = (a: number, b: number): number => Math.round(a + (b - a) * amount);
    return `rgb(${mix(rgb[0], target[0])}, ${mix(rgb[1], target[1])}, ${mix(rgb[2], target[2])})`;
}

/**
 * Parse the colour notations that can actually turn up in a document into `[r, g, b]`.
 *
 * `#rgb` and `#rrggbb` come from the colour picker, `rgb()` / `rgba()` from a hand-edited document or
 * from a picker that was left in another notation, `hsl()` from a colour scale. Anything else -- a
 * colour name, a CSS variable -- yields null, and the callers fall back instead of drawing something
 * wrong.
 */
/** HSL to RGB, the textbook conversion */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = (((hue % 360) + 360) % 360) / 360;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const channel = (offset: number): number => {
        const k = (offset + h * 12) % 12;
        return Math.round(255 * (lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [channel(0), channel(8), channel(4)];
}

function parseHex(color: string): [number, number, number] | null {
    if (typeof color !== 'string') {
        return null;
    }
    const value = color.trim();

    if (value[0] === '#') {
        const hex = value.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
        }
        if (hex.length === 6 || hex.length === 8) {
            return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
        }
        return null;
    }

    // `hsl(120, 72%, 46%)` -- what a colour scale produces, and what people type by hand
    const hsl = /^hsla?\(([^)]+)\)$/i.exec(value);
    if (hsl) {
        const [h, sat, light] = hsl[1]
            .split(/[\s,/]+/)
            .filter(Boolean)
            .map(part => parseFloat(part));
        if ([h, sat, light].every(Number.isFinite)) {
            return hslToRgb(h, sat / 100, light / 100);
        }
        return null;
    }

    // `rgb(1 2 3)`, `rgb(1, 2, 3)` and `rgba(1, 2, 3, 0.5)` all reduce to the first three numbers
    const match = /^rgba?\(([^)]+)\)$/i.exec(value);
    if (match) {
        const parts = match[1]
            .split(/[\s,/]+/)
            .filter(Boolean)
            .map(Number);
        if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
            return [parts[0], parts[1], parts[2]];
        }
    }

    return null;
}

/**
 * A colour with an alpha channel, for the fill behind a node icon.
 *
 * @param color the accent colour
 * @param alpha 0..1
 * @returns an `rgba()` string, or the colour unchanged when it cannot be parsed
 */
export function withAlpha(color: string, alpha: number): string {
    const rgb = parseHex(color);
    if (!rgb) {
        return color;
    }
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Exported for the tests -- the colour notations a document may contain are worth pinning down. */
export const parseColorString = parseHex;
