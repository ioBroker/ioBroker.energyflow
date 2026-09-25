/**
 * Renders every template in both themes into one HTML page, for looking at the renderer.
 *
 * There is no way to unit-test "does this diagram look right", and the renderer is the part of this
 * adapter where a wrong sign or a badly placed label is obvious to an eye and invisible to an
 * assertion. So: `npm run gallery`, open `tmp/gallery.html`, look at it.
 *
 * The last card is a diagram with nothing bound, which is what a user sees right after picking a
 * template -- placeholders and muted lines, never "NaN".
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';

import translations from '@flow/i18n';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    buildPreset,
    computeRuntime,
    DIAGRAM_STYLE_IDS,
    diagramStyle,
    createValueGetter,
    FlowView,
    DARK_THEME,
    LIGHT_THEME,
    importEnergiefluss,
    MEDIA,
    mediumDefaults,
    mediumOf,
    PRESETS,
    SWITCH_OFF_COLOR,
    type FlowConfig,
    type FlowEdge,
    type FlowNode,
    type FlowTheme,
    type MediumId,
} from '../packages/core/src/index';

/** The real dictionary: a second copy of the labels drifts away with the next template */
const LABELS = translations.de as Record<string, string>;

/**
 * What each node carries, per medium and in that medium's unit. They add up on purpose: what the
 * meter delivers is what the consumers take, so a derived node shows a number somebody could have.
 * A node that only passes things on -- the house between the meter and its taps -- is deliberately
 * missing: the line takes the number of the end that says something, and that is the consumer.
 */
const DEMO: Record<MediumId, Record<string, number>> = {
    energy: { pv: 6400, grid: 900, battery: -2100, home: 5200, wallbox: 3600, heatpump: 1800, bus: 7300 },
    // Litres per minute: a shower is about five, the whole house twelve
    water: { meter: 12, rain: 4, cistern: 6, bath: 5, garden: 4 },
    // Cubic metres per hour: a boiler in winter is under two
    gas: { meter: 2.4, heating: 1.6, stove: 0.4 },
    // Watts of heat: the pump does the work, the sun helps
    heat: { pump: 5200, solar: 1200, heating: 3000, water: 3000 },
};

/** For a node the table does not name */
const FALLBACK: Record<MediumId, number> = { energy: 2400, water: 6, gas: 1.2, heat: 2000 };

function bind(config: FlowConfig): { config: FlowConfig; values: Record<string, number> } {
    const medium = mediumOf(config).id;
    const demo = DEMO[medium];
    const values: Record<string, number> = {};
    // Only the state of charge is bound directly; every node value is derived from its connections,
    // which is exactly what a user gets after picking a template and filling in the three ids
    const nodes = config.nodes.map(node => {
        if (!node.soc) {
            return node;
        }
        const id = `d.${node.id}.soc`;
        values[id] = 68;
        return { ...node, soc: { oid: id } };
    });
    const edges = config.edges.map(edge => {
        const id = `d.e.${edge.id}`;
        const base = demo[edge.from] ?? demo[edge.to] ?? FALLBACK[medium];
        values[id] = edge.from === 'battery' && edge.mode === 'signed' ? -Math.abs(base) : Math.abs(base);
        return { ...edge, value: { oid: id }, showValue: edge.showValue ?? true };
    });
    return { config: { ...config, nodes, edges }, values };
}

let cardCount = 0;

function card(title: string, config: FlowConfig, values: Record<string, number>, theme: FlowTheme): string {
    // The same numbers as the raw state values: an element whose state is a switch shows a word,
    // and the word comes from the raw value, not from the number the getter hands over
    const runtime = computeRuntime(config, createValueGetter(values), theme, { raw: oid => values[oid] });
    // Every card is a render of its own, and React numbers the ids of each from zero: without a
    // prefix all cards share the filter and clip ids of the first one, and draw its shadows
    const svg = renderToStaticMarkup(React.createElement(FlowView, { runtime, theme, animate: true }), {
        identifierPrefix: `card${cardCount++}-`,
    });
    // The worked example is portrait and needs more room than a template
    const tall = config.canvas.h / config.canvas.w > 1 ? ' tall' : '';
    // The card background has to follow the theme the diagram was rendered for, not its position in
    // the grid -- otherwise a light diagram lands on a dark card and cannot be judged at all
    const dark = theme.mode === 'dark' ? ' dark' : '';
    return `<div class="card${tall}${dark}"><h3>${title}</h3><div class="box">${svg}</div></div>`;
}

