/**
 * Reading a configuration of `iobroker.energiefluss-erweitert`.
 *
 * The two formats describe the same picture in incompatible ways, and the conversion is mostly about
 * one gap: **there are no nodes over there**. What a user sees as "the battery box" is four unrelated
 * elements that happen to overlap -- a `rect` for the frame, an `icon`, a `text` for the name and a
 * `text` of subType `datasource` for the number. Nothing in the document says they belong together.
 *
 * What *is* explicit is the graph, and from an unexpected place: a connection is stored under the key
 * `path_<a>_<b>`, where `a` and `b` are the element ids of the two rectangles it runs between. So the
 * importer takes the rectangles named in those keys as the nodes, and assigns every other element to
 * the node whose box contains it. That reproduces what the eye does.
 *
 * Everything it cannot carry over is reported rather than dropped silently -- see {@link ImportResult}.
 */
import { DEFAULT_CANVAS } from './defaults';
import { isSrcExpr, isSrcState } from './types';
import type { FlowConfig, FlowEdge, FlowNode, NodeKind, Point, Rect, Side, Src } from './types';

// ---------------------------------------------------------------------------
// The shape of the source document
// ---------------------------------------------------------------------------

/** One entry of `datasources`, keyed by a numeric index that the elements refer to */
interface EfDatasource {
    source?: string;
}

interface EfElement {
    type?: string;
    subType?: string;
    id?: number;
    pos_x?: number;
    pos_y?: number;
    width?: number;
    height?: number;
    rx?: number;
    radius?: number;
    /** Index into `datasources`, or -1 */
    source?: number;
    /** Further datasource indices, added to / subtracted from `source` */
    add?: number[];
    subtract?: number[];
    text?: string;
    unit?: string;
    decimal_places?: number;
    threshold?: number;
    convert?: boolean;
    calculate_kw?: string | boolean;
    source_display?: string;
    /** Show the time of the last update (`ts`): -1 for none, else a format name */
    source_option?: string | number;
    /** Show the time of the last change (`lc`), same values */
    source_option_lc?: string | number;
    /** Stroke colour of a rect, text colour of a text */
    color?: string;
    fill?: string;
    font_size?: number;
    /** Iconify name, e.g. `mdi:solar-panel` */
    icon?: string;
    action?: string;
    url?: string;
}

interface EfDef {
    id?: string;
    d?: string;
    startSlot?: string;
    endSlot?: string;
}

interface EfLine {
    href?: string;
    color?: string;
}

interface EfAnimation {
    href?: string;
    color?: string;
    threshold?: number;
    source?: number;
    animation_properties?: string;
}

