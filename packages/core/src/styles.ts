/**
 * The looks of a diagram: how boxes and lines are drawn, on top of the host's light or dark theme.
 *
 * A style is a set of drawing decisions plus a palette per mode -- it never replaces the host theme,
 * it adjusts it, so "clean" in a dark admin is a dark clean diagram. Adding a style is adding an
 * entry here; the renderer asks the style, never its name.
 */
import type { FlowTheme } from './theme';
import type { FlowConfig, NodeKind } from './types';

export type DiagramStyleId = 'normal' | 'clean' | 'neo' | 'neon' | 'glass';

/** In the order the designer offers them */
export const DIAGRAM_STYLE_IDS: DiagramStyleId[] = ['normal', 'clean', 'neo', 'neon', 'glass'];

export interface DiagramStyle {
    id: DiagramStyleId;
    /** Every body a rounded card -- circles included -- instead of the node's own shape */
    cards: boolean;
    /** Corner radius of a card, in canvas units */
    cardRadius: number;
    /**
     * The shadow of the bodies: `soft` below them, `neo` a light one up-left and a dark one down-right,
     * which makes a card look raised out of a surface of its own colour
     */
    shadow: 'none' | 'soft' | 'neo';
    /** The label inside the body, under the value, instead of below the node */
    labelInside: boolean;
    /** A consumer's icon on a tinted square */
    iconChip: boolean;
    /** How strongly the node colour tints its body, per mode */
    tint: { light: number; dark: number };
    /** Opacity of the node-coloured outline */
    outline: number;
    /** Width of that outline, in canvas units */
    outlineWidth: number;
    /** Active lines, outlines and icons glow in their own colour */
    glow: boolean;
    /** A circle shows its level as an arc along its outline -- a gauge -- instead of filling up */
    levelRing: boolean;
    /**
     * The diagram's own background is drawn as a rounded panel. Only its shape: a diagram without a
     * background of its own stays transparent in every style, so it sits on the page, the widget or
     * the dialog it was put into rather than on a grey box of its own.
     */
    panel: boolean;
    /** An arrowhead where the energy arrives, instead of one in the middle when the dots stand still */
    arrowAtEnd: boolean;
    /** The moving dots in the line colour, or light dots on the coloured line */
    dots: 'line' | 'light';
    /**
     * The body is translucent -- the page shows through it -- with a highlight across the top. What
     * makes a panel look like glass rather than like paint: the background has to be visible, so this
     * is the one decision that only works on a diagram that has something behind it.
     */
    glass: boolean;
    /**
     * A line is drawn as a pipe: a wider, faint casing under the line itself. The number is the
     * factor on the line width; 0 is no casing.
     */
    tube: number;
    /**
     * A factor on the width of every line. A style that draws pipes needs them thick enough to look
     * like pipes, and the document's `lineWidth` is set for the normal one -- so this scales what the
     * user chose instead of replacing it.
     */
    lineScale: number;
    /** Adjust the host theme for this style */
    theme: (base: FlowTheme) => FlowTheme;
}

const NORMAL: DiagramStyle = {
    id: 'normal',
    cards: false,
    cardRadius: 16,
    shadow: 'none',
    labelInside: false,
    iconChip: false,
    tint: { light: 0.09, dark: 0.16 },
    outline: 0.45,
    outlineWidth: 1.6,
    glow: false,
    levelRing: false,
    panel: false,
    arrowAtEnd: false,
    dots: 'line',
    glass: false,
    tube: 0,
    lineScale: 1,
    theme: base => base,
};

/** Clear accents on white cards; the palette of the reference picture */
const CLEAN_KINDS_LIGHT: Partial<Record<NodeKind, string>> = {
    source: '#F5A800',
    storage: '#22A55B',
    grid: '#7C5CE0',
    sink: '#3B82F6',
};