const cards: string[] = [];
for (const info of PRESETS) {
    if (info.id === 'empty') {
        continue;
    }
    const preset = buildPreset(info.id, key => LABELS[key] || key);
    const bound = bind(preset);
    cards.push(card(`${info.id} · light`, bound.config, bound.values, LIGHT_THEME));
    cards.push(card(`${info.id} · dark`, bound.config, bound.values, DARK_THEME));
}

// Unknown values: the diagram must show placeholders, not NaN, and everything must stay muted
const unset = buildPreset('pv-battery-home', key => LABELS[key] || key);
cards.push(card('unconfigured · light', unset, {}, LIGHT_THEME));

/**
 * The worked example from `examples/`, with the numbers of the screenshot it was built from, so the
 * two can be held next to each other. Every id here is invented; the example itself ships unbound.
 */
const example = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'hybrid-12v.json'), 'utf8'),
) as FlowConfig;

const EXAMPLE_NODES: Record<string, number> = {
    dc: 195,
    inverter: 0,
    ac: 0,
    grid: 177,
    washer: 0,
    stove: 0,
    boiler: 0,
    mppt1: 0,
    mppt2: 0,
    mppt3: 0,
    mppt4: 0,
};
const EXAMPLE_EDGES: Record<string, number> = {
    'battery-dc': 196,
    'grid-battery': 156,
    'grid-ac': 177,
};

function bindExample(config: FlowConfig): { config: FlowConfig; values: Record<string, number> } {
    const values: Record<string, number> = {};
    const nodes = config.nodes.map(node => {
        const next = { ...node };
        if (node.value && EXAMPLE_NODES[node.id] !== undefined) {
            const id = `x.${node.id}`;
            values[id] = EXAMPLE_NODES[node.id];
            next.value = { oid: id };
        }
        if (node.soc) {
            values['x.soc'] = 98;
            next.soc = { oid: 'x.soc' };
        }
        if (node.badges?.length) {
            next.badges = node.badges.map((badge, i) => {
                const id = `x.${node.id}.b${i}`;
                values[id] = node.id === 'pv' ? 1.2 : 12;
                return { ...badge, src: { oid: id } };
            });
        }
        return next;
    });
    const edges = config.edges.map(edge => {
        const id = `x.e.${edge.id}`;
        values[id] = EXAMPLE_EDGES[edge.id] ?? 0;
        return { ...edge, value: { oid: id } };
    });
    return { config: { ...config, nodes, edges }, values };
}

const boundExample = bindExample(example);
cards.push(card('examples/hybrid-12v · light', boundExample.config, boundExample.values, LIGHT_THEME));
cards.push(card('examples/hybrid-12v · dark', boundExample.config, boundExample.values, DARK_THEME));

/**
 * The default layout of `energiefluss-erweitert`, run through the importer.
 *
 * It is the one document of that format everybody starts from, so if the conversion gets this wrong it
 * gets the common case wrong. Bound with demo values here because it ships with none.
 */
const imported = importEnergiefluss(
    JSON.parse(
        readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'energiefluss-default.json'),
            'utf8',
        ),
    ),
).config;
const importValues: Record<string, number> = {};
const importedBound = {
    ...imported,
    edges: imported.edges.map(edge => {
        const id = `i.${edge.id}`;
        importValues[id] = { e5_7: 4200, e5_13: 1800, e14_7: 600, e5_14: 0, e7_22: 3100 }[edge.id] ?? 0;
        return { ...edge, value: { oid: id }, showValue: true };
    }),
};
cards.push(card('imported from energiefluss-erweitert · light', importedBound, importValues, LIGHT_THEME));
cards.push(card('imported from energiefluss-erweitert · dark', importedBound, importValues, DARK_THEME));

/**
 * Ring mains, with **no state on a single pipe** (`defaults.hydraulics`).
 *
 * This is the part of the renderer a single card cannot show: the numbers have to add up *around* the
 * ring, and the pipe where two flows meet has to be visibly dead -- muted, no arrow, no dots. Only
 * the taps and the valve carry a reading here; every pipe is worked out from them.
 */
const RING_DEFAULTS: FlowConfig['defaults'] = {
    ...mediumDefaults('water'),
    lineWidth: 3,
    fontSize: 17,
    hydraulics: true,
};

