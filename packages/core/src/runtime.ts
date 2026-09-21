/**
 * Turning a document plus a set of state values into everything the renderer needs.
 *
 * One pure function, no React, no sockets: given the same configuration and the same values it
 * produces the same result. That is what lets the editor show a live preview of a diagram it is
 * still editing, and what makes the whole value/direction/colour logic testable without a browser.
 */
import {
    animationSettings,
    DEFAULT_FONT_SIZE,
    defaultIcon,
    edgeThreshold,
    edgeWidth,
    nodeRect,
    nodeShape,
} from './defaults';
import { anchorOf, edgeGeometry, offsetFromLine, type EdgeGeometry } from './geometry';
import { formatValue, mergeFormat, type FormattedValue } from './format';
import { resolveSrc, type ValueGetter } from './values';
import { muteColor, type EnergyFlowTheme } from './theme';
import type {
    AnimationSettings,
    EnergyFlowConfig,
    FlowEdge,
    FlowNode,
    NodeKind,
    NodeShape,
    Point,
    Rect,
} from './types';

export interface NodeBadgeRuntime {
    label?: string;
    text: string;
}

export interface NodeRuntime {
    node: FlowNode;
    rect: Rect;
    shape: NodeShape;
    /** Accent colour in effect */
    color: string;
    /** Name of a built-in icon, or a URL / data URI */
    icon: string;
    value: number | null;
    valueText: FormattedValue;
    badges: NodeBadgeRuntime[];
    /** State of charge in percent, clamped to 0..100; null when the node has none */
    soc: number | null;
    fontSize: number;
    visible: boolean;
}

export interface EdgeRuntime {
    edge: FlowEdge;
    /** Oriented along `from` -> `to`: positive runs that way, negative the other */
    value: number | null;
    magnitude: number;
    direction: 1 | -1 | 0;
    /** Above the threshold, so the line is coloured and animated */
    active: boolean;
    color: string;
    width: number;
    geometry: EdgeGeometry;
    valueText: FormattedValue;
    /** Where the value label goes, already pushed off the line */
    labelPos: Point;
    /** Seconds a dot needs to advance by one gap. 0 means: do not animate. */
    dotDuration: number;
    visible: boolean;
}

export interface FlowRuntime {
    config: EnergyFlowConfig;
    nodes: NodeRuntime[];
    nodeById: Record<string, NodeRuntime>;
    edges: EdgeRuntime[];
    animation: Required<AnimationSettings>;
    /**
     * Size of the secondary text -- node labels and edge values -- in canvas units.
     *
     * It is derived from the document's font size rather than fixed, because the canvas is a
     * coordinate system and not pixels: a fixed 13 looks right on the 900-unit templates and turns
     * into unreadable specks on a 1500-unit one.
     */
    labelFontSize: number;
}

/**
 * The signed flow of an edge, with `null` kept apart from zero.
 *
 * `split` subtracts the two states rather than picking the larger one: a meter pair that briefly
 * reports import *and* export during a phase change then shows the net, which is the physically
 * meaningful number, instead of flipping direction on noise.
 */
function edgeValue(edge: FlowEdge, get: ValueGetter): number | null {
    const mode = edge.mode || 'signed';

    if (mode === 'split') {
        const forward = resolveSrc(edge.value, get);
        const reverse = resolveSrc(edge.reverse, get);
        if (forward === null && reverse === null) {
            return null;
        }
        return (forward || 0) - (reverse || 0);
    }

    const value = resolveSrc(edge.value, get);
    if (value === null) {
        return null;
    }
    if (mode === 'positive') {
        // A meter that only ever measures one direction still dips below zero on rounding
        return value < 0 ? 0 : value;
    }
    return value;
}

/**
 * How fast the dots travel.
 *
 * Speed is proportional to power, which is the whole point of the animation -- a glance at the
 * diagram should say how much is flowing, not just that something is. The clamp keeps a 20 kW
 * charging session from turning into a blur and a 30 W trickle from looking frozen.
 */
function dotDuration(magnitude: number, animation: Required<AnimationSettings>): number {
    if (!animation.enabled || magnitude <= 0) {
        return 0;
    }
    const raw = (animation.refDuration * animation.refPower) / magnitude;
    return Math.min(Math.max(raw, animation.minDuration), animation.maxDuration);
}

