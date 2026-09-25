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
    nodeLabelSize,
    nodeRect,
    nodeShape,
    pageLabelSize,
} from './defaults';
import { anchorOf, edgeGeometry, offsetFromLine, type EdgeGeometry } from './geometry';
import {
    amountUnit,
    formatTimestamp,
    formatValue,
    mergeFormat,
    textWidth,
    unitScale,
    type FormattedValue,
} from './format';
import { sourceMax, sourceUnit, type MaxGetter, type UnitGetter } from './units';
import { HISTORY_PERIODS, sparklinePaths, type HistoryGetter } from './history';
import { autarky, firstMatchingRule, rawText, scaleColor, selfConsumption } from './rules';
import { mediumOf } from './media';
import { diagramStyle, styledTheme } from './styles';
import { hasTemplate, renderTemplate } from './template';
import { computeHydraulics, hydraulicNodes, type HydraulicFlow } from './hydraulics';
import { resolveSrc, srcOids, type TimeGetter, type ValueGetter } from './values';
import { muteColor, type FlowTheme } from './theme';
import type { AnimationSettings, FlowConfig, FlowEdge, FlowNode, NodeKind, NodeShape, Point, Rect } from './types';

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
    /**
     * The level an icon that can show one draws -- the battery's charge: the state of charge, or the
     * value itself when that is a percentage. Null draws the icon's fixed picture.
     */
    iconLevel: number | null;
    /**
     * How full the body is drawn, 0..100: the state of charge, or the value against `levelMax`; null
     * for no fill
     */
    level: number | null;
    fontSize: number;
    /** The caption of a `label` node, with its placeholders filled in */
    text: string;
    /** Size of the label below the node -- the diagram's label size times the node's `labelScale` */
    labelFontSize: number;
    /** When the value last changed or was updated, written out; null when not asked for or unknown */
    timeText: string | null;
    /** The chart of the value's recent past, as paths in canvas units; null for none */
    chart: { line: string; area: string } | null;
    /** No update for longer than `staleAfter`: drawn dimmed, so a hanging adapter is visible */
    stale: boolean;
    /** A rule asks for attention */
    blink: boolean;
    visible: boolean;
}

export interface EdgeRuntime {
    edge: FlowEdge;
    /**
     * Oriented along `from` -> `to`: positive runs that way, negative the other. In the base unit
     * (`baseUnit`), so a meter in kW and one in W can be compared, summed and animated alike.
     */
    value: number | null;
    magnitude: number;
    /** The unit `value` is in: the base of the edge's unit, `W` for a meter reporting `kW` */
    baseUnit: string;
    direction: 1 | -1 | 0;
    /** Above the threshold, so the line is coloured and animated */
    active: boolean;
    color: string;
    /** Whether the colour comes from the nodes, and so follows their rules and colour scales */
    inheritsColor: boolean;
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
    config: FlowConfig;
    nodes: NodeRuntime[];
    nodeById: Record<string, NodeRuntime>;
    edges: EdgeRuntime[];
    animation: Required<AnimationSettings>;
    /**
     * The diagram's label size, in canvas units: the values on the connections use it as it is, the
     * node labels scaled per node (`NodeRuntime.labelFontSize`). See `pageLabelSize`.
     */
    labelFontSize: number;
}

/**
 * Whether a diagram has to be redrawn as time passes, not only when a state changes: for "12 minutes
 * ago", and for values that turn stale by getting old.
 *
 * @param config the diagram
 * @returns true when the host should keep a clock running
 */
export function needsClock(config: FlowConfig): boolean {
    return !!config.defaults?.staleAfter || (config.nodes || []).some(node => node.timestamp || node.staleAfter);
}

