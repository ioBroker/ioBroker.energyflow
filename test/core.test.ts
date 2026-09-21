/**
 * Tests for the parts of the core that are pure functions: the expression language, the formatting,
 * the geometry and the runtime resolution.
 *
 * These are the parts where a mistake is invisible in a screenshot -- a diagram with a wrong sign, a
 * unit scaled by a factor of 1000 or a direction that flips on noise looks perfectly fine until
 * somebody compares it with their meter.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { compileExpr, evalExpr, ExprError, exprVariables } from '../packages/core/src/expr';
import { formatValue, scaleUnit } from '../packages/core/src/format';
import { collectOids, resolveSrc, toNumber, createValueGetter } from '../packages/core/src/values';
import { computeRuntime } from '../packages/core/src/runtime';
import { anchorOf, edgeGeometry } from '../packages/core/src/geometry';
import { normalizeConfig, nodeRect } from '../packages/core/src/defaults';
import { BUILTIN_ICONS } from '../packages/core/src/icons';
import { importEnergiefluss, isEnergiefluss } from '../packages/core/src/importEnergiefluss';
import { buildPreset } from '../packages/core/src/presets';
import {
    createEdge,
    createNode,
    fitCanvas,
    moveNodes,
    removeNode,
    renameNode,
    uniqueId,
} from '../packages/core/src/model';
import {
    createTheme,
    DARK_THEME,
    LIGHT_THEME,
    muteColor,
    parseColorString,
    themeFromMui,
    withAlpha,
} from '../packages/core/src/theme';
import type { EnergyFlowConfig } from '../packages/core/src/types';

describe('expr', () => {
    it('evaluates arithmetic with the usual precedence', () => {
        assert.equal(evalExpr('2 + 3 * 4', {}), 14);
        assert.equal(evalExpr('(2 + 3) * 4', {}), 20);
        assert.equal(evalExpr('-3 + 1', {}), -2);
        assert.equal(evalExpr('10 / 4', {}), 2.5);
        assert.equal(evalExpr('2 * 3 - 4 / 2', {}), 4);
    });

    it('reads variables and treats an unknown name as unknown', () => {
        assert.equal(evalExpr('pv - grid', { pv: 5000, grid: 1200 }), 3800);
        assert.equal(evalExpr('pv - nothing', { pv: 5000 }), null);
    });

    it('propagates null through every operator', () => {
        assert.equal(evalExpr('a + b', { a: 1, b: null }), null);
        assert.equal(evalExpr('a * b', { a: null, b: 2 }), null);
        assert.equal(evalExpr('-a', { a: null }), null);
        assert.equal(evalExpr('a > b', { a: 1, b: null }), null);
    });

    it('never yields Infinity or NaN', () => {
        assert.equal(evalExpr('1 / 0', {}), null);
        assert.equal(evalExpr('sqrt(0 - 4)', {}), null);
    });

    it('skips unknown arguments in sum and avg', () => {
        assert.equal(evalExpr('sum(a, b, c)', { a: 100, b: null, c: 200 }), 300);
        assert.equal(evalExpr('avg(a, b)', { a: 10, b: null }), 10);
        assert.equal(evalExpr('sum(a, b)', { a: null, b: null }), null);
    });

    it('supports comparisons and if()', () => {
        assert.equal(evalExpr('if(soc > 95, 0, charge)', { soc: 98, charge: 2000 }), 0);
        assert.equal(evalExpr('if(soc > 95, 0, charge)', { soc: 40, charge: 2000 }), 2000);
        assert.equal(evalExpr('a - b > 0', { a: 5, b: 3 }), 1);
    });

    it('supports the numeric helpers', () => {
        assert.equal(evalExpr('abs(0 - 7)', {}), 7);
        assert.equal(evalExpr('min(4, 9, 2)', {}), 2);
        assert.equal(evalExpr('max(4, 9, 2)', {}), 9);
        assert.equal(evalExpr('clamp(15, 0, 10)', {}), 10);
        assert.equal(evalExpr('round(2.6)', {}), 3);
        assert.equal(evalExpr('pow(2, 10)', {}), 1024);
    });

    it('parses exponent notation', () => {
        assert.equal(evalExpr('1e3 + 5', {}), 1005);
        assert.equal(evalExpr('2.5e-2', {}), 0.025);
    });

    it('reports where a formula is broken', () => {
        assert.throws(() => compileExpr('1 +'), ExprError);
        assert.throws(() => compileExpr('foo(1)'), /Unknown function/);
        assert.throws(() => compileExpr('min()'), /argument/);
        assert.throws(() => compileExpr('1 2'), /Unexpected token/);
        // The renderer must not throw on a broken formula
        assert.equal(evalExpr('1 +', {}), null);
    });

    it('lists the variables a formula reads, without the function names', () => {
        assert.deepEqual(exprVariables('sum(pv1, pv2) - grid').sort(), ['grid', 'pv1', 'pv2']);
    });
});

describe('format', () => {
    it('scales watts to the readable multiple', () => {
        assert.deepEqual(scaleUnit(8734, 'W'), { value: 8.734, unit: 'kW', scaled: true, scalable: true });
        assert.deepEqual(scaleUnit(734, 'W'), { value: 734, unit: 'W', scaled: false, scalable: true });
        assert.deepEqual(scaleUnit(2_500_000, 'W'), { value: 2.5, unit: 'MW', scaled: true, scalable: true });
        assert.deepEqual(scaleUnit(-8734, 'W'), { value: -8.734, unit: 'kW', scaled: true, scalable: true });
    });

    it('scales a value that is already prefixed', () => {
        assert.deepEqual(scaleUnit(0.35, 'kW'), { value: 350, unit: 'W', scaled: false, scalable: true });
        assert.deepEqual(scaleUnit(2500, 'kWh'), { value: 2.5, unit: 'MWh', scaled: true, scalable: true });
    });

    it('keeps the configured unit at exactly zero, so the display does not flip', () => {
        assert.deepEqual(scaleUnit(0, 'W'), { value: 0, unit: 'W', scaled: false, scalable: true });
    });

    it('leaves units alone that have no multiples', () => {
        assert.deepEqual(scaleUnit(4000, '%'), { value: 4000, unit: '%', scaled: false, scalable: false });
        assert.deepEqual(scaleUnit(4000, 'degC'), { value: 4000, unit: 'degC', scaled: false, scalable: false });
        assert.deepEqual(scaleUnit(4000, 'W', false), { value: 4000, unit: 'W', scaled: false, scalable: false });
    });

    it('prints whole watts and two decimals once it is kilowatts', () => {
        // The prefix decides the resolution, not the magnitude: "40,0 W" and "0,00 W" are what a
        // magnitude rule produces, and neither is how a meter reads
        assert.equal(formatValue(0, { unit: 'W', locale: 'en-US' }).text, '0 W');
        assert.equal(formatValue(40, { unit: 'W', locale: 'en-US' }).text, '40 W');
        assert.equal(formatValue(196, { unit: 'W', locale: 'en-US' }).text, '196 W');
        assert.equal(formatValue(8734, { unit: 'W', locale: 'en-US' }).text, '8.73 kW');
        assert.equal(formatValue(2_500_000, { unit: 'W', locale: 'en-US' }).text, '2.50 MW');
        // A unit with no multiples still goes by the magnitude
        assert.equal(formatValue(98, { unit: '%', locale: 'en-US' }).text, '98.0 %');
        assert.equal(formatValue(12, { unit: 'A', locale: 'en-US' }).text, '12.0 A');
    });

    it('formats with a unit and a placeholder for an unknown value', () => {
        assert.equal(formatValue(8734, { unit: 'W', locale: 'en-US' }).text, '8.73 kW');
        assert.equal(formatValue(734, { unit: 'W', locale: 'en-US' }).text, '734 W');
        assert.equal(formatValue(null, { unit: 'W' }).text, '--');
        assert.equal(formatValue(1234.5, { unit: 'W', decimals: 0, locale: 'en-US' }).text, '1 kW');
    });

    it('does not print a negative zero', () => {
        assert.equal(
            formatValue(-0.001, { unit: 'kW', decimals: 2, autoScale: false, locale: 'en-US' }).text,
            '0.00 kW',
        );
    });
});

describe('values', () => {
    it('coerces what a state can carry', () => {
        assert.equal(toNumber(5), 5);
        assert.equal(toNumber(true), 1);
        assert.equal(toNumber(false), 0);
        assert.equal(toNumber('3.5'), 3.5);
        assert.equal(toNumber('3,5'), 3.5);
        assert.equal(toNumber(''), null);
        assert.equal(toNumber(null), null);
        assert.equal(toNumber(undefined), null);
        assert.equal(toNumber('abc'), null);
        assert.equal(toNumber(Infinity), null);
    });

    it('applies factor, offset, sign, deadband and clamp in order', () => {
        const get = createValueGetter({ 'a.val': 2500 }, '.val');
        assert.equal(resolveSrc({ oid: 'a', factor: 0.001 }, get), 2.5);
        assert.equal(resolveSrc({ oid: 'a', factor: 0.001, offset: 1 }, get), 3.5);
        assert.equal(resolveSrc({ oid: 'a', invert: true }, get), -2500);
        assert.equal(resolveSrc({ oid: 'a', max: 1000 }, get), 1000);
        // The deadband is expressed in the unit the user sees, so after the factor
        assert.equal(resolveSrc({ oid: 'a', factor: 0.001, deadband: 5 }, get), 0);
    });

    it('keeps an unknown state unknown rather than zero', () => {
        const get = createValueGetter({}, '.val');
        assert.equal(resolveSrc({ oid: 'missing' }, get), null);
        assert.equal(resolveSrc({ oid: '' }, get), null);
    });

    it('resolves nested expressions', () => {
        const get = createValueGetter({ 'pv.val': 5000, 'feed.val': 1200 });
        const value = resolveSrc(
            { expr: 'pv - feed', vars: { pv: { oid: 'pv' }, feed: { oid: 'feed' } } },
            createValueGetter({ pv: 5000, feed: 1200 }),
        );
        assert.equal(value, 3800);
        assert.equal(get('pv.val'), 5000);
    });

    it('collects every state the document reads, once', () => {
        const config: EnergyFlowConfig = {
            v: 1,
            canvas: { w: 100, h: 100 },
            nodes: [
                {
                    id: 'a',
                    kind: 'source',
                    x: 0,
                    y: 0,
                    value: { expr: 'x + y', vars: { x: { oid: 's1' }, y: { oid: 's2' } } },
                    badges: [{ src: { oid: 's3' } }],
                },
                { id: 'b', kind: 'storage', x: 0, y: 0, value: { oid: 's1' }, soc: { oid: 's4' } },
            ],
            edges: [{ id: 'e', from: 'a', to: 'b', value: { oid: 's5' }, reverse: { oid: 's6' }, mode: 'split' }],
        };
        assert.deepEqual(collectOids(config).sort(), ['s1', 's2', 's3', 's4', 's5', 's6']);
    });
});

describe('geometry', () => {
    it('attaches a circle radially towards the other node', () => {
        const rect = { x: 0, y: 0, w: 100, h: 100 };
        const anchor = anchorOf(rect, 'circle', 'auto', { x: 250, y: 50 });
        assert.equal(anchor.point.x, 100);
        assert.equal(anchor.point.y, 50);
        assert.equal(anchor.dir.x, 1);
    });

    it('attaches a rectangle at the side that faces the other node', () => {
        const rect = { x: 0, y: 0, w: 100, h: 40 };
        const below = anchorOf(rect, 'rounded', 'auto', { x: 50, y: 400 });
        assert.equal(below.point.y, 40);
        assert.deepEqual(below.dir, { x: 0, y: 1 });
    });

    it('honours an explicit side', () => {
        const rect = { x: 0, y: 0, w: 100, h: 100 };
        const left = anchorOf(rect, 'circle', 'left', { x: 500, y: 50 });
        assert.equal(left.point.x, 0);
    });

    it('produces a cubic for a bezier and a polyline for waypoints', () => {
        const from = { point: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
        const to = { point: { x: 200, y: 100 }, dir: { x: -1, y: 0 } };

        const bezier = edgeGeometry(from, to, 'bezier');
        assert.ok(bezier.d.startsWith('M0 0 C'), bezier.d);
        assert.ok(bezier.length > 200, `length ${bezier.length}`);
        // The midpoint of a symmetric curve sits halfway between the endpoints
        assert.equal(Math.round(bezier.mid.x), 100);
        assert.equal(Math.round(bezier.mid.y), 50);

        const routed = edgeGeometry(from, to, 'bezier', [{ x: 100, y: 0 }]);
        assert.ok(routed.d.includes('Q'), routed.d);

        const straight = edgeGeometry(from, to, 'straight');
        assert.equal(straight.d, 'M0 0 L200 100');
    });

    it('does not produce NaN when two nodes sit on the same spot', () => {
        const same = { x: 10, y: 10, w: 40, h: 40 };
        const anchor = anchorOf(same, 'circle', 'auto', { x: 30, y: 30 });
        assert.ok(Number.isFinite(anchor.point.x) && Number.isFinite(anchor.point.y));
        const geometry = edgeGeometry(anchor, anchor, 'bezier');
        assert.ok(!geometry.d.includes('NaN'), geometry.d);
    });
});

describe('runtime', () => {
    const theme = LIGHT_THEME;

    function twoNodes(edgeExtra: Partial<EnergyFlowConfig['edges'][0]> = {}): EnergyFlowConfig {
        return {
            v: 1,
            canvas: { w: 400, h: 200 },
            defaults: { unit: 'W' },
            nodes: [
                { id: 'grid', kind: 'grid', x: 80, y: 100 },
                { id: 'home', kind: 'sink', x: 320, y: 100 },
            ],
            edges: [{ id: 'e', from: 'grid', to: 'home', value: { oid: 'p' }, ...edgeExtra }],
        };
    }

    it('reads a positive value as flowing from -> to and a negative one as the reverse', () => {
        const config = twoNodes({ mode: 'signed' });

        const importing = computeRuntime(config, createValueGetter({ p: 2400 }), theme).edges[0];
        assert.equal(importing.direction, 1);
        assert.equal(importing.magnitude, 2400);

        const exporting = computeRuntime(config, createValueGetter({ p: -1800 }), theme).edges[0];
        assert.equal(exporting.direction, -1);
        assert.equal(exporting.magnitude, 1800);
        // The label shows the amount; the direction is in the animation, not in a minus sign
        assert.equal(exporting.valueText.text.startsWith('-'), false);
    });

    it('takes the colour of wherever the energy comes from', () => {
        const config = twoNodes({ mode: 'signed' });
        const importing = computeRuntime(config, createValueGetter({ p: 2400 }), theme).edges[0];
        const exporting = computeRuntime(config, createValueGetter({ p: -2400 }), theme).edges[0];
        assert.equal(importing.color, theme.kinds.grid);
        assert.equal(exporting.color, theme.kinds.sink);
    });

    it('clamps a positive-only edge instead of reversing it', () => {
        const config = twoNodes({ mode: 'positive' });
        const runtime = computeRuntime(config, createValueGetter({ p: -50 }), theme);
        assert.equal(runtime.edges[0].value, 0);
        assert.equal(runtime.edges[0].direction, 0);
    });

    it('nets the two states of a split edge', () => {
        const config = twoNodes({ mode: 'split', value: { oid: 'in' }, reverse: { oid: 'out' } });
        const runtime = computeRuntime(config, createValueGetter({ in: 300, out: 1300 }), theme);
        assert.equal(runtime.edges[0].value, -1000);
        assert.equal(runtime.edges[0].direction, -1);

        const unknown = computeRuntime(config, createValueGetter({}), theme);
        assert.equal(unknown.edges[0].value, null);
    });

    it('treats a value below the threshold as idle and does not animate it', () => {
        const config = twoNodes({ threshold: 20 });
        const runtime = computeRuntime(config, createValueGetter({ p: 12 }), theme);
        assert.equal(runtime.edges[0].active, false);
        assert.equal(runtime.edges[0].dotDuration, 0);
        assert.equal(runtime.edges[0].direction, 0);
    });

    it('moves the dots faster the more power flows, within the clamp', () => {
        const config = twoNodes();
        const slow = computeRuntime(config, createValueGetter({ p: 500 }), theme).edges[0].dotDuration;
        const fast = computeRuntime(config, createValueGetter({ p: 6000 }), theme).edges[0].dotDuration;
        assert.ok(fast < slow, `${fast} should be shorter than ${slow}`);

        const enormous = computeRuntime(config, createValueGetter({ p: 900000 }), theme).edges[0].dotDuration;
        assert.ok(enormous >= 0.18, `clamped to the minimum, got ${enormous}`);
    });

    it('hides a node whose value is zero when asked, and the edges with it', () => {
        const config = twoNodes();
        config.nodes[1] = { ...config.nodes[1], hideWhenZero: true, value: { oid: 'w' } };

        const off = computeRuntime(config, createValueGetter({ p: 1000, w: 0 }), theme);
        assert.equal(off.nodeById.home.visible, false);
        assert.equal(off.edges[0].visible, false);

        const on = computeRuntime(config, createValueGetter({ p: 1000, w: 4000 }), theme);
        assert.equal(on.nodeById.home.visible, true);
        assert.equal(on.edges[0].visible, true);
    });

    it('skips an edge whose endpoint was deleted instead of throwing', () => {
        const config = twoNodes();
        config.edges.push({ id: 'dangling', from: 'grid', to: 'ghost', value: { oid: 'p' } });
        const runtime = computeRuntime(config, createValueGetter({ p: 100 }), theme);
        assert.equal(runtime.edges.length, 1);
    });

    it('derives a node value from its connections when nothing is bound to it', () => {
        const config = buildPreset('pv-battery-home', key => key);
        // The three states the template asks for: PV production, grid power, battery power
        const bind = (id: string, oid: string): void => {
            const edge = config.edges.find(item => item.id === id)!;
            edge.value = { oid };
        };
        bind('pv-home', 'pv');
        bind('grid-home', 'grid');
        bind('battery-home', 'battery');

        // 6.4 kW from the roof, 0.9 kW bought, 2.1 kW into the battery
        const runtime = computeRuntime(config, createValueGetter({ pv: 6400, grid: 900, battery: -2100 }), theme);

        // A producer shows what leaves it, so the sun is positive
        assert.equal(runtime.nodeById.pv.value, 6400);
        // The grid shows what it delivers: positive while buying
        assert.equal(runtime.nodeById.grid.value, 900);
        // The battery is charging, so it delivers a negative amount
        assert.equal(runtime.nodeById.battery.value, -2100);
        // The house shows what arrives: 6400 + 900 - 2100
        assert.equal(runtime.nodeById.home.value, 5200);
    });

    it('shows the production of a producer that is itself fed by sub-producers', () => {
        // Four MPPT strings into one "production" box, which then feeds the house: the box must show
        // what it produces, not the net of in and out -- which is zero by conservation
        const config: EnergyFlowConfig = {
            v: 1,
            canvas: { w: 600, h: 400 },
            defaults: { unit: 'W' },
            nodes: [
                { id: 's1', kind: 'source', x: 60, y: 60 },
                { id: 's2', kind: 'source', x: 180, y: 60 },
                { id: 'pv', kind: 'source', x: 120, y: 200 },
                { id: 'home', kind: 'sink', x: 400, y: 200 },
            ],
            edges: [
                { id: 'e1', from: 's1', to: 'pv', value: { oid: 'a' }, mode: 'positive' },
                { id: 'e2', from: 's2', to: 'pv', value: { oid: 'b' }, mode: 'positive' },
                { id: 'e3', from: 'pv', to: 'home', value: { oid: 'c' }, mode: 'positive' },
            ],
        };
        const runtime = computeRuntime(config, createValueGetter({ a: 1800, b: 2200, c: 4000 }), theme);
        assert.equal(runtime.nodeById.pv.value, 4000);
        assert.equal(runtime.nodeById.home.value, 4000);
    });

    it('shows what passes through a junction', () => {
        const config = buildPreset('pv-battery-wallbox', key => key);
        const bind = (id: string, oid: string): void => {
            config.edges.find(item => item.id === id)!.value = { oid };
        };
        bind('pv-bus', 'pv');
        bind('grid-bus', 'grid');
        bind('battery-bus', 'battery');
        bind('bus-home', 'home');
        bind('bus-wallbox', 'wallbox');

        const runtime = computeRuntime(
            config,
            // 6 kW from the roof and 1 kW from the grid arrive; 4 kW house, 3 kW wallbox leave
            createValueGetter({ pv: 6000, grid: 1000, battery: 0, home: 4000, wallbox: 3000 }),
            theme,
        );
        assert.equal(runtime.nodeById.bus.value, 7000);
    });

    it('lets a node with its own source override the derived one', () => {
        const config = buildPreset('pv-home', key => key);
        config.edges[0].value = { oid: 'pv' };
        config.nodes[0] = { ...config.nodes[0], value: { oid: 'ownValue' } };

        const runtime = computeRuntime(config, createValueGetter({ pv: 6400, ownValue: 42 }), theme);
        assert.equal(runtime.nodeById.pv.value, 42);
    });

    it('keeps a node unknown when nothing connected to it has a value', () => {
        const config = buildPreset('pv-battery-home', key => key);
        const runtime = computeRuntime(config, () => null, theme);
        assert.ok(runtime.nodes.every(node => node.value === null));
        assert.ok(runtime.nodes.every(node => node.valueText.text === '--'));
    });

    it('clamps the state of charge to 0..100', () => {
        const config: EnergyFlowConfig = {
            v: 1,
            canvas: { w: 200, h: 200 },
            nodes: [{ id: 'b', kind: 'storage', x: 100, y: 100, soc: { oid: 'soc' } }],
            edges: [],
        };
        assert.equal(computeRuntime(config, createValueGetter({ soc: 142 }), theme).nodes[0].soc, 100);
        assert.equal(computeRuntime(config, createValueGetter({ soc: -3 }), theme).nodes[0].soc, 0);
        assert.equal(computeRuntime(config, createValueGetter({}), theme).nodes[0].soc, null);
    });
});

describe('defaults', () => {
    it('survives anything the host may have stored', () => {
        assert.deepEqual(normalizeConfig(undefined).nodes, []);
        assert.deepEqual(normalizeConfig('').nodes, []);
        assert.deepEqual(normalizeConfig('not json').nodes, []);
        assert.deepEqual(normalizeConfig(42).nodes, []);
        assert.equal(normalizeConfig('{"v":1,"canvas":{"w":300,"h":200},"nodes":[],"edges":[]}').canvas.w, 300);
        // A node without an id and an edge with a missing endpoint are dropped, the rest survives
        const partial = normalizeConfig({
            v: 1,
            canvas: { w: 0, h: -5 },
            nodes: [{ kind: 'source' }, { id: 'ok', kind: 'source', x: 1, y: 1 }],
            edges: [
                { id: 'e1', from: 'ok' },
                { id: 'e2', from: 'ok', to: 'ok' },
            ],
        });
        assert.equal(partial.nodes.length, 1);
        assert.equal(partial.edges.length, 1);
        assert.ok(partial.canvas.w > 0 && partial.canvas.h > 0);
    });

    it('puts the stored position at the centre of the node box', () => {
        const rect = nodeRect({ id: 'n', kind: 'source', x: 100, y: 200 });
        assert.equal(rect.x + rect.w / 2, 100);
        assert.equal(rect.y + rect.h / 2, 200);
    });
});

describe('theme', () => {
    it('parses the colour notations a document can contain', () => {
        assert.deepEqual(parseColorString('#abc'), [170, 187, 204]);
        assert.deepEqual(parseColorString('#AABBCC'), [170, 187, 204]);
        // The alpha channel is dropped rather than refused
        assert.deepEqual(parseColorString('#AABBCC80'), [170, 187, 204]);
        assert.deepEqual(parseColorString('rgb(1, 2, 3)'), [1, 2, 3]);
        assert.deepEqual(parseColorString('rgb(1 2 3)'), [1, 2, 3]);
        assert.deepEqual(parseColorString('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
        assert.deepEqual(parseColorString('rgb(1 2 3 / 50%)'), [1, 2, 3]);
        // Not parseable, and the callers must fall back rather than draw something wrong
        assert.equal(parseColorString('red'), null);
        assert.equal(parseColorString('hsl(10, 20%, 30%)'), null);
        assert.equal(parseColorString('var(--x)'), null);
        assert.equal(parseColorString(''), null);
    });

    it('falls back instead of crashing on a colour it cannot read', () => {
        assert.equal(muteColor('var(--x)', LIGHT_THEME), LIGHT_THEME.idle);
        assert.equal(withAlpha('var(--x)', 0.5), 'var(--x)');
        assert.equal(withAlpha('#000000', 0.5), 'rgba(0, 0, 0, 0.5)');
    });

    it('mutes a colour towards the idle colour, not past it', () => {
        assert.equal(muteColor('#000000', LIGHT_THEME, 0), 'rgb(0, 0, 0)');
        assert.equal(muteColor('#000000', LIGHT_THEME, 1), 'rgb(199, 208, 217)');
    });

    it('keeps the node accents out of the host palette', () => {
        // A blue primary colour in vis-2 must not turn the photovoltaics blue
        const flattened = themeFromMui({
            palette: { mode: 'dark', primary: { main: '#0000ff' }, text: { primary: '#fafafa' } },
        });
        assert.equal(flattened.mode, 'dark');
        assert.equal(flattened.text, '#fafafa');
        assert.equal(flattened.kinds.source, DARK_THEME.kinds.source);
    });

    it('survives a host that has no theme yet', () => {
        const flattened = themeFromMui(undefined);
        assert.equal(flattened.mode, 'light');
        assert.equal(flattened.kinds.source, LIGHT_THEME.kinds.source);
    });
});

describe('model', () => {
    it('numbers a duplicate id instead of overwriting it', () => {
        assert.equal(uniqueId('pv', []), 'pv');
        assert.equal(uniqueId('pv', ['pv']), 'pv-2');
        assert.equal(uniqueId('pv', ['pv', 'pv-2']), 'pv-3');
    });

    it('removes the edges of a deleted node', () => {
        const config = buildPreset('pv-battery-home', key => key);
        const without = removeNode(config, 'battery');
        assert.equal(without.nodes.length, 3);
        assert.ok(!without.edges.some(edge => edge.from === 'battery' || edge.to === 'battery'));
    });

    it('keeps the edges attached when a node is renamed', () => {
        const config = buildPreset('pv-battery-home', key => key);
        const renamed = renameNode(config, 'pv', 'roof');
        assert.ok(renamed.nodes.some(node => node.id === 'roof'));
        assert.ok(renamed.edges.some(edge => edge.from === 'roof'));
        // A name that is taken changes nothing
        assert.equal(renameNode(renamed, 'roof', 'grid'), renamed);
    });

    it('snaps a moved node onto the grid', () => {
        const config = buildPreset('pv-home', key => key);
        const moved = moveNodes(config, ['pv'], 13, 7);
        const pv = moved.nodes.find(node => node.id === 'pv')!;
        assert.equal(pv.x % 10, 0);
        assert.equal(pv.y % 10, 0);
    });

    it('guesses a bidirectional edge for the grid and the battery', () => {
        const config = buildPreset('pv-battery-home', key => key);
        assert.equal(createEdge(config, 'grid', 'home').mode, 'signed');
        assert.equal(createEdge(config, 'battery', 'home').mode, 'signed');
        assert.equal(createEdge(config, 'pv', 'home').mode, 'positive');
    });

    it('gives a new node an empty source so it can be bound right away', () => {
        const config = buildPreset('pv-home', key => key);
        assert.ok(createNode(config, 'sink', { x: 55, y: 55 }).value);
        assert.equal(createNode(config, 'label', { x: 55, y: 55 }).value, undefined);
        assert.ok(createNode(config, 'storage', { x: 55, y: 55 }).soc);
        // Snapped, and the id does not collide with the preset
        const second = createNode(config, 'grid', { x: 57, y: 53 });
        assert.equal(second.x, 60);
        assert.equal(second.id, 'grid-2');
    });

    it('fits the canvas around the content', () => {
        const config = buildPreset('pv-battery-home', key => key);
        const spread = moveNodes(config, ['pv'], -400, -300);
        const fitted = fitCanvas(spread);
        assert.ok(fitted.nodes.every(node => node.x > 0 && node.y > 0));
        assert.ok(fitted.canvas.w > 0 && fitted.canvas.h > 0);
    });
});

describe('examples', () => {
    it('hybrid-12v is a valid, fully connected diagram', () => {
        const raw = readFileSync(new URL('../examples/hybrid-12v.json', import.meta.url), 'utf8');
        const config = normalizeConfig(JSON.parse(raw));

        // Nothing was dropped by the normalisation: every node has an id, every edge two real ends
        const parsed = JSON.parse(raw) as EnergyFlowConfig;
        assert.equal(config.nodes.length, parsed.nodes.length);
        assert.equal(config.edges.length, parsed.edges.length);

        const runtime = computeRuntime(config, () => null, LIGHT_THEME);
        assert.equal(runtime.edges.length, config.edges.length, 'an edge points at a node that does not exist');
        assert.ok(runtime.nodes.every(node => !node.valueText.text.includes('NaN')));

        // It ships unbound: the point of an example is the layout, not somebody else's state ids
        const oids = collectOids(config);
        assert.deepEqual(oids, [], `expected no state ids, found ${oids.join(', ')}`);

        // Every icon it names exists, including the ones added for it
        for (const node of config.nodes) {
            if (node.icon && !node.icon.startsWith('http') && !node.icon.startsWith('data:')) {
                assert.ok(BUILTIN_ICONS[node.icon], `unknown icon "${node.icon}" on node "${node.id}"`);
            }
        }
    });

    it('derives the battery power from its two lines', () => {
        const config = normalizeConfig(
            JSON.parse(readFileSync(new URL('../examples/hybrid-12v.json', import.meta.url), 'utf8')),
        );
        const bind = (id: string, oid: string): void => {
            config.edges.find(edge => edge.id === id)!.value = { oid };
        };
        bind('battery-dc', 'out');
        bind('grid-battery', 'in');

        // 196 W towards the DC branch while 156 W arrive from the charger
        const runtime = computeRuntime(config, createValueGetter({ out: 196, in: 156 }), LIGHT_THEME);
        assert.equal(runtime.nodeById.battery.value, 40);
        assert.equal(runtime.nodeById.battery.valueText.text, '40 W');
    });

    it('gives the strings no icon, rather than the one their kind implies', () => {
        const config = normalizeConfig(
            JSON.parse(readFileSync(new URL('../examples/hybrid-12v.json', import.meta.url), 'utf8')),
        );
        const runtime = computeRuntime(config, () => null, LIGHT_THEME);
        assert.equal(runtime.nodeById.mppt1.icon, '');
        // ... while a node that says nothing about its icon still gets one
        assert.equal(runtime.nodeById.pv.icon, 'solar');
    });
});

describe('import from energiefluss-erweitert', () => {
    /** The layout that adapter ships as its default -- the one document of that format everybody has */
    const DEFAULT_DOC = JSON.parse(
        readFileSync(new URL('./fixtures/energiefluss-default.json', import.meta.url), 'utf8'),
    ) as unknown;

    it('recognises the format, and does not claim anything else', () => {
        assert.equal(isEnergiefluss(DEFAULT_DOC), true);
        // Our own documents must not be mistaken for it, or a paste would convert into nothing
        assert.equal(isEnergiefluss(buildPreset('pv-battery-home', key => key)), false);
        assert.equal(isEnergiefluss({ elements: {} }), false, 'elements alone is too generic to claim');
        assert.equal(isEnergiefluss(null), false);
        assert.equal(isEnergiefluss('{}'), false);
        assert.equal(isEnergiefluss([]), false);
    });

    it('rebuilds the nodes from the connection keys and the boxes', () => {
        const { config, stats } = importEnergiefluss(DEFAULT_DOC);

        // Production, consumption, battery, grid, car -- and the 17 texts and icons folded into them
        assert.equal(stats.nodes, 5);
        assert.equal(stats.edges, 5);
        assert.equal(stats.merged, 17);

        const byId = Object.fromEntries(config.nodes.map(node => [node.id, node]));
        assert.equal(byId.n5.label, 'Produktion');
        assert.equal(byId.n7.label, 'Verbrauch');
        assert.equal(byId.n13.label, 'Batterie');
        assert.equal(byId.n14.label, 'Netz');
        assert.equal(byId.n22.label, 'Auto');
    });

    it('guesses the kind from the icon and the label', () => {
        const byId = Object.fromEntries(importEnergiefluss(DEFAULT_DOC).config.nodes.map(n => [n.id, n]));
        assert.equal(byId.n5.kind, 'source');
        assert.equal(byId.n13.kind, 'storage');
        assert.equal(byId.n14.kind, 'grid');
        assert.equal(byId.n7.kind, 'sink');
    });

    it('matches icons by keyword, not by exact name', () => {
        const byId = Object.fromEntries(importEnergiefluss(DEFAULT_DOC).config.nodes.map(n => [n.id, n]));
        // mdi:solar-panel, mdi:house-city, mdi:battery-high, mdi:electricity-from-grid and
        // material-symbols:electric-car -- not one of which is a name this set knows
        assert.equal(byId.n5.icon, 'solar');
        assert.equal(byId.n7.icon, 'house');
        assert.equal(byId.n13.icon, 'battery');
        assert.equal(byId.n14.icon, 'grid');
        assert.equal(byId.n22.icon, 'car');
    });

    it('matches a bare icon name, not only a compound one', () => {
        // A regression guard: the patterns used word boundaries once, and a mangled escape turned
        // them into control characters, so `mdi:car` matched nothing while `electric-car` still did
        const iconOf = (icon: string): string | undefined => {
            const document = {
                elements: {
                    1: { type: 'rect', pos_x: 0, pos_y: 0, width: 100, height: 100 },
                    2: { type: 'icon', pos_x: 50, pos_y: 50, icon },
                },
                defs: {},
            };
            return importEnergiefluss(document).config.nodes[0].icon;
        };

        assert.equal(iconOf('mdi:car'), 'car');
        assert.equal(iconOf('mdi:car-electric'), 'car');
        assert.equal(iconOf('material-symbols:electric-car'), 'car');
        assert.equal(iconOf('mdi:gas'), 'flame');
        assert.equal(iconOf('mdi:nas'), 'server');
        // And something that merely contains the letters must not match
        assert.equal(iconOf('mdi:carpet'), undefined);
    });

    it('keeps the geometry, converting the corner to a centre', () => {
        const byId = Object.fromEntries(importEnergiefluss(DEFAULT_DOC).config.nodes.map(n => [n.id, n]));
        // The source stores the top-left corner (167, 2) with a size of 100 x 100
        assert.equal(byId.n5.x, 217);
        assert.equal(byId.n5.y, 52);
        assert.equal(byId.n5.w, 100);
        assert.equal(byId.n5.h, 100);
        assert.equal(byId.n5.shape, 'rounded');
    });

    it('reads the direction of a connection out of its key', () => {
        const { config } = importEnergiefluss(DEFAULT_DOC);
        const edge = config.edges.find(item => item.id === 'e5_7')!;
        assert.equal(edge.from, 'n5');
        assert.equal(edge.to, 'n7');
        assert.equal(edge.fromSide, 'bottom', 'bottom_right keeps only the axis');
        assert.equal(edge.toSide, 'top');
        assert.equal(edge.curve, 'orthogonal');
    });

    it('produces a diagram that renders', () => {
        const { config } = importEnergiefluss(DEFAULT_DOC);
        const runtime = computeRuntime(config, () => null, LIGHT_THEME);
        assert.equal(runtime.edges.length, config.edges.length);
        assert.ok(runtime.nodes.every(node => !node.valueText.text.includes('NaN')));
        for (const node of config.nodes) {
            if (node.icon) {
                assert.ok(BUILTIN_ICONS[node.icon], `unknown icon "${node.icon}"`);
            }
        }
    });

    it('turns the datasource indices into state ids', () => {
        const document = {
            basic: { width: 400, height: 300 },
            datasources: { 0: { source: 'pv.0.power' }, 1: { source: 'grid.0.power' } },
            elements: {
                1: { type: 'rect', pos_x: 10, pos_y: 10, width: 100, height: 100, rx: 10, color: 'rgb(1,2,3)' },
                2: { type: 'rect', pos_x: 250, pos_y: 10, width: 100, height: 100, rx: 10 },
                3: {
                    type: 'text',
                    subType: 'datasource',
                    pos_x: 60,
                    pos_y: 60,
                    source: 0,
                    unit: 'W',
                    decimal_places: 1,
                    calculate_kw: 'auto',
                },
            },
            defs: { path_1_2: { id: 'path_1_2', startSlot: 'right', endSlot: 'left' } },
            animations: { anim_path_1_2: { source: 1, threshold: 5, animation_properties: 'positive' } },
            lines: { line_path_1_2: { color: '#abcdef' } },
        };

        const { config, stats } = importEnergiefluss(document);
        assert.equal(stats.bindings, 2);

        const node = config.nodes.find(item => item.id === 'n1')!;
        assert.deepEqual(node.value, { oid: 'pv.0.power' });
        // calculate_kw 'auto' is exactly this widget's automatic scaling
        assert.equal(node.unit, 'W');
        assert.equal(node.autoScale, true);
        assert.equal(node.decimals, 1);
        assert.equal(node.color, 'rgb(1,2,3)');

        const edge = config.edges[0];
        assert.deepEqual(edge.value, { oid: 'grid.0.power' });
        assert.equal(edge.threshold, 5);
        assert.equal(config.canvas.w, 400);
        assert.equal(config.canvas.h, 300);
    });

    it('turns add, subtract and convert into one formula', () => {
        const document = {
            datasources: { 0: { source: 'a' }, 1: { source: 'b' }, 2: { source: 'c' } },
            elements: {
                1: { type: 'rect', pos_x: 0, pos_y: 0, width: 100, height: 100 },
                2: {
                    type: 'text',
                    subType: 'datasource',
                    pos_x: 50,
                    pos_y: 50,
                    source: 0,
                    add: [1],
                    subtract: [2],
                    convert: true,
                    calculate_kw: 'auto',
                },
            },
            defs: {},
        };
        const node = importEnergiefluss(document).config.nodes[0];
        const value = node.value as { expr: string; vars: Record<string, { oid: string }> };
        assert.equal(value.expr, 'abs(a + b0 - c1)');
        assert.deepEqual(
            Object.values(value.vars).map(item => item.oid),
            ['a', 'b', 'c'],
        );

        // And the formula has to be one this widget can actually evaluate
        const runtime = computeRuntime(
            importEnergiefluss(document).config,
            createValueGetter({ a: 100, b: 50, c: 400 }),
            LIGHT_THEME,
        );
        assert.equal(runtime.nodes[0].value, 250);
    });

    it('divides by 1000 where the original does, instead of auto-scaling', () => {
        const document = {
            datasources: { 0: { source: 'a' } },
            elements: {
                1: { type: 'rect', pos_x: 0, pos_y: 0, width: 100, height: 100 },
                2: { type: 'text', subType: 'datasource', pos_x: 50, pos_y: 50, source: 0, calculate_kw: 'calc' },
            },
            defs: {},
        };
        const config = importEnergiefluss(document).config;
        assert.deepEqual(config.nodes[0].value, { oid: 'a', factor: 0.001 });
        assert.equal(config.nodes[0].unit, 'kW');
        assert.equal(config.nodes[0].autoScale, false);

        // 8734 W stays 8.73 kW rather than being scaled again
        const runtime = computeRuntime(
            config,
            createValueGetter({ a: 8734 }),
            createTheme('light', { locale: 'en-US' }),
        );
        assert.equal(runtime.nodes[0].valueText.text, '8.73 kW');
    });

    it('inverts a connection that animates on negative values', () => {
        const document = {
            datasources: { 0: { source: 'a' } },
            elements: {
                1: { type: 'rect', pos_x: 0, pos_y: 0, width: 100, height: 100 },
                2: { type: 'rect', pos_x: 200, pos_y: 0, width: 100, height: 100 },
            },
            defs: { path_1_2: { id: 'path_1_2' } },
            animations: { anim_path_1_2: { source: 0, animation_properties: 'negative' } },
        };
        const edge = importEnergiefluss(document).config.edges[0];
        assert.deepEqual(edge.value, { oid: 'a', invert: true });

        const runtime = computeRuntime(
            importEnergiefluss(document).config,
            createValueGetter({ a: -500 }),
            LIGHT_THEME,
        );
        // A reading of -500 flows from the first element to the second, as it did before
        assert.equal(runtime.edges[0].direction, 1);
        assert.equal(runtime.edges[0].magnitude, 500);
    });

    it('reports what it could not carry over instead of dropping it silently', () => {
        const { warnings } = importEnergiefluss(DEFAULT_DOC);
        // Every value element of the default has calculate_kw 'none', which blanks its unit
        assert.ok(warnings.some(item => item.code === 'unit-blanked'));
        assert.ok(
            warnings.every(item => item.detail.length > 10),
            'a warning has to say something actionable',
        );
    });

    it('drops a connection to an element that no longer exists, and says so', () => {
        const document = {
            elements: { 1: { type: 'rect', pos_x: 0, pos_y: 0, width: 100, height: 100 } },
            defs: { path_1_9: { id: 'path_1_9' }, broken: { id: 'broken' } },
        };
        const { config, warnings } = importEnergiefluss(document);
        assert.equal(config.edges.length, 0);
        assert.equal(warnings.filter(item => item.code === 'edge-dropped').length, 2);
    });

    it('survives an empty or nonsensical document', () => {
        for (const input of [undefined, null, {}, { elements: {} }, 42, 'nope']) {
            const { config } = importEnergiefluss(input);
            assert.deepEqual(config.nodes, []);
            assert.deepEqual(config.edges, []);
            assert.ok(config.canvas.w > 0 && config.canvas.h > 0);
        }
    });
});

describe('presets', () => {
    it('every preset renders without an unresolved reference', () => {
        for (const id of [
            'pv-home',
            'pv-battery-home',
            'pv-battery-wallbox',
            'pv-battery-heating',
            'grid-home',
        ] as const) {
            const config = buildPreset(id, key => key);
            const runtime = computeRuntime(config, () => null, LIGHT_THEME);
            assert.equal(
                runtime.edges.length,
                config.edges.length,
                `${id}: an edge points at a node that does not exist`,
            );
            // Nothing is configured yet, so everything must render its placeholder rather than "NaN"
            assert.ok(
                runtime.nodes.every(node => !node.valueText.text.includes('NaN')),
                id,
            );
            assert.ok(
                runtime.edges.every(edge => edge.direction === 0),
                id,
            );
        }
    });

    it('asks for one state per direction pair, not two', () => {
        const config = buildPreset('pv-battery-home', key => key);
        const grid = config.edges.find(edge => edge.from === 'grid')!;
        assert.equal(grid.mode, 'signed');
        assert.equal(grid.reverse, undefined);
    });
});
