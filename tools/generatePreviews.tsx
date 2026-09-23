/**
 * Renders the palette previews with the real renderer.
 *
 * A hand-drawn preview image is a promise about what the widget looks like, and it is the first thing
 * to go stale. This renders the presets through `FlowView` itself, with made-up but plausible
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
    DARK_THEME,
    FlowView,
    LIGHT_THEME,
    type FlowConfig,
    type FlowTheme,
} from '../packages/core/src/index';

/**
 * The fonts a page would give the diagram. An .svg shown as an image inherits nothing, and without a
 * family of its own it falls back to a serif -- which is how the README once showed Times.
 */
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * The renderer's markup made into a file that stands on its own: the namespace and XML declaration a
 * standalone .svg wants, the font, and a background in the theme's colour. Without the background a
 * light diagram lands on whatever is behind the image -- on GitHub in dark mode that means light boxes,
 * grey labels and white halos on black.
 *
 * @param markup what `renderToStaticMarkup` produced
 * @param theme the theme it was rendered with
 */
function standalone(markup: string, theme: FlowTheme): string {
    const viewBox = /viewBox="([^"]+)"/.exec(markup)?.[1].split(' ').map(Number);
    // The built-in themes leave the background to the page; a file has to bring the page along
    const fill = theme.background !== 'transparent' ? theme.background : theme.mode === 'dark' ? '#181B20' : '#F8FAFC';
    const background =
        viewBox?.length === 4
            ? `<rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" rx="16" fill="${fill}"></rect>`
            : '';
    const svg = markup
        .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" font-family="${FONT}" `)
        // Behind everything, right after the stylesheet
        .replace('</style>', `</style>${background}`);
    return `<?xml version="1.0" encoding="UTF-8"?>
${svg}
`;
}

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
function bindDemoValues(config: FlowConfig): { config: FlowConfig; values: Record<string, number> } {
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
    const markup = renderToStaticMarkup(React.createElement(FlowView, { runtime, theme: LIGHT_THEME, animate: false }));

    const svg = standalone(markup, LIGHT_THEME);

    mkdirSync(VIS_IMG, { recursive: true });
    writeFileSync(join(VIS_IMG, fileName), svg, 'utf8');
    console.log(`Wrote ${fileName} (${Math.round(svg.length / 1024)} kB)`);
}

render('pv-battery-home', 'prev_flow.svg');

/**
 * The worked example, with the numbers of the installation it was built from, for the README and
 * `examples/README.md` -- once light and once dark, which GitHub picks from with `<picture>`.
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
    const config = JSON.parse(readFileSync(join(root, 'examples', 'hybrid-12v.json'), 'utf8')) as FlowConfig;
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
    mkdirSync(VIS_IMG, { recursive: true });
    for (const [theme, fileName] of [
        [LIGHT_THEME, 'prev_hybrid-12v.svg'],
        [DARK_THEME, 'prev_hybrid-12v-dark.svg'],
    ] as const) {
        const runtime = computeRuntime(bound, createValueGetter(values), theme);
        const markup = renderToStaticMarkup(React.createElement(FlowView, { runtime, theme, animate: false }));
        const svg = standalone(markup, theme);
        writeFileSync(join(VIS_IMG, fileName), svg, 'utf8');
        console.log(`Wrote ${fileName} (${Math.round(svg.length / 1024)} kB)`);
    }
}

renderExample();