/**
 * What a node shows when nothing is bound to it: what its connections carry.
 *
 * This is the reason a template needs three state ids and not seven. The power a PV array produces is
 * the power flowing out of the PV node -- asking the user to bind the same state to the node *and* to
 * the line, as the predecessor does, is asking them to keep two copies of one number in step.
 *
 * Which sum is the meaningful one depends on what the node is, and the difference only shows up once a
 * node has flows in **both** directions -- four MPPT strings feeding one "production" box, say:
 *
 * - `source` -- what leaves it. That is its production, whether it is fed by sub-producers or not;
 *   the net would be the conversion loss, which is not what the box is called.
 * - `sink` -- the net of what arrives. A house fed 6.4 kW from the roof and 0.9 kW from the grid while
 *   2.1 kW go off into the battery is consuming 5.2 kW, not 7.3 kW.
 * - `grid` and `storage` -- the net, counted as an outflow, because for these two the *sign* is the
 *   information: "Netz 900 W" means 900 W are being drawn, a negative battery is charging.
 * - `bus` -- what passes through, which for a junction is what arrives.
 *
 * Returns null when no connected edge has a value, so an unconfigured diagram shows placeholders
 * rather than a confident "0 W".
 *
 * @param id the node
 * @param kind decides which of the sums is the meaningful one
 * @param edges the already resolved connections
 * @returns the value, or null if nothing connected is known
 */
function deriveNodeValue(id: string, kind: NodeKind, edges: EdgeRuntime[]): number | null {
    let known = false;
    /** Signed sum of everything arriving; negative means more leaves than arrives */
    let netIn = 0;
    /** Only the parts that really arrive */
    let grossIn = 0;
    /** Only the parts that really leave */
    let grossOut = 0;

    for (const edge of edges) {
        if (edge.value === null) {
            continue;
        }
        // `value` is oriented along from -> to, so it arrives at `to` and leaves `from`
        let inflow: number;
        if (edge.edge.to === id) {
            inflow = edge.value;
        } else if (edge.edge.from === id) {
            inflow = -edge.value;
        } else {
            continue;
        }
        known = true;
        netIn += inflow;
        if (inflow > 0) {
            grossIn += inflow;
        } else {
            grossOut -= inflow;
        }
    }

    if (!known) {
        return null;
    }

    switch (kind) {
        case 'source':
            return grossOut;
        case 'grid':
        case 'storage':
            return -netIn;
        case 'bus':
            return grossIn;
        default:
            return netIn;
    }
}

/**
 * Resolve a document against the current state values.
 *
 * The order matters: the node boxes have to exist before the edges can be routed between them, and
 * the edges have to carry values before a node without a source of its own can derive one from them.
 *
 * @param config the diagram
 * @param get reads a state value
 * @param theme supplies the default colours
 * @returns everything the renderer draws
 */
