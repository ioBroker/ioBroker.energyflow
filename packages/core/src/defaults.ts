/**
 * The values that are left out of a document.
 *
 * A saved diagram should contain what the user decided, not a full copy of every knob the renderer
 * knows. So everything here has a default, a node written by the editor is a handful of keys, and a
 * later version can change how an unset knob behaves for every existing diagram at once.
 */
import type {
    AnimationSettings,
    EnergyFlowCanvas,
    EnergyFlowConfig,
    FlowEdge,
    FlowNode,
    NodeKind,
    NodeShape,
    Rect,
} from './types';

/** Canvas units. The diagram is scaled into the box the host gives it, so these are not pixels. */
export const DEFAULT_CANVAS: EnergyFlowCanvas = {
    w: 900,
    h: 560,
    grid: 10,
};

export const DEFAULT_ANIMATION: Required<AnimationSettings> = {
    enabled: true,
    gap: 26,
    dotSize: 6,
    /**
     * Three kilowatts, on the assumption that the states report watts -- the unit virtually every
     * inverter, meter and wallbox adapter uses. At this value a dot advances one gap in
     * `refDuration` seconds; twice the power moves twice as fast.
     */
    refPower: 3000,
    refDuration: 0.55,
    minDuration: 0.18,
    maxDuration: 2.4,
};

/** Line width of an edge, in canvas units */
export const DEFAULT_LINE_WIDTH = 3;

/** Font size of the value inside a node, in canvas units */
export const DEFAULT_FONT_SIZE = 17;

/**
 * Below this absolute value an edge counts as idle. One watt of standby on a meter should not make
 * the whole diagram twitch.
 */
export const DEFAULT_THRESHOLD = 1;

const SHAPE_BY_KIND: Record<NodeKind, NodeShape> = {
    source: 'circle',
    sink: 'circle',
    storage: 'rounded',
    grid: 'circle',
    bus: 'circle',
    label: 'rounded',
    image: 'square',
};

const SIZE_BY_SHAPE: Record<NodeShape, { w: number; h: number }> = {
    circle: { w: 92, h: 92 },
    rounded: { w: 124, h: 84 },
    square: { w: 92, h: 92 },
    // Wide and low: what is left of a node without a body is a line of text
    none: { w: 110, h: 56 },
};

/** A junction is only a routing point, so it is drawn far smaller than a real node */
const BUS_SIZE = { w: 18, h: 18 };

const ICON_BY_KIND: Record<NodeKind, string> = {
    source: 'solar',
    sink: 'house',
    storage: 'battery',
    grid: 'grid',
    bus: '',
    label: '',
    image: '',
};

/** From this width-to-height ratio on, a box has room beside its value rather than above it */
const WIDE_BOX = 1.4;

/**
 * Where a node's icon goes. A wide, low box -- a pill with a battery and "100 %" -- has no room above
 * the value: the icon would shrink to a speck and push the value to the bottom edge. Beside the value
 * it can be as large as the box is high.
 *
 * @param node the node
 * @returns `left` or `top`
 */
export function iconPlacement(node: FlowNode): 'top' | 'left' {
    if (node.iconPosition) {
        return node.iconPosition;
    }
    const shape = nodeShape(node);
    if (shape === 'circle') {
        return 'top';
    }
    const rect = nodeRect(node);
    return rect.w >= rect.h * WIDE_BOX ? 'left' : 'top';
}

/**
 * The shape a node is drawn in.
 *
 * @param node the node
 * @returns its shape
 */
export function nodeShape(node: FlowNode): NodeShape {
    return node.shape || SHAPE_BY_KIND[node.kind] || 'circle';
}

/**
 * The box a node occupies, in canvas units, with `x`/`y` at its top-left corner.
 *
 * The document stores the *centre* of a node, because that is what stays put when the user changes
 * its size or shape in the editor.
 *
 * @param node the node
 * @returns the rectangle
 */
export function nodeRect(node: FlowNode): Rect {
    const shape = nodeShape(node);
    const fallback = node.kind === 'bus' ? BUS_SIZE : SIZE_BY_SHAPE[shape];
    const w = node.w ?? fallback.w;
    const h = node.h ?? (shape === 'circle' ? w : fallback.h);
    return { x: node.x - w / 2, y: node.y - h / 2, w, h };
}

