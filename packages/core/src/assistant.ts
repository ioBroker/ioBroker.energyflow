/**
 * A first diagram from the installation's own states: find what reports a flow, guess what it is, lay
 * it out. The guess is only a start -- the assistant shows every candidate with its guess, and the
 * user decides -- but it turns "an empty canvas and 4000 states" into "untick two lines".
 *
 * Everything here asks the medium of the diagram it is building. A water meter reports `l/min` and is
 * called a Hausanschluss, not a Netz; searching it for watts would find nothing at all.
 */
import { mediumDefaults, type MediumId } from './media';
import { uniqueId } from './model';
import type { FlowConfig, FlowEdge, FlowNode } from './types';

/** What a power state is taken for */
export type DeviceKind = 'source' | 'grid' | 'storage' | 'sink';

/**
 * Keywords per kind and medium, checked against id and name in this order -- the battery before the
 * grid, because a battery's "grid charging" state is still the battery's, and the cistern before the
 * water meter for the same reason.
 */
const KEYWORDS: Record<MediumId, [DeviceKind, RegExp][]> = {
    energy: [
        ['storage', /batt|akku|speicher|storage/],
        ['source', /(^|[._\s-])pv|solar|photovolt|mppt|erzeug|production|generation|yield|ertrag/],
        ['grid', /grid|netz|meter|zaehler|zähler|bezug|einspeis|feed|smartmeter|obis/],
        [
            'sink',
            /wallbox|charger|ladepunkt|evcc|(^|[._\s-])(car|auto|last)([._\s-]|$)|fahrzeug|heatpump|heat.pump|wärmepumpe|waermepumpe|house|haus|consum|verbrauch|load/,
        ],
    ],
    water: [
        ['storage', /zisterne|cistern|regenwasser|(^|[._\s-])tank([._\s-]|$)|speicher/],
        ['source', /brunnen|well|quelle|spring|regen|rain|bohrloch/],
        [
            'grid',
            /wasserz[aä]hler|wasseruhr|watermeter|hausanschluss|stadtwasser|trinkwasser|mains|z[aä]hler|zaehler|meter/,
        ],
        [
            'sink',
            /dusche|shower|(^|[._\s-])bad([._\s-]|$)|bath|(^|[._\s-])wc([._\s-]|$)|toilet|garten|garden|bew[aä]sser|irrigation|sprinkler|pool|k[uü]che|kitchen|wasch|washer|sp[uü]l|dishwasher|verbrauch|consum/,
        ],
    ],
    gas: [
        ['storage', /fl[uü]ssiggas|lpg|gastank|(^|[._\s-])tank([._\s-]|$)/],
        ['source', /biogas|eigenerzeug/],
        ['grid', /gasz[aä]hler|gasuhr|gasmeter|hausanschluss|z[aä]hler|zaehler|meter|(^|[._\s-])gas([._\s-]|$)/],
        ['sink', /heizung|therme|kessel|boiler|brenner|herd|stove|kamin|ofen|heating/],
    ],
    heat: [
        ['storage', /puffer|buffer|schichtspeicher|w[aä]rmespeicher|warmwasserspeicher|speicher/],
        [
            'source',
            /w[aä]rmepumpe|waermepumpe|heatpump|heat.pump|solarthermie|kollektor|kessel|therme|brenner|bhkw|(^|[._\s-])chp([._\s-]|$)/,
        ],
        ['grid', /fernw[aä]rme|nahw[aä]rme|district/],
        [
            'sink',
            /heizkreis|heizk[oö]rper|radiator|fu[sß]boden|heizung|heating|warmwasser|hot.?water|(^|[._\s-])dhw([._\s-]|$)|zirkulation/,
        ],
    ],
};

/**
 * The units a flow of a medium is written in. A unit is the one thing about a state that is not a
 * guess, so it decides who is a candidate at all.
 */
const FLOW_UNITS: Record<MediumId, string[]> = {
    energy: ['w', 'kw', 'mw'],
    water: ['l/min', 'l/h', 'l/s', 'lpm', 'm3/h', 'm3/min'],
    gas: ['m3/h', 'm3/min', 'l/min', 'l/h'],
    heat: ['w', 'kw', 'mw'],
};

/** `m³/h` and `M3/h` and `m3 / h` are the same unit written by three adapters */
function normalizeUnit(unit: string): string {
    return unit
        .toLowerCase()
        .replace(/\u00b3/g, '3')
        .replace(/\s+/g, '');
}

/** The kind a text points to, or null */
function kindOf(text: string, medium: MediumId): DeviceKind | null {
    const lower = text.toLowerCase();
    return KEYWORDS[medium].find(([, pattern]) => pattern.test(lower))?.[0] ?? null;
}