export interface EnergieflussDocument {
    basic?: { width?: number; height?: number; background_color?: string };
    elements?: Record<string, EfElement>;
    defs?: Record<string, EfDef>;
    lines?: Record<string, EfLine>;
    animations?: Record<string, EfAnimation>;
    datasources?: Record<string, EfDatasource>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type ImportWarningCode =
    /** An icon that has no counterpart in this widget's set */
    | 'icon-unmapped'
    /** `calculate_kw: 'none'`, which hides the unit in the original -- here the state's unit shows */
    | 'unit-blanked'
    /** A click action the original supports and this does not */
    | 'action-dropped'
    /** A value element that sits inside no box, so it became a node of its own */
    | 'orphan-value'
    /** The element shows something other than the state's value (a timestamp, say) */
    | 'display-mode'
    /** A connection whose two ends are not both real elements */
    | 'edge-dropped'
    /** Per-element CSS, which has no equivalent */
    | 'css-dropped'
    /** An image element */
    | 'image-dropped';

export interface ImportWarning {
    code: ImportWarningCode;
    /** Element or connection the warning is about */
    ref: string;
    /** English sentence, specific enough to act on -- for logs and tests */
    detail: string;
    /**
     * The values the sentence names, in order. A user interface builds its own sentence from `code`
     * and these, in the user's language, instead of showing `detail`.
     */
    args: string[];
}

export interface ImportResult {
    config: FlowConfig;
    warnings: ImportWarning[];
    stats: {
        nodes: number;
        edges: number;
        /** How many state ids were carried over */
        bindings: number;
        /** Elements that were folded into a node rather than becoming one */
        merged: number;
    };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Whether a parsed JSON value looks like an `energiefluss-erweitert` configuration.
 *
 * Used by the paste dialog to decide what it was handed. The test is `elements` plus one of the other
 * collections, because `elements` alone is too generic a key to claim a format on.
 *
 * @param value the parsed JSON
 * @returns true if it should be run through {@link importEnergiefluss}
 */
export function isEnergiefluss(value: unknown): value is EnergieflussDocument {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const document = value as EnergieflussDocument;
    if (!document.elements || typeof document.elements !== 'object') {
        return false;
    }
    return !!(document.defs || document.datasources || document.animations || document.lines);
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Iconify names of the original mapped onto this widget's set.
 *
 * Matched by keyword, not by exact name, and that is the whole point: the original lets the user pick
 * from every Iconify collection, so the names are long-tail -- `mdi:house-city`,
 * `mdi:electricity-from-grid`, `material-symbols:electric-car`. A lookup table of exact names misses
 * most of them; a keyword hits the family.
 *
 * The order matters. `electric-car` has to reach `car` before any rule about electricity claims it,
 * and `electricity-from-grid` has to reach `grid` first for the same reason.
 */
const ICON_PATTERNS: { pattern: RegExp; icon: string }[] = [
    { pattern: /solar|photovolt/, icon: 'solar' },
    { pattern: /sunny|weather-sun/, icon: 'sun' },
    { pattern: /wind-turbine|windmill/, icon: 'wind' },
    { pattern: /engine|generator/, icon: 'generator' },
    { pattern: /battery|akku/, icon: 'battery' },
    { pattern: /transmission-tower|grid/, icon: 'grid' },
    { pattern: /meter|gauge|speedometer/, icon: 'meter' },
    { pattern: /power-plug|power-socket|outlet/, icon: 'plug' },
    { pattern: /house|home/, icon: 'house' },
    { pattern: /ev-station|ev-plug|charging-station|wallbox/, icon: 'wallbox' },
    { pattern: /(^|-)car($|-)/, icon: 'car' },
    { pattern: /heat-?pump/, icon: 'heatpump' },
    // Before the generic water and house rules below, which would otherwise swallow them
    { pattern: /boiler|water-heater|warmwasser/, icon: 'boiler' },
    { pattern: /well|brunnen|spring/, icon: 'well' },
    { pattern: /rain|regen|weather-pouring/, icon: 'rain' },
    { pattern: /cistern|zisterne|(^|-)tank($|-)/, icon: 'cistern' },
    { pattern: /water-meter|wasserz/, icon: 'watermeter' },
    { pattern: /valve|ventil|faucet-variant/, icon: 'valve' },
    { pattern: /sprinkler|irrigation|bew\u00e4sser/, icon: 'sprinkler' },
    { pattern: /filter/, icon: 'filter' },
    { pattern: /shower|dusche/, icon: 'shower' },
    { pattern: /faucet|(^|-)tap($|-)|wasserhahn/, icon: 'tap' },
    { pattern: /buffer|heat-storage|puffer/, icon: 'heatstorage' },
    { pattern: /hydro|water-wheel|water-turbine/, icon: 'hydro' },
    { pattern: /pump/, icon: 'waterpump' },
    { pattern: /consumer|consumption|verbrauch/, icon: 'consumers' },
    { pattern: /microwave/, icon: 'microwave' },
    { pattern: /(^|-)oven($|-)|backofen/, icon: 'oven' },
    { pattern: /dishwasher|geschirr/, icon: 'dishwasher' },
    { pattern: /dryer|tumble|trockner/, icon: 'dryer' },
    { pattern: /coffee|espresso|kettle/, icon: 'coffee' },
    { pattern: /freezer|snowflake/, icon: 'freezer' },
    { pattern: /television|(^|-)tv($|-)|monitor/, icon: 'tv' },
    { pattern: /air-condition|climate|klima/, icon: 'ac' },
    { pattern: /ventilation|hvac|air-filter/, icon: 'ventilation' },
    { pattern: /(^|-)fan($|-)|ventilator|propeller/, icon: 'fan' },
    { pattern: /heater|infrared|radiant/, icon: 'heater' },
    { pattern: /radiator|heating/, icon: 'radiator' },
    { pattern: /water|boiler|shower|faucet/, icon: 'water' },
    { pattern: /light|lamp|bulb/, icon: 'light' },
    { pattern: /pool/, icon: 'pool' },
    { pattern: /fridge|refrigerat/, icon: 'fridge' },
    { pattern: /washing|laundry|dishwasher/, icon: 'washer' },
    { pattern: /stove|cooktop|oven|kitchen/, icon: 'stove' },
    { pattern: /server|(^|-)nas($|-)|computer|desktop/, icon: 'server' },
    { pattern: /fire|flame|(^|-)gas($|-)/, icon: 'flame' },
    { pattern: /flash|bolt|lightning|electric/, icon: 'bolt' },
];

/**
 * Find this widget's icon for an Iconify name.
 *
 * @param name the full name, e.g. `mdi:solar-panel`
 * @returns the icon of this set, or undefined if nothing matches
 */
function mapIcon(name: string): string | undefined {
    // `mdi:solar-panel` -> `solar-panel`
    const bare = name.split(':').pop()!.toLowerCase();
    return ICON_PATTERNS.find(entry => entry.pattern.test(bare))?.icon;
}

/** Keywords that betray what a node is, checked against its icon and its label */
const KIND_HINTS: { pattern: RegExp; kind: NodeKind }[] = [
    { pattern: /solar|photovolta|pv\b|sunny|wind-turbine|generator|engine/i, kind: 'source' },
    { pattern: /battery|akku|batterie|speicher|storage/i, kind: 'storage' },
    { pattern: /transmission-tower|grid|netz|einspeis|meter-electric/i, kind: 'grid' },
    { pattern: /home|haus|house|verbrauch|consum/i, kind: 'sink' },
];

/** `bottom_right` and the like carry a corner; only the axis survives into a {@link Side} */
function toSide(slot: string | undefined): Side | undefined {
    if (!slot) {
        return undefined;
    }
    const base = slot.split('_')[0];
    return base === 'top' || base === 'bottom' || base === 'left' || base === 'right' ? base : undefined;
}

/** The box of an element, in the source document's coordinates */
function elementRect(element: EfElement): Rect | null {
    const x = element.pos_x;
    const y = element.pos_y;
    if (typeof x !== 'number' || typeof y !== 'number') {
        return null;
    }
    // A circle is stored by its radius, everything else by width and height
    if (typeof element.radius === 'number') {
        return { x: x - element.radius, y: y - element.radius, w: element.radius * 2, h: element.radius * 2 };
    }
    const w = element.width;
    const h = element.height;
    if (typeof w !== 'number' || typeof h !== 'number') {
        return null;
    }
    return { x, y, w, h };
}

function centerOf(element: EfElement): Point | null {
    const rect = elementRect(element);
    if (rect) {
        return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    }
    // A text has a position but no box
    return typeof element.pos_x === 'number' && typeof element.pos_y === 'number'
        ? { x: element.pos_x, y: element.pos_y }
        : null;
}

function contains(rect: Rect, point: Point): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/**
 * Turn a datasource reference into a source.
 *
 * The original computes `source + sum(add) - sum(subtract)` and can take the absolute value of the
 * result, so anything beyond a bare state becomes a formula here. That is the same arithmetic, written
 * down instead of implied by three separate fields.
 *
 * @param element the element or animation that refers to the datasources, by index
 * @param datasources index to state id
 * @returns the source, or undefined if nothing is bound
 */
interface SourceRef {
    /** Index into `datasources`, or -1 */
    source?: number;
    add?: number[];
    subtract?: number[];
    convert?: boolean;
    threshold?: number;
}

function toSource(element: SourceRef, datasources: Record<string, string>): Src | undefined {
    const stateOf = (index: number | undefined): string | undefined =>
        index === undefined || index < 0 ? undefined : datasources[String(index)];

    const main = stateOf(element.source);
    if (!main) {
        return undefined;
    }

    const added = (element.add || []).map(stateOf).filter((id): id is string => !!id);
    const subtracted = (element.subtract || []).map(stateOf).filter((id): id is string => !!id);

    // The threshold hides small readings in the original; a dead band is the same idea, expressed on
    // the value rather than on the element
    const deadband = element.threshold && element.threshold > 0 ? element.threshold : undefined;

    if (!added.length && !subtracted.length && !element.convert) {
        return deadband ? { oid: main, deadband } : { oid: main };
    }

    const vars: Record<string, Src> = { a: deadband ? { oid: main, deadband } : { oid: main } };
    const terms: string[] = ['a'];
    let next = 0;

    for (const id of added) {
        const name = `b${next++}`;
        vars[name] = { oid: id };
        terms.push(`+ ${name}`);
    }
    for (const id of subtracted) {
        const name = `c${next++}`;
        vars[name] = { oid: id };
        terms.push(`- ${name}`);
    }

    const sum = terms.join(' ');
    return { expr: element.convert ? `abs(${sum})` : sum, vars };
}

/** How the original's `calculate_kw` switch maps onto a unit and the auto-scaling */
function toFormat(element: EfElement): { unit?: string; decimals?: number; autoScale?: boolean; factor?: number } {
    const decimals = typeof element.decimal_places === 'number' ? element.decimal_places : undefined;

    switch (element.calculate_kw) {
        case 'auto':
            // Exactly what this widget does by default -- with the unit of the state object, which the
            // original assumed to be watts
            return { decimals };
        case 'calc':
        case true:
            // The original divides by 1000 and prints kW, whatever the size
            return { unit: 'kW', decimals, autoScale: false, factor: 0.001 };
        case 'none':
        case false:
            // The original prints the raw number without a unit. The number stays raw (no scaling), but
            // the unit of the state object is shown -- see the `unit-blanked` warning
            return { decimals, autoScale: false };
        default:
            return { unit: element.unit, decimals, autoScale: false };
    }
}

/**
 * The original's "show timestamp of last update / last change". Its fixed US and German date
 * formats become the locale's own; `relative` stays relative, and its millisecond number -- which
 * nobody reads -- becomes a date.
 */
function toTimestamp(element: EfElement): Pick<FlowNode, 'timestamp' | 'timestampFormat'> {
    const shown = (option: string | number | undefined): boolean =>
        option !== undefined && option !== -1 && option !== '-1' && option !== '';
    const [timestamp, option] = shown(element.source_option_lc)
        ? (['lc', element.source_option_lc] as const)
        : shown(element.source_option)
          ? (['ts', element.source_option] as const)
          : [undefined, undefined];
    if (!timestamp) {
        return {};
    }
    return option === 'relative' ? { timestamp } : { timestamp, timestampFormat: 'datetime' };
}

/** Apply a factor to a source without wrapping a plain state in a formula */
function withFactor(src: Src | undefined, factor: number | undefined): Src | undefined {
    if (!src || factor === undefined) {
        return src;
    }
    if (isSrcState(src)) {
        return { ...src, factor: (src.factor ?? 1) * factor };
    }
    if (isSrcExpr(src)) {
        return { expr: `(${src.expr}) * ${factor}`, vars: src.vars };
    }
    return src;
}

/** The two element ids a connection runs between, from a key like `path_5_7` */
function parsePathId(id: string): { from: string; to: string } | null {
    const match = /^path_(\d+)_(\d+)$/.exec(id);
    return match ? { from: match[1], to: match[2] } : null;
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/**
 * Convert an `energiefluss-erweitert` configuration into a diagram.
 *
 * @param raw the parsed configuration -- the content of the adapter's `configuration` state
 * @returns the diagram, what had to be left behind, and a few counts for the summary
 */
export function importEnergiefluss(raw: unknown): ImportResult {
    const document = (raw && typeof raw === 'object' ? raw : {}) as EnergieflussDocument;
    const elements = document.elements || {};
    const defs = document.defs || {};
    const lines = document.lines || {};
    const animations = document.animations || {};
    const warnings: ImportWarning[] = [];

    // datasources: index -> state id
    const datasources: Record<string, string> = {};
    for (const [index, entry] of Object.entries(document.datasources || {})) {
        if (entry?.source) {
            datasources[index] = entry.source;
        }
    }

    // --- which elements are nodes ---------------------------------------------------------------
    //
    // Everything a connection names, plus every box that has none. A box with no connection is still
    // a thing the user drew and expects to see.
    const nodeIds = new Set<string>();
    for (const key of Object.keys(defs)) {
        const ends = parsePathId(defs[key]?.id || key);
        if (ends) {
            nodeIds.add(ends.from);
            nodeIds.add(ends.to);
        }
    }
    for (const [key, element] of Object.entries(elements)) {
        if ((element.type === 'rect' || element.type === 'circle') && elementRect(element)) {
            nodeIds.add(key);
        }
    }
    // A connection may name an element that no longer exists
    for (const id of [...nodeIds]) {
        if (!elements[id] || !elementRect(elements[id])) {
            nodeIds.delete(id);
        }
    }

    // --- assign the loose elements to the boxes that contain them -------------------------------
    const boxes = [...nodeIds]
        .map(id => ({ id, rect: elementRect(elements[id])! }))
        // Smallest box first, so a label inside a small box does not get claimed by a big one behind it
        .sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h);

    interface Group {
        box: EfElement;
        value?: EfElement;
        valueKey?: string;
        label?: EfElement;
        icon?: EfElement;
    }
    const groups: Record<string, Group> = {};
    for (const id of nodeIds) {
        groups[id] = { box: elements[id] };
    }

    let merged = 0;
    const orphanValues: { key: string; element: EfElement }[] = [];

    for (const [key, element] of Object.entries(elements)) {
        if (nodeIds.has(key)) {
            continue;
        }
        if (element.type === 'image') {
            warnings.push({ code: 'image-dropped', ref: key, detail: 'Image elements are not imported.', args: [] });
            continue;
        }
        const point = centerOf(element);
        const owner = point ? boxes.find(box => contains(box.rect, point)) : undefined;

        if (!owner) {
            if (element.type === 'text' && element.subType === 'datasource') {
                orphanValues.push({ key, element });
            }
            continue;
        }

        const group = groups[owner.id];
        merged++;
        if (element.type === 'icon') {
            group.icon ??= element;
        } else if (element.type === 'text' && element.subType === 'datasource') {
            group.value ??= element;
            group.valueKey ??= key;
        } else if (element.type === 'text') {
            group.label ??= element;
        }
    }

    // --- nodes ----------------------------------------------------------------------------------
    const nodes: FlowNode[] = [];
    let bindings = 0;

    /** Which node ids have an edge leaving / arriving, for guessing the kind */
    const outgoing = new Set<string>();
    const incoming = new Set<string>();
    for (const key of Object.keys(defs)) {
        const ends = parsePathId(defs[key]?.id || key);
        if (ends && nodeIds.has(ends.from) && nodeIds.has(ends.to)) {
            outgoing.add(ends.from);
            incoming.add(ends.to);
        }
    }

    for (const id of nodeIds) {
        const group = groups[id];
        const rect = elementRect(group.box)!;
        const iconName = group.icon?.icon;
        const mapped = iconName ? mapIcon(iconName) : undefined;

        if (iconName && !mapped) {
            warnings.push({
                code: 'icon-unmapped',
                ref: id,
                detail: `Icon "${iconName}" has no counterpart; the default icon of the type is used.`,
                args: [iconName],
            });
        }

        const label = group.label?.text;
        const hint = `${iconName || ''} ${label || ''}`;
        let kind: NodeKind =
            KIND_HINTS.find(entry => entry.pattern.test(hint))?.kind ??
            // No hint: a box that only feeds others produces, one that only receives consumes
            (outgoing.has(id) && !incoming.has(id) ? 'source' : 'sink');

        const value = group.value;
        let source = value ? toSource(value, datasources) : undefined;
        const format = value ? toFormat(value) : {};
        source = withFactor(source, format.factor);

        if (source) {
            bindings++;
        }
        if (value?.calculate_kw === 'none' && value.unit) {
            warnings.push({
                code: 'unit-blanked',
                ref: group.valueKey || id,
                detail: `The original hides the unit "${value.unit}" for this value; the unit of the state is shown.`,
                args: [value.unit],
            });
        }
        if (value?.source_display && value.source_display !== 'value') {
            warnings.push({
                code: 'display-mode',
                ref: group.valueKey || id,
                detail: `Shows "${value.source_display}" instead of the value; only the value is imported.`,
                args: [value.source_display],
            });
        }
        if (group.box.action && group.box.action !== 'none') {
            warnings.push({
                code: 'action-dropped',
                ref: id,
                detail: `The click action "${group.box.action}" is not imported.`,
                args: [group.box.action],
            });
        }

        // A storage node in the original carries its charge level as a separate element; there is
        // nothing in the document that ties the two together, so it is left to the user
        if (kind === 'storage' && !source) {
            kind = 'storage';
        }

        const node: FlowNode = {
            id: `n${id}`,
            kind,
            x: Math.round(rect.x + rect.w / 2),
            y: Math.round(rect.y + rect.h / 2),
            w: Math.round(rect.w),
            h: Math.round(rect.h),
            shape:
                group.box.type === 'circle' || (group.box.rx ?? 0) * 2 >= Math.min(rect.w, rect.h)
                    ? 'circle'
                    : 'rounded',
        };
        if (label) {
            node.label = label;
        }
        // Three cases, and they are genuinely different: a mapped icon is used, an icon that could not
        // be mapped leaves the field unset so the node falls back to the one its kind implies (which is
        // what the warning promises), and no icon at all becomes an explicit empty string so the node
        // does not gain one it never had
        if (mapped) {
            node.icon = mapped;
        } else if (!iconName) {
            node.icon = '';
        }
        if (group.box.color && group.box.color !== 'none') {
            node.color = group.box.color;
        }
        if (source) {
            node.value = source;
            Object.assign(node, value ? toTimestamp(value) : {});
        }
        if (format.unit !== undefined) {
            node.unit = format.unit;
        }
        if (format.decimals !== undefined) {
            node.decimals = format.decimals;
        }
        if (format.autoScale !== undefined) {
            node.autoScale = format.autoScale;
        }
        if (value?.font_size) {
            node.fontSize = value.font_size;
        }
        nodes.push(node);
    }

    // A value that sits in no box becomes a node of its own, so the number does not vanish
    for (const { key, element } of orphanValues) {
        const point = centerOf(element);
        if (!point) {
            continue;
        }
        warnings.push({
            code: 'orphan-value',
            ref: key,
            detail: 'This value was not inside any box; it became a small element of its own.',
            args: [],
        });
        const format = toFormat(element);
        const source = withFactor(toSource(element, datasources), format.factor);
        if (source) {
            bindings++;
        }
        const node: FlowNode = {
            id: `n${key}`,
            kind: 'sink',
            x: Math.round(point.x),
            y: Math.round(point.y),
            w: 96,
            h: 44,
            shape: 'rounded',
            icon: '',
            fontSize: element.font_size,
        };
        if (source) {
            node.value = source;
            Object.assign(node, toTimestamp(element));
        }
        if (format.unit !== undefined) {
            node.unit = format.unit;
        }
        if (format.decimals !== undefined) {
            node.decimals = format.decimals;
        }
        if (format.autoScale !== undefined) {
            node.autoScale = format.autoScale;
        }
        nodes.push(node);
    }

    // --- edges ----------------------------------------------------------------------------------
    const edges: FlowEdge[] = [];

    for (const key of Object.keys(defs)) {
        const def = defs[key];
        const pathId = def?.id || key;
        const ends = parsePathId(pathId);

        if (!ends) {
            warnings.push({
                code: 'edge-dropped',
                ref: key,
                detail: 'The connection does not name two elements.',
                args: [key],
            });
            continue;
        }
        if (!nodeIds.has(ends.from) || !nodeIds.has(ends.to)) {
            warnings.push({
                code: 'edge-dropped',
                ref: key,
                detail: `The connection runs to an element that does not exist (${ends.from} -> ${ends.to}).`,
                args: [`${ends.from} -> ${ends.to}`],
            });
            continue;
        }

        const animation = animations[`anim_${pathId}`];
        const line = lines[`line_${pathId}`];

        // `negative` means the original animates when the state goes below zero, so the flow runs the
        // other way round for the same reading -- inverting the source says the same thing here
        const inverted = animation?.animation_properties === 'negative';
        let value = animation ? toSource({ ...animation, threshold: undefined }, datasources) : undefined;
        if (value && inverted) {
            value = isSrcState(value)
                ? { ...value, invert: true }
                : isSrcExpr(value)
                  ? { expr: `0 - (${value.expr})`, vars: value.vars }
                  : value;
        }
        if (value) {
            bindings++;
        }

        const edge: FlowEdge = {
            id: `e${ends.from}_${ends.to}`,
            from: `n${ends.from}`,
            to: `n${ends.to}`,
            value: value ?? { oid: '' },
            // The original animates in one direction only, per animation entry
            mode: 'positive',
            // Its paths are drawn with straight runs and rounded corners
            curve: 'orthogonal',
        };

        const fromSide = toSide(def?.startSlot);
        const toSideValue = toSide(def?.endSlot);
        if (fromSide) {
            edge.fromSide = fromSide;
        }
        if (toSideValue) {
            edge.toSide = toSideValue;
        }
        if (animation?.color) {
            edge.color = animation.color;
        } else if (line?.color) {
            edge.color = line.color;
        }
        if (typeof animation?.threshold === 'number' && animation.threshold > 0) {
            edge.threshold = animation.threshold;
        }
        edges.push(edge);
    }

    const config: FlowConfig = {
        v: 1,
        canvas: {
            w: Math.round(document.basic?.width || DEFAULT_CANVAS.w),
            h: Math.round(document.basic?.height || DEFAULT_CANVAS.h),
            grid: DEFAULT_CANVAS.grid,
        },
        defaults: { unit: 'W' },
        nodes,
        edges,
    };
    if (document.basic?.background_color) {
        config.canvas.background = document.basic.background_color;
    }

    return {
        config,
        warnings,
        stats: { nodes: nodes.length, edges: edges.length, bindings, merged },
    };
}