/** A corner of the ring: a junction draws as a dot, so it does not pretend to be a device */
function junction(id: string, x: number, y: number): FlowNode {
    return { id, kind: 'bus', x, y };
}

/** A pipe with nothing bound to it, which is the whole point of these three cards */
function pipe(from: string, to: string): FlowEdge {
    return { id: `${from}-${to}`, from, to, value: { oid: '' }, showValue: true };
}

function tap(id: string, x: number, y: number, label: string): FlowNode {
    return { id, kind: 'sink', x, y, icon: 'tap', label, value: { oid: `r.${id}` } };
}

/**
 * Upright, because a ring runs from the connection at the top down to the tap -- and a portrait gets
 * twice the room on the card, which is what makes the numbers on it readable at all.
 */
/**
 * A valve or a pump as the designer places one: its state is a switch, so it shows a word rather
 * than a number, and off it turns grey. Written out here because the palette does it in the editor,
 * which the gallery does not have.
 */
function switched(node: FlowNode, on: string, off: string): FlowNode {
    return {
        ...node,
        display: 'text',
        textMap: { true: on, 1: on, false: off, 0: off },
        color: MEDIA.water.accent,
        rules: [{ op: '==', value: 0, color: SWITCH_OFF_COLOR }],
    };
}

function ringOf(nodes: FlowNode[], edges: FlowEdge[]): FlowConfig {
    return { v: 1, canvas: { w: 620, h: 660, grid: 10 }, defaults: RING_DEFAULTS, nodes, edges };
}

const HOUSE_CONNECTION = LABELS.kind_grid_water;

// One house connection at the top, the tap at the bottom: the water reaches it both ways round, and
// each half of the ring carries half of what the tap reads
const ringOne = ringOf(
    [
        { id: 'mains', kind: 'grid', x: 310, y: 80, label: HOUSE_CONNECTION },
        junction('west', 80, 340),
        junction('east', 540, 340),
        tap('bath', 310, 580, LABELS.node_bath),
    ],
    [pipe('mains', 'west'), pipe('west', 'bath'), pipe('mains', 'east'), pipe('east', 'bath')],
);
cards.push(card('ring · one house connection · light', ringOne, { 'r.bath': 10 }, LIGHT_THEME));
cards.push(card('ring · one house connection · dark', ringOne, { 'r.bath': 10 }, DARK_THEME));

// The same ring with a valve at half a turn in the eastern half: two parts against one
const ringValve = ringOf(
    [
        { id: 'mains', kind: 'grid', x: 310, y: 80, label: HOUSE_CONNECTION },
        junction('west', 80, 340),
        {
            id: 'valve',
            kind: 'bus',
            icon: 'valve',
            x: 540,
            y: 340,
            label: LABELS.palette_valve,
            value: { oid: 'r.valve' },
            unit: '%',
        },
        tap('bath', 310, 580, LABELS.node_bath),
    ],
    [pipe('mains', 'west'), pipe('west', 'bath'), pipe('mains', 'valve'), pipe('valve', 'bath')],
);
const VALVE_VALUES = { 'r.bath': 10, 'r.valve': 50 };
cards.push(card('ring · valve at half a turn · light', ringValve, VALVE_VALUES, LIGHT_THEME));
cards.push(card('ring · valve at half a turn · dark', ringValve, VALVE_VALUES, DARK_THEME));

// Two givers on one ring -- a well and the mains. Each feeds its own side, and the pipe along the top,
// where the two flows would meet, carries nothing at all
const ringTwo = ringOf(
    [
        { id: 'well', kind: 'source', x: 110, y: 270, label: LABELS.kind_source_water },
        { id: 'mains', kind: 'grid', x: 510, y: 270, label: HOUSE_CONNECTION },
        junction('far', 310, 70),
        tap('bath', 310, 570, LABELS.node_bath),
    ],
    [pipe('well', 'bath'), pipe('mains', 'bath'), pipe('well', 'far'), pipe('far', 'mains')],
);
cards.push(card('ring · two givers, the top pipe dead · light', ringTwo, { 'r.bath': 12 }, LIGHT_THEME));
cards.push(card('ring · two givers, the top pipe dead · dark', ringTwo, { 'r.bath': 12 }, DARK_THEME));

