/**
 * Renders the palette previews with the real renderer.
 *
 * A hand-drawn preview image is a promise about what the widget looks like, and it is the first thing
 * to go stale. This renders the presets through `EnergyFlowView` itself, with made-up but plausible
 * values, so the picture in the vis-2 palette is by construction what the widget produces.
 *
 * Run through `tasks.ts --previews`, or directly with `npx tsx tools/generatePreviews.tsx`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    buildPreset,
    computeRuntime,
    createValueGetter,
    EnergyFlowView,
    LIGHT_THEME,
    type EnergyFlowConfig,
} from '../packages/core/src/index';

/** Where the vis-2 bundle keeps its static assets */
const VIS_IMG = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-widgets', 'public', 'img');

/**
 * Values that make the preview show something: sun on the roof, a little from the grid, the battery
 * charging. Every edge has to be *above* its threshold, or the preview shows a grey diagram.
 */
const DEMO_VALUES: Record<string, number> = {
    pv: 6400,
    grid: 900,
    battery: -2100,
    home: 5200,
    wallbox: 3600,
    heatpump: 1800,
};

/**
 * Give every connection in the document a demo value.
 *
 * The templates ship with empty state ids, so the ids are invented here and written into a copy -- the
 * template itself must stay unbound.
 */
function bindDemoValues(config: EnergyFlowConfig): { config: EnergyFlowConfig; values: Record<string, number> } {
    const values: Record<string, number> = {};

    // Only the state of charge is bound directly. The node values are derived from the connections,
    // so the preview shows exactly the arithmetic a real diagram does.
    const nodes = config.nodes.map(node => {
        if (!node.soc) {
            return node;
        }
        const id = `demo.${node.id}.soc`;
        values[id] = 68;
        return { ...node, soc: { oid: id } };
    });

    const edges = config.edges.map(edge => {
        const id = `demo.edge.${edge.id}`;
        // Signed edges get one direction each so both colours appear in the preview
        const base = DEMO_VALUES[edge.from] ?? DEMO_VALUES[edge.to] ?? 2400;
        values[id] = edge.mode === 'signed' && edge.from === 'battery' ? -Math.abs(base) : Math.abs(base);
        return { ...edge, value: { oid: id } };
    });

    return { config: { ...config, nodes, edges }, values };
}

/** English labels; the preview is one image for every language */
const LABELS: Record<string, string> = {
    node_pv: 'Photovoltaics',
    node_grid: 'Grid',
    node_home: 'House',
    node_battery: 'Battery',
    node_wallbox: 'Wallbox',
    node_heatpump: 'Heat pump',
};

function render(presetId: Parameters<typeof buildPreset>[0], fileName: string): void {
    const preset = buildPreset(presetId, key => LABELS[key] || key);
    const { config, values } = bindDemoValues(preset);
    const runtime = computeRuntime(config, createValueGetter(values), LIGHT_THEME);

    // `animate: false` puts a static arrow on each active edge instead of the moving dots -- a preview
    // is a still image, and an arrow says "direction" where a frozen dot says nothing
    const markup = renderToStaticMarkup(
        React.createElement(EnergyFlowView, { runtime, theme: LIGHT_THEME, animate: false }),
    );

    // renderToStaticMarkup emits the element without the XML declaration a standalone .svg wants
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}\n`;

    mkdirSync(VIS_IMG, { recursive: true });
    writeFileSync(join(VIS_IMG, fileName), svg, 'utf8');
    console.log(`Wrote ${fileName} (${Math.round(svg.length / 1024)} kB)`);
}

render('pv-battery-home', 'prev_energyflow.svg');

/**
 * The worked example, with the numbers of the installation it was built from, for `examples/README.md`.
 *
 * It goes through the same renderer as everything else, so the picture in the documentation cannot
 * drift away from what the file actually produces.
 */
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
const EXAMPLE_EDGES: Record<string, number> = { 'battery-dc': 196, 'grid-battery': 156, 'grid-ac': 177 };

function renderExample(): void {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const config = JSON.parse(readFileSync(join(root, 'examples', 'hybrid-12v.json'), 'utf8')) as EnergyFlowConfig;
    const values: Record<string, number> = {};

    const nodes = config.nodes.map(node => {
        const next = { ...node };
        if (node.value && EXAMPLE_NODES[node.id] !== undefined) {
            values[`x.${node.id}`] = EXAMPLE_NODES[node.id];
            next.value = { oid: `x.${node.id}` };
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
        values[`x.e.${edge.id}`] = EXAMPLE_EDGES[edge.id] ?? 0;
        return { ...edge, value: { oid: `x.e.${edge.id}` } };
    });

    const bound = { ...config, nodes, edges };
    const runtime = computeRuntime(bound, createValueGetter(values), LIGHT_THEME);
    const markup = renderToStaticMarkup(
        React.createElement(EnergyFlowView, { runtime, theme: LIGHT_THEME, animate: false }),
    );
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
${markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')}
`;
    mkdirSync(VIS_IMG, { recursive: true });
    writeFileSync(join(VIS_IMG, 'prev_hybrid-12v.svg'), svg, 'utf8');
    console.log(`Wrote prev_hybrid-12v.svg (${Math.round(svg.length / 1024)} kB)`);
}

renderExample();