export function computeRuntime(config: EnergyFlowConfig, get: ValueGetter, theme: EnergyFlowTheme): FlowRuntime {
    const animation = animationSettings(config);
    const documentFormat = config.defaults;
    const defaultFontSize = config.defaults?.fontSize ?? DEFAULT_FONT_SIZE;
    const labelFontSize = Math.round(defaultFontSize * 0.75);

    // Step 1: the geometry and the appearance of the nodes. The values are filled in below, once the
    // edges are known -- `visible` is left true so that the edge pass can route between all of them.
    const nodes: NodeRuntime[] = (config.nodes || []).map(node => ({
        node,
        rect: nodeRect(node),
        shape: nodeShape(node),
        color: node.color || theme.kinds[node.kind] || theme.text,
        // `undefined` takes the icon of the kind, `''` means the user removed it
        icon: node.icon === undefined ? defaultIcon(node.kind) : node.icon,
        value: null,
        valueText: formatValue(null, {}),
        badges: [],
        soc: null,
        fontSize: node.fontSize ?? defaultFontSize,
        visible: true,
    }));

    const nodeById: Record<string, NodeRuntime> = {};
    for (const node of nodes) {
        nodeById[node.node.id] = node;
    }

    // Step 2: the edges
    const edges: EdgeRuntime[] = [];

    for (const edge of config.edges || []) {
        const fromNode = nodeById[edge.from];
        const toNode = nodeById[edge.to];
        // An edge to a node that was deleted is skipped rather than fatal -- a half-edited document
        // must still draw the parts that are intact
        if (!fromNode || !toNode) {
            continue;
        }

        const value = edgeValue(edge, get);
        const magnitude = value === null ? 0 : Math.abs(value);
        const threshold = edgeThreshold(edge);
        const active = magnitude > threshold;
        const direction: 1 | -1 | 0 = !active || value === null ? 0 : value > 0 ? 1 : -1;

        const fromCenter = { x: fromNode.rect.x + fromNode.rect.w / 2, y: fromNode.rect.y + fromNode.rect.h / 2 };
        const toCenter = { x: toNode.rect.x + toNode.rect.w / 2, y: toNode.rect.y + toNode.rect.h / 2 };

        // With waypoints the anchor should face the first/last waypoint, not the other node --
        // otherwise a deliberately routed line leaves in the wrong direction and doubles back
        const firstTarget = edge.waypoints?.length ? edge.waypoints[0] : toCenter;
        const lastTarget = edge.waypoints?.length ? edge.waypoints[edge.waypoints.length - 1] : fromCenter;

        const fromAnchor = anchorOf(fromNode.rect, fromNode.shape, edge.fromSide, firstTarget);
        const toAnchor = anchorOf(toNode.rect, toNode.shape, edge.toSide, lastTarget);

        const geometry = edgeGeometry(fromAnchor, toAnchor, edge.curve || 'bezier', edge.waypoints);

        /**
         * An unconfigured edge takes the colour of wherever the energy is coming from. That single
         * rule is what makes a diagram readable straight after adding a line: sun-coloured towards
         * the house, battery-coloured back out of it, grey from the grid. The predecessor asks for a
         * colour per animation and per line separately.
         */
        const forwardColor = edge.color || fromNode.color;
        const reverseColor = edge.colorReverse || edge.color || toNode.color;
        const litColor = direction < 0 ? reverseColor : forwardColor;

        const format = mergeFormat(edge, documentFormat);

        edges.push({
            edge,
            value,
            magnitude,
            direction,
            active,
            color: active ? litColor : muteColor(litColor, theme),
            width: edgeWidth(edge, config),
            geometry,
            // The label always shows the amount, never the sign -- the direction is already visible
            // in which way the dots move, and "-2.4 kW" next to an arrow pointing left reads wrong
            valueText: formatValue(value === null ? null : magnitude, { ...format, locale: theme.locale }),
            labelPos: offsetFromLine(geometry.mid, geometry.midDir, labelFontSize + 5),
            dotDuration: active ? dotDuration(magnitude, animation) : 0,
            // Filled in below: whether an edge is drawn depends on whether its nodes are, and that
            // depends on values this pass does not have yet
            visible: !(edge.hideWhenIdle && !active),
        });
    }

    // Step 3: the node values -- the node's own source if it has one, otherwise the sum of its edges
    for (const runtime of nodes) {
        const node = runtime.node;
        const own = resolveSrc(node.value, get);
        const value = own ?? deriveNodeValue(node.id, node.kind, edges);
        const format = mergeFormat(node, documentFormat);
        const socRaw = resolveSrc(node.soc, get);

        runtime.value = value;
        runtime.valueText = formatValue(value, { ...format, locale: theme.locale });
        runtime.badges = (node.badges || []).map(badge => ({
            label: badge.label,
            text: formatValue(resolveSrc(badge.src, get), {
                ...mergeFormat(badge, documentFormat),
                locale: theme.locale,
            }).text,
        }));
        runtime.soc = socRaw === null ? null : Math.min(Math.max(socRaw, 0), 100);
        // A wallbox that is not plugged in, a generator that is off: hiding it is less noise than
        // showing a permanent "0 kW"
        runtime.visible = !(node.hideWhenZero && (value === null || value === 0));
    }

    // Step 4: an edge to a hidden node is hidden with it, or it would end in mid-air
    for (const edge of edges) {
        edge.visible = edge.visible && nodeById[edge.edge.from].visible && nodeById[edge.edge.to].visible;
    }

    return { config, nodes, nodeById, edges, animation, labelFontSize };
}