// A tank, the pump that moves what is in it, and a ring behind the pump. Nothing here is a number the
// installation reports except how full the tank is, whether the pump runs, and what the tap takes
const ringPump = ringOf(
    [
        {
            id: 'cistern',
            kind: 'storage',
            x: 310,
            y: 70,
            label: LABELS.kind_storage_water,
            soc: { oid: 'r.level' },
        },
        switched(
            {
                id: 'pump',
                kind: 'bus',
                icon: 'waterpump',
                x: 310,
                y: 240,
                label: LABELS.palette_pump,
                value: { oid: 'r.pump' },
            },
            LABELS.state_on,
            LABELS.state_off,
        ),
        junction('west', 80, 420),
        junction('east', 540, 420),
        tap('bath', 310, 580, LABELS.node_bath),
    ],
    [pipe('cistern', 'pump'), pipe('pump', 'west'), pipe('pump', 'east'), pipe('west', 'bath'), pipe('east', 'bath')],
);
const PUMP_RUNS = { 'r.level': 64, 'r.pump': 1, 'r.bath': 8 };
cards.push(card('ring · tank and pump · light', ringPump, PUMP_RUNS, LIGHT_THEME));
cards.push(card('ring · tank and pump · dark', ringPump, PUMP_RUNS, DARK_THEME));

// The same plant with the pump standing: nothing gives, and every pipe says so
// The tap reads nothing either -- with the pump standing there is nothing at it to read
const PUMP_STANDS = { ...PUMP_RUNS, 'r.pump': 0, 'r.bath': 0 };
cards.push(card('ring · the pump stands · light', ringPump, PUMP_STANDS, LIGHT_THEME));
cards.push(card('ring · the pump stands · dark', ringPump, PUMP_STANDS, DARK_THEME));

/**
 * Every style but the normal one, on a template and on the worked example, light and dark: a style has
 * to hold up in both modes of the host, and on a real installation as well as on a tidy template.
 */
// The value of a connection as a chip on the line, the alternative to the text beside it
const chips = bind(buildPreset('pv-battery-home', key => LABELS[key] || key));
const chipConfig: FlowConfig = {
    ...chips.config,
    defaults: { ...chips.config.defaults, edgeLabel: 'chip' },
};
cards.push(card('edge labels as chips · light', chipConfig, chips.values, LIGHT_THEME));
cards.push(card('edge labels as chips · dark', chipConfig, chips.values, DARK_THEME));

for (const style of DIAGRAM_STYLE_IDS.filter(id => id !== 'normal')) {
    const styled = (config: FlowConfig): FlowConfig => ({
        ...config,
        defaults: { ...config.defaults, style },
    });
    const template = bind(buildPreset('pv-battery-home', key => LABELS[key] || key));
    cards.push(card(`style ${style} · pv-battery-home · light`, styled(template.config), template.values, LIGHT_THEME));
    cards.push(card(`style ${style} · pv-battery-home · dark`, styled(template.config), template.values, DARK_THEME));
    cards.push(
        card(`style ${style} · hybrid-12v · light`, styled(boundExample.config), boundExample.values, LIGHT_THEME),
    );
    cards.push(
        card(`style ${style} · hybrid-12v · dark`, styled(boundExample.config), boundExample.values, DARK_THEME),
    );
    // A style that shows the level of a circle as a gauge: every node a circle, with levels to show
    if (diagramStyle(styled(template.config)).levelRing) {
        const gauges = styled({
            ...template.config,
            nodes: template.config.nodes.map(node => ({
                ...node,
                shape: 'circle' as const,
                w: 110,
                h: 110,
                levelMax: node.kind === 'source' ? 8000 : node.kind === 'sink' ? 10000 : undefined,
            })),
        });
        cards.push(card(`style ${style} · gauges · light`, gauges, template.values, LIGHT_THEME));
        cards.push(card(`style ${style} · gauges · dark`, gauges, template.values, DARK_THEME));
    }
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>flow gallery</title>
<style>
body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #eef1f4; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.card { background: #fff; border-radius: 10px; padding: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
.card.dark { background: #1a1f26; color: #e6eaf0; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; opacity: .7; }
.box { height: 300px; }
.card.tall .box { height: 700px; }
</style></head><body><div class="grid">${cards.join('')}</div></body></html>`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'tmp', 'gallery.html');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html, 'utf8');
console.log(`wrote ${out}`);