/**
 * What a power state is, and how sure that is.
 *
 * The name is the most specific thing a state has, so it is asked first; then the last part of the
 * id, then the whole path. A script that keeps "consumption summary" in a folder called `PV` is a
 * consumer, whatever its folder says.
 *
 * @param oid the state id
 * @param name its name
 * @param medium what flows through the diagram being built
 * @returns the kind, and 3 (from the name), 2 (from the last part of the id), 1 (from the path) or 0
 */
export function guessDevice(
    oid: string,
    name: string,
    medium: MediumId = 'energy',
): { kind: DeviceKind | null; confidence: 0 | 1 | 2 | 3 } {
    const fromName = name ? kindOf(name, medium) : null;
    if (fromName) {
        return { kind: fromName, confidence: 3 };
    }
    const fromLeaf = kindOf(oid.split('.').slice(-2).join('.'), medium);
    if (fromLeaf) {
        return { kind: fromLeaf, confidence: 2 };
    }
    const fromPath = kindOf(oid, medium);
    return fromPath ? { kind: fromPath, confidence: 1 } : { kind: null, confidence: 0 };
}

/** The kind of a state as far as its id and name tell, or null */
export function guessDeviceKind(oid: string, name: string, medium: MediumId = 'energy'): DeviceKind | null {
    return guessDevice(oid, name, medium).kind;
}

/** How many of each kind the assistant ticks on its own: what fits a diagram, not what was found */
export const PRESELECT_LIMITS: Record<DeviceKind, number> = { source: 4, grid: 1, storage: 1, sink: 4 };

/**
 * Whether a state reports the flow of a medium: its unit is one of that medium's, or -- for energy,
 * the only medium ioBroker has a role for -- its role says so.
 *
 * @param common the `common` of the state object
 * @param medium what flows through the diagram being built
 * @returns true for a candidate
 */
export function isFlowState(
    common: { unit?: unknown; role?: unknown; type?: unknown } | undefined,
    medium: MediumId = 'energy',
): boolean {
    if (!common || (common.type !== undefined && common.type !== 'number')) {
        return false;
    }
    const unit = typeof common.unit === 'string' ? normalizeUnit(common.unit) : '';
    if (unit) {
        // The unit decides where there is one: ioBroker's role `value.power.consumption` is used for
        // energy meters in kWh just as much as for power
        return FLOW_UNITS[medium].includes(unit);
    }
    // Only a power state may be taken without a unit; a water meter without one is a number of
    // anything, and guessing it would fill the list with thermostats
    return (
        (medium === 'energy' || medium === 'heat') &&
        typeof common.role === 'string' &&
        common.role.startsWith('value.power')
    );
}

/**
 * Whether a state is a battery's state of charge.
 *
 * @param oid its id
 * @param name its name
 * @param common its `common`
 * @returns true for a state of charge
 */
export function isSocState(oid: string, name: string, common: { unit?: unknown; role?: unknown } | undefined): boolean {
    if (!common) {
        return false;
    }
    if (common.role === 'value.battery') {
        return true;
    }
    return common.unit === '%' && /soc|batt|akku|ladezustand|charge|speicher/.test(`${oid} ${name}`.toLowerCase());
}

/** The name of an object in a language, whatever form it was stored in */
export function objectName(name: unknown, lang = 'en'): string {
    if (typeof name === 'string') {
        return name;
    }
    if (name && typeof name === 'object') {
        const names = name as Record<string, unknown>;
        const picked = names[lang] ?? names.en ?? Object.values(names)[0];
        return typeof picked === 'string' ? picked : '';
    }
    return '';
}

/** One state the user chose for the diagram */
export interface DeviceChoice {
    oid: string;
    kind: DeviceKind;
    label: string;
}

/** A state that is the house's own consumption -- it belongs on the house, not next to it */
function isHouse(text: string): boolean {
    return /(^|[._\s-])(house|haus|home)([._\s-]|$)|hausverbrauch|house.?consumption|home.?consumption/.test(
        text.toLowerCase(),
    );
}