/**
 * The icon a node shows when it does not name one.
 *
 * @param kind the node kind
 * @returns the name of a built-in icon, or an empty string
 */
export function defaultIcon(kind: NodeKind): string {
    return ICON_BY_KIND[kind] || '';
}

/**
 * The animation settings in effect, document defaults merged over the built-in ones.
 *
 * @param config the diagram
 * @returns fully populated animation settings
 */
export function animationSettings(config: EnergyFlowConfig): Required<AnimationSettings> {
    return { ...DEFAULT_ANIMATION, ...(config.defaults?.animation || {}) };
}

/**
 * The line width of an edge.
 *
 * @param edge the edge
 * @param config the diagram it belongs to
 * @returns the width in canvas units
 */
export function edgeWidth(edge: FlowEdge, config: EnergyFlowConfig): number {
    return edge.width ?? config.defaults?.lineWidth ?? DEFAULT_LINE_WIDTH;
}

/**
 * The label size of a diagram: node labels and connection values.
 *
 * Derived from the value font size unless set, because the canvas is a coordinate system and not
 * pixels: a fixed 13 looks right on the 900-unit templates and turns into specks on a 1500-unit one.
 *
 * @param config the diagram
 * @returns the size in canvas units
 */
export function pageLabelSize(config: EnergyFlowConfig): number {
    const size = config.defaults?.labelSize;
    if (typeof size === 'number' && size > 0) {
        return size;
    }
    return Math.round((config.defaults?.fontSize ?? DEFAULT_FONT_SIZE) * 0.75);
}

/**
 * The size of one node's label: the diagram's, scaled by the node's `labelScale`.
 *
 * @param node the node
 * @param config the diagram it belongs to
 * @returns the size in canvas units, to one decimal
 */
export function nodeLabelSize(node: FlowNode, config: EnergyFlowConfig): number {
    const scale = typeof node.labelScale === 'number' && node.labelScale > 0 ? node.labelScale : 1;
    return Math.round(pageLabelSize(config) * scale * 10) / 10;
}

/**
 * The value below which an edge counts as idle.
 *
 * @param edge the edge
 * @returns the threshold
 */
export function edgeThreshold(edge: FlowEdge): number {
    return edge.threshold ?? DEFAULT_THRESHOLD;
}

/**
 * An empty diagram, used when a widget has not been configured yet.
 *
 * @returns a valid, empty document
 */
export function emptyConfig(): EnergyFlowConfig {
    return { v: 1, canvas: { ...DEFAULT_CANVAS }, nodes: [], edges: [] };
}

/**
 * Accept whatever the host hands over and make it renderable.
 *
 * Widget data survives adapter updates, hand edits and copy-paste between views, so this must cope
 * with a string that contains JSON, with a half-written document and with `undefined`, and always
 * return something the renderer can draw.
 *
 * @param raw the stored configuration
 * @returns a document with the required fields present
 */
export function normalizeConfig(raw: unknown): EnergyFlowConfig {
    let parsed: unknown = raw;

    if (typeof raw === 'string') {
        if (!raw.trim()) {
            return emptyConfig();
        }
        try {
            parsed = JSON.parse(raw);
        } catch {
            return emptyConfig();
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        return emptyConfig();
    }

    const config = parsed as Partial<EnergyFlowConfig>;
    const canvas = config.canvas || ({} as Partial<EnergyFlowCanvas>);

    return {
        v: 1,
        canvas: {
            w: typeof canvas.w === 'number' && canvas.w > 0 ? canvas.w : DEFAULT_CANVAS.w,
            h: typeof canvas.h === 'number' && canvas.h > 0 ? canvas.h : DEFAULT_CANVAS.h,
            background: canvas.background,
            grid: canvas.grid ?? DEFAULT_CANVAS.grid,
        },
        nodes: Array.isArray(config.nodes) ? config.nodes.filter(node => node && typeof node.id === 'string') : [],
        // An edge whose endpoints do not exist would throw during layout, and a diagram that was
        // half-edited by hand is exactly when the user needs to see the rest of it
        edges: Array.isArray(config.edges)
            ? config.edges.filter(edge => edge && typeof edge.id === 'string' && edge.from && edge.to)
            : [],
        defaults: config.defaults,
    };
}