const CLEAN_KINDS_DARK: Partial<Record<NodeKind, string>> = {
    source: '#FFC233',
    storage: '#3DD17A',
    grid: '#A08BFA',
    sink: '#60A5FA',
};

const CLEAN: DiagramStyle = {
    id: 'clean',
    cards: true,
    cardRadius: 16,
    shadow: 'soft',
    labelInside: true,
    iconChip: true,
    tint: { light: 0.07, dark: 0.12 },
    outline: 0.5,
    outlineWidth: 1.6,
    glow: false,
    levelRing: false,
    panel: true,
    arrowAtEnd: true,
    dots: 'light',
    glass: false,
    tube: 0,
    lineScale: 1,
    theme: base =>
        base.mode === 'dark'
            ? {
                  ...base,
                  background: '#121821',
                  surface: '#1B2330',
                  border: '#2C3644',
                  text: '#E8EDF4',
                  textSecondary: '#9AA6B5',
                  idle: '#4A5566',
                  kinds: { ...base.kinds, ...CLEAN_KINDS_DARK },
              }
            : {
                  ...base,
                  background: '#F3F6FB',
                  surface: '#FFFFFF',
                  border: '#E3E8EF',
                  text: '#1D2533',
                  textSecondary: '#5C6675',
                  idle: '#C9D1DC',
                  kinds: { ...base.kinds, ...CLEAN_KINDS_LIGHT },
              },
};

/**
 * Neumorphism: cards raised out of a surface of their own colour by a light and a dark shadow, no
 * outlines. The surface is a cool grey rather than white -- a white highlight needs something darker
 * to stand out from.
 */
const NEO: DiagramStyle = {
    id: 'neo',
    cards: true,
    cardRadius: 20,
    shadow: 'neo',
    labelInside: true,
    iconChip: true,
    // Barely tinted: the card has to read as the same material as the surface it rises from
    tint: { light: 0.03, dark: 0.05 },
    outline: 0.12,
    outlineWidth: 1.6,
    glow: false,
    levelRing: false,
    panel: true,
    arrowAtEnd: true,
    dots: 'light',
    glass: false,
    tube: 0,
    lineScale: 1,
    theme: base =>
        base.mode === 'dark'
            ? {
                  ...base,
                  background: '#252A32',
                  surface: '#272D36',
                  border: '#323A45',
                  text: '#E6EAF0',
                  textSecondary: '#98A2B0',
                  idle: '#4B5361',
                  kinds: { ...base.kinds, ...CLEAN_KINDS_DARK },
              }
            : {
                  ...base,
                  background: '#E9EEF5',
                  surface: '#EEF2F8',
                  border: '#D5DCE6',
                  text: '#1F2733',
                  textSecondary: '#5E6878',
                  idle: '#C3CCD8',
                  kinds: { ...base.kinds, ...CLEAN_KINDS_LIGHT },
              },
};

/** Saturated accents that still read as light on a near-black surface */
const NEON_KINDS_DARK: Partial<Record<NodeKind, string>> = {
    source: '#FFC72C',
    storage: '#3DF58E',
    grid: '#B47CFF',
    sink: '#3CC4FF',
};

const NEON_KINDS_LIGHT: Partial<Record<NodeKind, string>> = {
    source: '#F59E0B',
    storage: '#10B981',
    grid: '#8B5CF6',
    sink: '#0EA5E9',
};

/**
 * Neon: glowing lines and outlines on a deep navy surface, the level of a circle as a glowing gauge.
 * The node keeps its own shape. In a light theme the glow becomes a coloured haze on white -- a neon
 * sign in daylight rather than a dark diagram in a light page.
 */