/** Icons for a consumer, where its name gives it away, per medium */
const SINK_ICONS: Record<MediumId, [RegExp, string][]> = {
    energy: [
        [/wallbox|charger|ladepunkt|evcc/, 'wallbox'],
        [/(^|[._\s-])(car|auto)([._\s-]|$)|fahrzeug/, 'car'],
        [/heatpump|heat.pump|wärmepumpe|waermepumpe/, 'heatpump'],
    ],
    water: [
        [/dusche|shower|(^|[._\s-])bad([._\s-]|$)|bath/, 'shower'],
        [/garten|garden|bew[aä]sser|irrigation|sprinkler/, 'sprinkler'],
        [/wasch|washer|laundry/, 'washer'],
        [/sp[uü]l|dishwasher/, 'dishwasher'],
        [/pool|schwimm/, 'pool'],
        [/k[uü]che|kitchen|hahn|tap/, 'tap'],
    ],
    gas: [
        [/herd|stove|kochen/, 'stove'],
        [/kamin|ofen|brenner/, 'flame'],
        [/heizung|therme|kessel|boiler|heating/, 'boiler'],
    ],
    heat: [
        [/warmwasser|hot.?water|(^|[._\s-])dhw([._\s-]|$)|zirkulation/, 'boiler'],
        [/fu[sß]boden|floor/, 'heater'],
        [/heizkreis|heizk[oö]rper|radiator|heizung|heating/, 'radiator'],
    ],
};

/** An icon for a consumer, where its name gives it away */
function sinkIcon(text: string, medium: MediumId): string | undefined {
    const lower = text.toLowerCase();
    return SINK_ICONS[medium].find(([pattern]) => pattern.test(lower))?.[1];
}

/**
 * Lay out a diagram from chosen states: producers along the top, the grid on the left, storage on the
 * right, consumers along the bottom, a house in the middle that all of them meet in.
 *
 * The states are bound to the connections, not to the nodes: every node then shows what flows in or
 * out of it, and the house works out its own consumption -- the same principle as the templates.
 *
 * @param choices the states and what they are
 * @param options the house's label, and the battery's state of charge if there is one
 * @param options.home label of the house in the middle
 * @param options.soc state of charge of the (first) battery
 * @param options.medium what flows; it sets the unit, the dot speed and the icons
 * @returns the diagram
 */
export function buildFromDevices(
    choices: DeviceChoice[],
    options: { home: string; soc?: string; medium?: MediumId },
): FlowConfig {
    const medium = options.medium ?? 'energy';
    // The first consumer that is the house itself becomes the house's value
    const house = choices.find(choice => choice.kind === 'sink' && isHouse(`${choice.oid} ${choice.label}`));
    const of = (kind: DeviceKind): DeviceChoice[] => choices.filter(choice => choice.kind === kind && choice !== house);
    const sources = of('source');
    const grids = of('grid');
    const storages = of('storage');
    const sinks = of('sink');

    const width = Math.max(900, 170 * Math.max(sources.length, sinks.length) + 160);
    const height = 560 + Math.max(0, Math.max(grids.length, storages.length) - 2) * 110;
    const middle = Math.round(height / 2 / 10) * 10;
    const spread = (count: number, index: number): number => Math.round(((index + 1) * width) / (count + 1) / 10) * 10;
    const column = (count: number, index: number): number =>
        Math.round((middle + (index - (count - 1) / 2) * 140) / 10) * 10;

    const nodes: FlowNode[] = [
        { id: 'home', kind: 'sink', x: Math.round(width / 20) * 10, y: middle, label: options.home },
    ];
    if (house) {
        nodes[0].value = { oid: house.oid };
    }
    const edges: FlowEdge[] = [];
    const taken = (): string[] => [...nodes.map(node => node.id), ...edges.map(edge => edge.id)];

    const add = (choice: DeviceChoice, prefix: string, x: number, y: number, inbound: boolean): void => {
        const id = uniqueId(prefix, taken());
        const node: FlowNode = { id, kind: choice.kind, x, y, label: choice.label };
        const icon = choice.kind === 'sink' ? sinkIcon(`${choice.oid} ${choice.label}`, medium) : undefined;
        if (icon) {
            node.icon = icon;
        }
        if (choice.kind === 'storage' && options.soc && !nodes.some(item => item.kind === 'storage')) {
            node.soc = { oid: options.soc };
        }
        nodes.push(node);
        // A producer and a consumer have one direction; the grid and a battery carry both, signed
        const mode = choice.kind === 'grid' || choice.kind === 'storage' ? 'signed' : 'positive';
        const from = inbound ? id : 'home';
        const to = inbound ? 'home' : id;
        edges.push({ id: uniqueId(`${from}-${to}`, taken()), from, to, value: { oid: choice.oid }, mode });
    };

    sources.forEach((choice, index) => add(choice, 'pv', spread(sources.length, index), 90, true));
    grids.forEach((choice, index) => add(choice, 'grid', 120, column(grids.length, index), true));
    storages.forEach((choice, index) => add(choice, 'battery', width - 120, column(storages.length, index), true));
    sinks.forEach((choice, index) => add(choice, 'load', spread(sinks.length, index), height - 80, false));

    return {
        v: 1,
        canvas: { w: width, h: height, grid: 10 },
        nodes,
        edges,
        defaults: mediumDefaults(medium),
    };
}
