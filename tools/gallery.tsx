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
    PRESETS,
    type FlowConfig,
    type FlowTheme,
} from '../packages/core/src/index';

const LABELS: Record<string, string> = {
    node_pv: 'Photovoltaik',
    node_grid: 'Netz',
    node_home: 'Haus',
    node_battery: 'Batterie',
    node_wallbox: 'Wallbox',
    node_heatpump: 'Wärmepumpe',
    node_water_meter: 'Wasserzähler',
    node_rain: 'Regen',
    node_cistern: 'Zisterne',
    node_bath: 'Bad',
    node_garden: 'Garten',
};

const DEMO: Record<string, number> = {
    pv: 6400,
    grid: 900,
    battery: -2100,
    home: 5200,
    wallbox: 3600,
    heatpump: 1800,
    bus: 7300,
    // Water flows, in l/min -- a shower is about twelve
    meter: 9,
    rain: 4,
    cistern: 7,
    bath: 7,
    garden: 5,
};

function bind(config: FlowConfig): { config: FlowConfig; values: Record<string, number> } {
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
        const base = DEMO[edge.from] ?? DEMO[edge.to] ?? 2400;
        values[id] = edge.from === 'battery' && edge.mode === 'signed' ? -Math.abs(base) : Math.abs(base);
        return { ...edge, value: { oid: id }, showValue: edge.showValue ?? true };
    });
    return { config: { ...config, nodes, edges }, values };
}

let cardCount = 0;

function card(title: string, config: FlowConfig, values: Record<string, number>, theme: FlowTheme): string {
    const runtime = computeRuntime(config, createValueGetter(values), theme);
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
