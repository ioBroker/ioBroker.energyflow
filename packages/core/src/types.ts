/**
 * The configuration model of an energy flow diagram.
 *
 * The model is a **graph**: nodes carry a position, edges connect two nodes. Everything geometric --
 * the path an edge takes, where it attaches to a node, where its label sits -- is *computed* at
 * render time (see `geometry.ts`), never stored. That is the central difference to the hand-drawn
 * SVG paths of `iobroker.energiefluss-erweitert`, where moving one element invalidates every path
 * that touches it.
 *
 * `waypoints` on an edge is the escape hatch for the rare case where the computed route is wrong.
 */

/** Point in canvas units */
export interface Point {
    x: number;
    y: number;
}

/** Rectangle in canvas units, `x`/`y` being the top-left corner */
export interface Rect extends Point {
    w: number;
    h: number;
}

/** Side of a node an edge attaches to. `auto` picks the side that faces the other node. */
export type Side = 'auto' | 'top' | 'right' | 'bottom' | 'left';

// ---------------------------------------------------------------------------
// Value sources
// ---------------------------------------------------------------------------

/** A plain ioBroker state, optionally rescaled */
export interface SrcState {
    /** ioBroker state id */
    oid: string;
    /** The raw value is multiplied by this (e.g. 0.001 to turn W into kW) */
    factor?: number;
    /** Added after `factor` */
    offset?: number;
    /** Flip the sign -- for meters that count the import as negative */
    invert?: boolean;
    /** Values whose absolute amount is below this are treated as exactly 0 (sensor noise) */
    deadband?: number;
    /** Clamp the result */
    min?: number;
    max?: number;
}

/**
 * A value computed from other sources, e.g. `{ expr: 'pv - feedIn', vars: { pv: ..., feedIn: ... } }`.
 *
 * This replaces the fixed special cases of the predecessor (`convert`, `calculate_kw`,
 * `source_option`): whatever arithmetic a setup needs is written down, instead of being picked from
 * the list of cases somebody happened to implement.
 */
export interface SrcExpr {
    /** Arithmetic over the names in `vars`; `expr.ts` documents the supported syntax */
    expr: string;
    vars: Record<string, Src>;
}

/** A fixed number -- useful as a fallback or for a purely decorative edge */
export interface SrcConst {
    const: number;
}

export type Src = SrcState | SrcExpr | SrcConst;

export function isSrcState(src: Src): src is SrcState {
    return typeof (src as SrcState).oid === 'string';
}

export function isSrcExpr(src: Src): src is SrcExpr {
    return typeof (src as SrcExpr).expr === 'string';
}

export function isSrcConst(src: Src): src is SrcConst {
    return typeof (src as SrcConst).const === 'number';
}