const NEON: DiagramStyle = {
    id: 'neon',
    cards: false,
    cardRadius: 16,
    shadow: 'none',
    labelInside: true,
    iconChip: false,
    tint: { light: 0.05, dark: 0.1 },
    outline: 0.95,
    outlineWidth: 2.2,
    glow: true,
    levelRing: true,
    panel: true,
    arrowAtEnd: true,
    dots: 'light',
    glass: false,
    tube: 0,
    lineScale: 1,
    theme: base =>
        base.mode === 'dark'
            ? {
                  ...base,
                  background: '#070B15',
                  surface: '#0B1221',
                  border: '#1A2440',
                  text: '#F3F6FF',
                  textSecondary: '#97A4C3',
                  idle: '#29344C',
                  kinds: { ...base.kinds, ...NEON_KINDS_DARK },
              }
            : {
                  ...base,
                  background: '#F4F7FC',
                  surface: '#FFFFFF',
                  border: '#DCE3EF',
                  text: '#121829',
                  textSecondary: '#55607A',
                  idle: '#C6CFDF',
                  kinds: { ...base.kinds, ...NEON_KINDS_LIGHT },
              },
};

/**
 * Glass: translucent panels over a dark page, lit rims, and lines drawn as pipes.
 *
 * The one style whose bodies are see-through, which is why it brings a background of its own: on a
 * transparent widget there would be nothing behind the glass to show through, and it would read as
 * flat paint. The accents are cool -- water and its machinery is what this was drawn for -- and the
 * level of a circle is an arc, so a pump reads as a gauge.
 */
const GLASS_KINDS_DARK: Partial<Record<NodeKind, string>> = {
    source: '#FFC24D',
    storage: '#35B6FF',
    grid: '#8B9CFF',
    sink: '#4FD1FF',
};
const GLASS_KINDS_LIGHT: Partial<Record<NodeKind, string>> = {
    source: '#E08A00',
    storage: '#0C8FD6',
    grid: '#5A6BE0',
    sink: '#0AA6D8',
};
const GLASS: DiagramStyle = {
    id: 'glass',
    // Not cards: a valve and a pump are circles in every picture of an installation, and turning
    // them into panels would take the one thing that tells them from a tank
    cards: false,
    cardRadius: 20,
    shadow: 'soft',
    labelInside: false,
    iconChip: false,
    tint: { light: 0.1, dark: 0.18 },
    outline: 0.7,
    outlineWidth: 1.8,
    glow: true,
    levelRing: true,
    panel: true,
    arrowAtEnd: true,
    dots: 'light',
    glass: true,
    tube: 2.4,
    lineScale: 1.8,
    theme: base =>
        base.mode === 'dark'
            ? {
                  ...base,
                  background: '#0A1220',
                  surface: '#16253C',
                  border: '#27456B',
                  text: '#EAF2FF',
                  textSecondary: '#93A8C6',
                  idle: '#2A3A55',
                  kinds: { ...base.kinds, ...GLASS_KINDS_DARK },
              }
            : {
                  ...base,
                  background: '#E9F1FA',
                  surface: '#FFFFFF',
                  border: '#C8DAEC',
                  text: '#10233A',
                  textSecondary: '#556B86',
                  idle: '#B9CADC',
                  kinds: { ...base.kinds, ...GLASS_KINDS_LIGHT },
              },
};

const STYLES: Record<DiagramStyleId, DiagramStyle> = {
    normal: NORMAL,
    clean: CLEAN,
    neo: NEO,
    neon: NEON,
    glass: GLASS,
};

/**
 * The style a diagram is drawn in.
 *
 * @param config the diagram
 * @returns its style; `normal` for none or an unknown one
 */
export function diagramStyle(config: FlowConfig | undefined): DiagramStyle {
    return STYLES[config?.defaults?.style as DiagramStyleId] ?? NORMAL;
}

/**
 * The host theme, adjusted for the diagram's style. The runtime and the renderer both use it, so the
 * colours a node or a muted line gets are the ones it is drawn with.
 *
 * @param theme the host theme
 * @param config the diagram
 * @returns the theme to draw with
 */
export function styledTheme(theme: FlowTheme, config: FlowConfig | undefined): FlowTheme {
    return diagramStyle(config).theme(theme);
}