/** What else the runtime can use besides the values */
export interface RuntimeOptions {
    /** The units of the state objects; without them the diagram's default unit applies */
    units?: UnitGetter;
    /** The declared maxima of the state objects; a node without a `levelMax` of its own fills against them */
    maxima?: MaxGetter;
    /** When the states were written and changed, for nodes that show it */
    times?: TimeGetter;
    /** The present, for "12 minutes ago"; defaults to the clock */
    now?: number;
    /** Recorded values, for nodes that draw a chart */
    history?: HistoryGetter;
    /** The raw state values, for nodes that show text and for rules that compare text */
    raw?: (oid: string) => unknown;
    /** Today's energy per state (state unit times hours), for nodes that show it */
    energy?: (oid: string) => number | undefined;
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
 *
 * `null` is "it flows, how much nobody knows", which is what a worked-out line says when nothing in
 * the installation measures litres. There is no speed to derive then, so it runs at the reference
 * one: a line that is alive has to move, or the whole point of working the flow out is lost.
 */
function dotDuration(magnitude: number | null, animation: Required<AnimationSettings>): number {
    if (!animation.enabled) {
        return 0;
    }
    if (magnitude === null) {
        return animation.refDuration;
    }
    if (magnitude <= 0) {
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
 * The unit a derived node shows: the base unit its connections agree on. Connections in `kW` and in
 * `W` agree -- both are watts once they are in their base unit -- so a house fed by a kW battery and
 * a W inverter shows its sum in watts, scaled for reading as any other value.
 *
 * @param id the node
 * @param edges the already resolved connections
 * @returns the shared base unit, or undefined when they disagree or none is known
 */
function commonEdgeUnit(id: string, edges: EdgeRuntime[]): string | undefined {
    let found: string | undefined;
    for (const edge of edges) {
        if (edge.value === null || (edge.edge.from !== id && edge.edge.to !== id)) {
            continue;
        }
        if (!edge.baseUnit || (found !== undefined && found !== edge.baseUnit)) {
            return undefined;
        }
        found = edge.baseUnit;
    }
    return found;
}

/**
 * Resolve a document against the current state values.
 *
 * The order matters: the node boxes have to exist before the edges can be routed between them, and
 * the edges have to carry values before a node without a source of its own can derive one from them.
 *
 * @param config the diagram
 * @param get reads a state value
 * @param hostTheme supplies the default colours, before the diagram's style adjusts them
 * @param options units and times of the states, see {@link RuntimeOptions}
 * @returns everything the renderer draws
 */
export function computeRuntime(
    config: FlowConfig,
    get: ValueGetter,
    hostTheme: FlowTheme,
    options: RuntimeOptions = {},
): FlowRuntime {
    // The diagram's style adjusts the host theme; node and line colours come from the adjusted one,
    // which is also the one the renderer draws with
    const theme = styledTheme(hostTheme, config);
    // The same style the renderer draws with: it decides one thing here, how thick a line is
    const look = diagramStyle(config);
    const { units, maxima, times, history, raw, energy } = options;
    const chipLabels = config.defaults?.edgeLabel === 'chip';
    const medium = mediumOf(config);
    const now = options.now ?? Date.now();
    const animation = animationSettings(config);
    const documentFormat = config.defaults;
    const defaultFontSize = config.defaults?.fontSize ?? DEFAULT_FONT_SIZE;
    const labelFontSize = pageLabelSize(config);

    // Step 1: the geometry and the appearance of the nodes. The values are filled in below, once the
    // edges are known -- `visible` is left true so that the edge pass can route between all of them.
    const nodes: NodeRuntime[] = (config.nodes || []).map(node => ({
        node,
        rect: nodeRect(node),
        shape: nodeShape(node),
        color: node.color || theme.kinds[node.kind] || theme.text,
        // `undefined` takes the icon of the kind, `''` means the user removed it
        icon: node.icon === undefined ? defaultIcon(node.kind, config) : node.icon,
        value: null,
        valueText: formatValue(null, {}),
        badges: [],
        soc: null,
        iconLevel: null,
        level: null,
        fontSize: node.fontSize ?? defaultFontSize,
        labelFontSize: nodeLabelSize(node, config),
        text: '',
        timeText: null,
        chart: null,
        stale: false,
        blink: false,
        visible: true,
    }));

    const nodeById: Record<string, NodeRuntime> = {};
    for (const node of nodes) {
        nodeById[node.node.id] = node;
    }

    // Step 2: the edges
    const edges: EdgeRuntime[] = [];

    /**
     * Step 1.5: what carries something, worked out from the elements. Only for a diagram that asks
     * for it, and only for the lines that have no reading of their own -- a metered line always says
     * what it says.
     */
    const hydraulics: Map<string, HydraulicFlow> = config.defaults?.hydraulics
        ? computeHydraulics(
              config,
              hydraulicNodes(config, get, node => node.unit || sourceUnit(node.value, units)),
              documentFormat?.unit,
          )
        : new Map();

    for (const edge of config.edges || []) {
        const fromNode = nodeById[edge.from];
        const toNode = nodeById[edge.to];
        // An edge to a node that was deleted is skipped rather than fatal -- a half-edited document
        // must still draw the parts that are intact
        if (!fromNode || !toNode) {
            continue;
        }

        // The number as the state delivers it, and what it is in: the edge's own unit, else the
        // object's, else the diagram's
        const unit =
            edge.unit || sourceUnit(edge.value, units) || sourceUnit(edge.reverse, units) || documentFormat?.unit;
        const scale = unitScale(unit);
        const reading = edgeValue(edge, get);
        // A line without a reading of its own takes what the elements around it imply
        const worked = reading === null ? hydraulics.get(edge.id) : undefined;
        // A line the model left out is known to be still: zero, not the placeholder, which would
        // claim nobody knows. That is what makes the pipe where the two halves of a ring meet
        // readable -- and it is the same answer for a whole plant whose pump stands, which must not
        // read differently from one dead pipe in a ring
        const still = reading === null && !worked && !!config.defaults?.hydraulics;
        // From here on in the base unit: the threshold, the dot speed and the sums of the nodes all
        // compare this edge with others that may be metered in another multiple
        const own = reading === null ? null : reading * scale.factor;
        const value =
            own === null && worked?.value !== undefined && worked.value !== null
                ? worked.value * scale.factor * worked.direction
                : still
                  ? 0
                  : own;
        const magnitude = value === null ? 0 : Math.abs(value);
        const threshold = edgeThreshold(edge, config);
        // "Flows, amount unknown": the line is alive although no number reached it
        const active = magnitude > threshold || (value === null && !!worked?.live);
        const direction: 1 | -1 | 0 =
            value === null ? (worked?.live ? worked.direction : 0) : !active ? 0 : value > 0 ? 1 : -1;

        const fromCenter = { x: fromNode.rect.x + fromNode.rect.w / 2, y: fromNode.rect.y + fromNode.rect.h / 2 };
        const toCenter = { x: toNode.rect.x + toNode.rect.w / 2, y: toNode.rect.y + toNode.rect.h / 2 };

        // With waypoints the anchor should face the first/last waypoint, not the other node --
        // otherwise a deliberately routed line leaves in the wrong direction and doubles back
        const firstTarget = edge.waypoints?.length ? edge.waypoints[0] : toCenter;
        const lastTarget = edge.waypoints?.length ? edge.waypoints[edge.waypoints.length - 1] : fromCenter;

        const fromAnchor = anchorOf(fromNode.rect, fromNode.shape, edge.fromSide, firstTarget);
        const toAnchor = anchorOf(toNode.rect, toNode.shape, edge.toSide, lastTarget);

        const geometry = edgeGeometry(
            fromAnchor,
            toAnchor,
            edge.curve || 'bezier',
            edge.waypoints,
            undefined,
            edge.bend,
        );

        /**
         * An unconfigured edge takes the colour of wherever the energy is coming from. That single
         * rule is what makes a diagram readable straight after adding a line: sun-coloured towards
         * the house, battery-coloured back out of it, grey from the grid. The predecessor asks for a
         * colour per animation and per line separately.
         */
        const forwardColor = edge.color || fromNode.color;
        const reverseColor = edge.colorReverse || edge.color || toNode.color;
        const litColor = direction < 0 ? reverseColor : forwardColor;

        const format = { ...mergeFormat(edge, documentFormat), unit };
        // A word instead of the amount, where the line names one for its state: the source that is
        // actually showing, and only if it is a single state -- a formula is a number by
        // construction. The number keeps its work: direction, threshold, and the speed of the dots
        const shownSrc = direction < 0 && edge.reverse ? edge.reverse : edge.value;
        const edgeOids = edge.textMap ? srcOids(shownSrc) : [];
        const rawEdge = edgeOids.length === 1 && options.raw ? options.raw(edgeOids[0]) : undefined;
        const edgeWord = rawEdge === undefined || rawEdge === null ? undefined : edge.textMap?.[rawText(rawEdge)];
        // The label always shows the amount, never the sign -- the direction is already visible
        // in which way the dots move, and "-2.4 kW" next to an arrow pointing left reads wrong
        const valueText =
            edgeWord !== undefined
                ? { text: edgeWord, number: edgeWord, unit: '' }
                : formatValue(value === null ? null : magnitude / scale.factor, {
                      ...format,
                      locale: theme.locale,
                  });
        // Far enough from the line that the text clears it and the arrow on it: beside a vertical
        // line that is half the text's width, above a horizontal one half its height. A chip brings
        // its own background, so it sits on the line instead of next to it.
        const normal = { x: Math.abs(geometry.midDir.y), y: Math.abs(geometry.midDir.x) };
        const labelDistance = chipLabels
            ? 0
            : Math.max(
                  labelFontSize + 5,
                  normal.x * (textWidth(valueText.text, labelFontSize, true) / 2) + normal.y * labelFontSize * 0.6 + 12,
              );

        edges.push({
            edge,
            value,
            magnitude,
            baseUnit: scale.base,
            direction,
            active,
            color: active ? litColor : muteColor(litColor, theme),
            inheritsColor: !edge.color && !(direction < 0 && edge.colorReverse),
            width: edgeWidth(edge, config) * look.lineScale,
            geometry,
            valueText,
            labelPos: offsetFromLine(geometry.mid, geometry.midDir, labelDistance),
            dotDuration: active ? dotDuration(value === null ? null : magnitude, animation) : 0,
            // Filled in below: whether an edge is drawn depends on whether its nodes are, and that
            // depends on values this pass does not have yet
            visible: !(edge.hideWhenIdle && !active),
        });
    }

    // Step 3: the node values -- the node's own source if it has one, otherwise the sum of its edges
    for (const runtime of nodes) {
        const node = runtime.node;

        // The caption of a label node. Its placeholders read states, so it is filled in here, where
        // the values, the times and the units already are
        const caption = node.text ?? '';
        runtime.text = hasTemplate(caption)
            ? renderTemplate(caption, {
                  own: srcOids(node.value)[0],
                  raw: options.raw,
                  times,
                  units,
                  locale: theme.locale,
                  now,
              })
            : caption;
        const own = resolveSrc(node.value, get);
        let value: number | null;
        let unit: string | undefined;
        if (own !== null) {
            unit =
                node.unit ||
                sourceUnit(node.value, units) ||
                (node.kind === 'storage' ? medium.storageUnit : undefined) ||
                documentFormat?.unit;
            value = own * unitScale(unit).factor;
        } else {
            // Derived values are sums of edges, which are all in their base unit already
            value = deriveNodeValue(node.id, node.kind, edges);
            unit = node.unit || commonEdgeUnit(node.id, edges) || documentFormat?.unit;
        }
        const scale = unitScale(unit);
        // "Same as the value": the number as the node shows it, before the prefix scaling
        const shown = (): number | null => (value === null ? null : value / scale.factor);
        const socRaw = resolveSrc(node.soc, get, shown);

        runtime.value = value;
        runtime.valueText = formatValue(value === null ? null : value / scale.factor, {
            ...mergeFormat(node, documentFormat),
            unit,
            locale: theme.locale,
        });
        runtime.badges = (node.badges || []).map(badge => {
            // A switch rather than a number: the word for the raw value, where the badge names one.
            // Only a single state has a raw value -- a formula is a number by construction
            const oids = badge.textMap ? srcOids(badge.src) : [];
            const rawBadge = oids.length === 1 && raw ? raw(oids[0]) : undefined;
            const word = rawBadge === undefined || rawBadge === null ? undefined : badge.textMap?.[rawText(rawBadge)];
            return {
                label: badge.label,
                text:
                    word ??
                    formatValue(resolveSrc(badge.src, get, shown), {
                        ...mergeFormat(badge, documentFormat, sourceUnit(badge.src, units)),
                        locale: theme.locale,
                    }).text,
            };
        });
        runtime.soc = socRaw === null ? null : Math.min(Math.max(socRaw, 0), 100);
        // The amount, not the sign: a grid node exporting 900 W is as "full" as one importing 900 W
        const shownValue = shown();
        // A value in percent is a level in its own right: a battery node that shows "98 %" must not
        // have an icon that looks almost empty
        const percent = unit?.trim() === '%' && shownValue !== null ? Math.min(Math.max(shownValue, 0), 100) : null;
        runtime.iconLevel = runtime.soc ?? percent;
        // What the node fills against: its own maximum, else the one the state object declares
        // (`common.max`), converted into the unit the value is shown in -- a meter in kW declares its
        // maximum in kW. An explicit 0 is "no fill"; a storage fills with its charge instead.
        let levelMax = node.levelMax;
        if (levelMax === undefined && node.kind !== 'storage') {
            const declared = sourceMax(node.value, maxima);
            const declaredUnit = declared === undefined ? undefined : sourceUnit(node.value, units);
            const declaredScale = declaredUnit ? unitScale(declaredUnit) : undefined;
            levelMax =
                declared !== undefined && declaredScale?.base === scale.base
                    ? (declared * declaredScale.factor) / scale.factor
                    : declared;
        }
        runtime.level =
            runtime.soc ??
            (levelMax && levelMax > 0 && shownValue !== null
                ? Math.min((Math.abs(shownValue) / levelMax) * 100, 100)
                : node.kind === 'storage'
                  ? percent
                  : null);
        if (node.history && history && node.value && 'oid' in node.value && node.value.oid) {
            const recorded = history(node.value.oid, node.history);
            if (recorded?.length) {
                // Through the source's own rescaling, so the chart shows what the value shows
                const scaled = recorded
                    .map(point => ({ ts: point.ts, val: resolveSrc(node.value, () => point.val) }))
                    .filter((point): point is { ts: number; val: number } => point.val !== null);
                const { rect } = runtime;
                // The lower part of the body, under the value, where it does not compete with the text
                const box = { x: rect.x, y: rect.y + rect.h * 0.55, w: rect.w, h: rect.h * 0.45 };
                runtime.chart = sparklinePaths(scaled, box, now - HISTORY_PERIODS[node.history], now);
            }
        }
        if (node.timestamp && times) {
            // The most recent of the states behind the value: a formula changes when any of them does
            const field = node.timestamp;
            const latest = Math.max(0, ...srcOids(node.value).map(oid => times(oid)?.[field] ?? 0));
            runtime.timeText = latest > 0 ? formatTimestamp(latest, node.timestampFormat, now, theme.locale) : null;
        }
        // A word instead of a number: the raw state value, translated if the node says how
        const rawValue = node.value && 'oid' in node.value && node.value.oid && raw ? raw(node.value.oid) : undefined;
        const known = rawValue === undefined || rawValue === null ? undefined : rawValue;
        // A word the map names wins over the number whatever `display` says: the map is the user
        // saying what this value means, and a second field that quietly switches it off is a trap
        const word =
            known === undefined
                ? undefined
                : (node.textMap?.[rawText(known)] ??
                  // Text without a translation: a status string shows as it is, a number does not --
                  // a number has a proper format and "3" instead of "3,00 kW" is a step backwards
                  (node.display === 'text' && typeof known !== 'number' ? rawText(known) : undefined));
        if (node.display === 'none') {
            // Nothing where the number would be: the node is its symbol and its label
            runtime.valueText = { text: '', number: '', unit: '' };
        } else if (word !== undefined) {
            runtime.valueText = { text: word, number: word, unit: '' };
        }

        if (node.energyToday) {
            // Either the meter counts the day itself, or the history adapter integrates the value.
            // Both end in the base of an *amount*: Wh for a power, litres for a flow per minute.
            let amount: number | null = null;
            let amountIn = '';
            if (node.energyToday.src) {
                const counted = resolveSrc(node.energyToday.src, get, shown);
                if (counted !== null) {
                    const countedScale = unitScale(sourceUnit(node.energyToday.src, units) || medium.counterUnit);
                    amount = counted * countedScale.factor;
                    amountIn = countedScale.base;
                }
            } else if (energy && node.value && 'oid' in node.value && node.value.oid) {
                const today = energy(node.value.oid);
                // Integrated in the state's own unit; scaled into the base one, kW into W
                amount = today === undefined ? null : today * scale.factor;
                amountIn = amountUnit(scale.base || medium.unit);
            }
            if (amount !== null) {
                const text = formatValue(amount, {
                    unit: amountIn,
                    // Only energy climbs into the next prefix by itself -- nobody writes 5 kl where
                    // they mean five cubic metres
                    autoScale: amountIn.endsWith('Wh'),
                    locale: theme.locale,
                }).text;
                runtime.badges.push({ label: node.energyToday.label, text });
            }
        }

        // Dimmed when nothing arrived for too long -- an adapter that hangs keeps its last value, and
        // a diagram that shows it at full strength claims a present that is not there
        const staleAfter = node.staleAfter ?? documentFormat?.staleAfter;
        if (staleAfter && staleAfter > 0 && times) {
            const latest = Math.max(0, ...srcOids(node.value).map(oid => times(oid)?.ts ?? 0));
            runtime.stale = latest > 0 && now - latest > staleAfter * 60000;
        }

        if (node.colorScale) {
            runtime.color =
                scaleColor(resolveSrc(node.colorScale.src, get, shown), node.colorScale.min, node.colorScale.max) ??
                runtime.color;
        }

        // Rules last: they are the user's word on how the node looks, over every automatism. A text
        // node compares its raw value, every other one the number it shows
        const rule = firstMatchingRule(node.rules, node.display === 'text' ? rawValue : shown());
        if (rule) {
            runtime.color = rule.color || runtime.color;
            runtime.icon = rule.icon ?? runtime.icon;
            runtime.blink = !!rule.blink;
        }

        // A wallbox that is not plugged in, a generator that is off: hiding it is less noise than
        // showing a permanent "0 kW"
        runtime.visible = !(node.hideWhenZero && (value === null || value === 0));
    }

    // Step 3b: the key figures, which need every other node's value first. Production is what the
    // producers nothing else feeds show -- four MPPT strings and the box they feed must not count twice
    if (nodes.some(item => item.node.kpi)) {
        const fedBySource = new Set(
            (config.edges || []).filter(edge => nodeById[edge.from]?.node.kind === 'source').map(edge => edge.to),
        );
        const sum = (pick: (item: NodeRuntime) => boolean): number =>
            nodes.filter(pick).reduce((total, item) => total + (item.value ?? 0), 0);
        const balance = {
            production: sum(item => item.node.kind === 'source' && !fedBySource.has(item.node.id)),
            grid: sum(item => item.node.kind === 'grid'),
            storage: sum(item => item.node.kind === 'storage'),
        };
        for (const item of nodes) {
            if (!item.node.kpi) {
                continue;
            }
            const percent = item.node.kpi === 'autarky' ? autarky(balance) : selfConsumption(balance);
            item.value = percent;
            item.valueText = formatValue(percent, {
                unit: '%',
                decimals: item.node.decimals ?? 0,
                locale: theme.locale,
            });
        }
    }

    // Step 3c: lines that take their colour from a node follow what rules and colour scales did to it
    for (const edge of edges) {
        if (!edge.inheritsColor) {
            continue;
        }
        const fromNode = nodeById[edge.edge.from];
        const toNode = nodeById[edge.edge.to];
        const litColor = edge.direction < 0 ? toNode.color : fromNode.color;
        edge.color = edge.active ? litColor : muteColor(litColor, theme);
    }

    // Step 4: an edge to a hidden node is hidden with it, or it would end in mid-air
    for (const edge of edges) {
        edge.visible = edge.visible && nodeById[edge.edge.from].visible && nodeById[edge.edge.to].visible;
    }

    return { config, nodes, nodeById, edges, animation, labelFontSize };
}