/** How a number is turned into the text under a node or next to an edge */
export interface ValueFormat {
    /**
     * Display unit. Empty or omitted means "no unit".
     * With `autoScale`, a base unit of `W`/`Wh`/`VA`/`var` is upgraded to `kW`/`MW`/... as needed.
     */
    unit?: string;
    /** Decimal places. Omitted means: derive from the magnitude (2 below 10, 1 below 100, else 0). */
    decimals?: number;
    /** Scale the unit by powers of 1000. Default: on for `W`, `Wh`, `VA`, `var`, `J`. */
    autoScale?: boolean;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * What a node *is*, which drives its default colour, its default icon and how it is drawn.
 * It carries no behaviour of its own -- an edge does not care what it connects.
 */
export type NodeKind =
    /** Produces energy: PV, wind, CHP */
    | 'source'
    /** Consumes energy: house, wallbox, heat pump */
    | 'sink'
    /** Stores energy: a battery -- draws a charge bar when `soc` is set */
    | 'storage'
    /** The public grid: import and export */
    | 'grid'
    /** A junction without a meaning of its own, used to route several edges through one point */
    | 'bus'
    /** Text only */
    | 'label'
    /** A picture */
    | 'image';

export type NodeShape = 'circle' | 'rounded' | 'square';

/** What happens when the user clicks the node */
export interface NodeAction {
    type: 'none' | 'toggle' | 'setValue' | 'url' | 'view' | 'chart';
    /** State written by `toggle` / `setValue`, state charted by `chart` */
    oid?: string;
    /** Value written by `setValue` */
    value?: string | number | boolean;
    /** Target of `url` */
    url?: string;
    /** Whether `url` opens in a new tab */
    newTab?: boolean;
    /** Target of `view` (vis-2 only) */
    view?: string;
}

/** A secondary value shown in small type below the main one */
export interface NodeBadge extends ValueFormat {
    src: Src;
    /** Prefix, e.g. "today" */
    label?: string;
}

export interface FlowNode extends ValueFormat {
    id: string;
    kind: NodeKind;
    /** Centre of the node in canvas units */
    x: number;
    y: number;
    /** Defaults to the size of the shape, see `defaults.ts` */
    w?: number;
    h?: number;
    shape?: NodeShape;
    label?: string;
    /**
     * Name of a built-in icon (see `icons.tsx`), or a URL / data URI.
     *
     * Omitted means the default icon of the `kind`; an **empty string** means no icon at all, and the
     * value then sits in the middle of the node. The two have to be distinguishable, or a node can
     * never get rid of the icon its kind implies.
     */
    icon?: string;
    /** Accent colour. Omitted means: the theme colour of the `kind`. */
    color?: string;
    /** The number displayed inside the node */
    value?: Src;
    badges?: NodeBadge[];
    /** State of charge in percent -- `storage` only, drawn as a fill level */
    soc?: Src;
    action?: NodeAction;
    /** Hide the whole node while its value is 0 or unknown (e.g. a wallbox that is not plugged in) */
    hideWhenZero?: boolean;
    /** Content of a `label` node */
    text?: string;
    /** Font size of the value, in canvas units */
    fontSize?: number;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * How the sign of `value` is read.
 *
 * - `signed` -- one state for both directions: a positive value flows `from` to `to`, a negative one
 *   the other way. This is the normal case for a grid meter, and it is why one edge is enough here
 *   where the predecessor needs two (`powerLine-oid` *and* `powerLineReturn-oid`).
 * - `positive` -- only `from` to `to`; a negative value counts as 0.
 * - `split` -- two separate states: `value` for `from` to `to`, `reverse` for the opposite.
 */
export type EdgeMode = 'signed' | 'positive' | 'split';

export type EdgeCurve = 'bezier' | 'orthogonal' | 'straight';

export interface FlowEdge extends ValueFormat {
    id: string;
    /** Node id */
    from: string;
    /** Node id */
    to: string;
    fromSide?: Side;
    toSide?: Side;
    value: Src;
    mode?: EdgeMode;
    /** Second source, for `mode: 'split'` */
    reverse?: Src;
    /**
     * Colour of the line while energy flows `from` to `to`. Omitted means: the colour of the node the
     * energy comes from -- which is what makes a diagram readable without configuring anything.
     */
    color?: string;
    /** Colour for the opposite direction. Omitted means: the colour of the `to` node. */
    colorReverse?: string;
    width?: number;
    /** Absolute value below which the edge counts as idle: no animation, muted colour */
    threshold?: number;
    /** Do not draw the line at all while it is idle */
    hideWhenIdle?: boolean;
    /** Print the value next to the line */
    showValue?: boolean;
    curve?: EdgeCurve;
    /** Fixed intermediate points; overrides the computed route */
    waypoints?: Point[];
}

// ---------------------------------------------------------------------------
// Canvas and document
// ---------------------------------------------------------------------------

export interface AnimationSettings {
    enabled?: boolean;
    /** Distance between two dots, in canvas units */
    gap?: number;
    /** Diameter of a dot, in canvas units */
    dotSize?: number;
    /** The absolute value at which a dot needs `refDuration` seconds to advance by one `gap` */
    refPower?: number;
    refDuration?: number;
    /** Clamp for the resulting duration, in seconds */
    minDuration?: number;
    maxDuration?: number;
}

export interface EnergyFlowCanvas {
    /** Width of the coordinate system. The diagram is scaled into whatever box the host gives it. */
    w: number;
    h: number;
    /** Background of the drawing area. Omitted means transparent. */
    background?: string;
    /** Snap grid of the editor, in canvas units. 0 disables snapping. */
    grid?: number;
}

/** Values inherited by every node and edge that does not override them */
export interface EnergyFlowDefaults extends ValueFormat {
    animation?: AnimationSettings;
    /** Line width of an edge */
    lineWidth?: number;
    /** Font size of node values, in canvas units */
    fontSize?: number;
}

export interface EnergyFlowConfig {
    /** Schema version -- bumped whenever `migrate.ts` has to convert an older document */
    v: 1;
    canvas: EnergyFlowCanvas;
    nodes: FlowNode[];
    edges: FlowEdge[];
    defaults?: EnergyFlowDefaults;
}

/**
 * A diagram stored centrally instead of inside the widget, so that one layout can be used from vis-2
 * and from the device manager at the same time. The host resolves it before rendering.
 */
export interface EnergyFlowConfigRef {
    $ref: string;
}

export type EnergyFlowConfigOrRef = EnergyFlowConfig | EnergyFlowConfigRef;

export function isConfigRef(config: EnergyFlowConfigOrRef): config is EnergyFlowConfigRef {
    return typeof (config as EnergyFlowConfigRef).$ref === 'string';
}
