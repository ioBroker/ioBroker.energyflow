/**
 * Ready-made diagrams.
 *
 * This is the single biggest usability difference to the predecessor, where a new installation opens
 * an empty canvas and the user has to place every circle and draw every line before anything works.
 * Here they pick the shape of their house, and the only thing left is to say which state is the PV
 * power -- the layout, the colours, the directions and the routing are already right.
 *
 * The layouts are deliberately built around the *minimum number of states* a setup really needs. The
 * classic four-node diagram gets by with three: PV power, grid power and battery power, the latter
 * two signed. A diagram that asks for "grid import" and "grid feed-in" separately is asking the user
 * to solve a problem the `signed` edge mode already solves.
 */
import { mediumDefaults, type MediumId } from './media';
import type { FlowConfig, FlowEdge, FlowNode } from './types';

export type PresetId =
    | 'pv-home'
    | 'pv-battery-home'
    | 'pv-battery-wallbox'
    | 'pv-battery-heating'
    | 'grid-home'
    | 'water-house'
    | 'water-cistern'
    | 'gas-house'
    | 'heat-pump'
    | 'empty';

export interface PresetInfo {
    id: PresetId;
    /** i18n key of the name */
    label: string;
    /** i18n key of the one-line description */
    description: string;
    /** What flows through it; the designer offers the ones of the diagram's medium first */
    medium: MediumId;
}

export const PRESETS: PresetInfo[] = [
    {
        id: 'pv-battery-home',
        label: 'preset_pv_battery_home',
        description: 'preset_pv_battery_home_desc',
        medium: 'energy',
    },
    { id: 'pv-home', label: 'preset_pv_home', description: 'preset_pv_home_desc', medium: 'energy' },
    {
        id: 'pv-battery-wallbox',
        label: 'preset_pv_battery_wallbox',
        description: 'preset_pv_battery_wallbox_desc',
        medium: 'energy',
    },
    {
        id: 'pv-battery-heating',
        label: 'preset_pv_battery_heating',
        description: 'preset_pv_battery_heating_desc',
        medium: 'energy',
    },
    { id: 'grid-home', label: 'preset_grid_home', description: 'preset_grid_home_desc', medium: 'energy' },
    { id: 'water-house', label: 'preset_water_house', description: 'preset_water_house_desc', medium: 'water' },
    {
        id: 'water-cistern',
        label: 'preset_water_cistern',
        description: 'preset_water_cistern_desc',
        medium: 'water',
    },
    { id: 'gas-house', label: 'preset_gas_house', description: 'preset_gas_house_desc', medium: 'gas' },
    { id: 'heat-pump', label: 'preset_heat_pump', description: 'preset_heat_pump_desc', medium: 'heat' },
    { id: 'empty', label: 'preset_empty', description: 'preset_empty_desc', medium: 'energy' },
];

/** Translates an i18n key; the editor passes the host's `I18n.t` */
export type Translator = (key: string) => string;

/** Watts, because that is what virtually every inverter and meter adapter in ioBroker reports */
const BASE_DEFAULTS: FlowConfig['defaults'] = {
    unit: 'W',
    lineWidth: 3,
    fontSize: 17,
};

/** The same, for a diagram that carries something else: the unit and the dot speed of that medium */
function defaultsOf(medium: MediumId): FlowConfig['defaults'] {
    return { ...BASE_DEFAULTS, ...mediumDefaults(medium) };
}

function node(partial: FlowNode): FlowNode {
    return partial;
}

function edge(partial: FlowEdge): FlowEdge {
    return partial;
}

/**
 * Build one of the ready-made diagrams.
 *
 * Every value source is left empty on purpose: the editor opens on the first node right after, and a
 * preset that came with somebody else's state ids would be worse than one that comes with none.
 *
 * @param id which preset
 * @param t translates the node labels
 * @returns a complete, valid document
 */
export function buildPreset(id: PresetId, t: Translator): FlowConfig {
    switch (id) {
        case 'pv-home':
            return {
                v: 1,
                canvas: { w: 820, h: 470, grid: 10 },
                defaults: { ...BASE_DEFAULTS },
                nodes: [
                    node({ id: 'pv', kind: 'source', x: 210, y: 120, icon: 'solar', label: t('node_pv') }),
                    node({ id: 'grid', kind: 'grid', x: 210, y: 350, icon: 'grid', label: t('node_grid') }),
                    node({ id: 'home', kind: 'sink', x: 610, y: 235, icon: 'house', label: t('node_home') }),
                ],
                edges: [
                    edge({ id: 'pv-home', from: 'pv', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'grid-home', from: 'grid', to: 'home', value: { oid: '' }, mode: 'signed' }),
                ],
            };

        case 'pv-battery-home':
            return {
                v: 1,
                canvas: { w: 900, h: 560, grid: 10 },
                defaults: { ...BASE_DEFAULTS },
                nodes: [
                    node({ id: 'pv', kind: 'source', x: 450, y: 100, icon: 'solar', label: t('node_pv') }),
                    node({ id: 'grid', kind: 'grid', x: 140, y: 400, icon: 'grid', label: t('node_grid') }),
                    node({
                        id: 'battery',
                        kind: 'storage',
                        x: 760,
                        y: 400,
                        icon: 'battery',
                        label: t('node_battery'),
                        soc: { oid: '' },
                    }),
                    node({ id: 'home', kind: 'sink', x: 450, y: 330, icon: 'house', label: t('node_home') }),
                ],
                edges: [
                    edge({ id: 'pv-home', from: 'pv', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'grid-home', from: 'grid', to: 'home', value: { oid: '' }, mode: 'signed' }),
                    // Positive discharges into the house, negative charges the battery -- one state
                    edge({ id: 'battery-home', from: 'battery', to: 'home', value: { oid: '' }, mode: 'signed' }),
                ],
            };

        case 'pv-battery-wallbox':
            return {
                v: 1,
                canvas: { w: 940, h: 620, grid: 10 },
                defaults: { ...BASE_DEFAULTS },
                nodes: [
                    node({ id: 'pv', kind: 'source', x: 470, y: 100, icon: 'solar', label: t('node_pv') }),
                    node({ id: 'grid', kind: 'grid', x: 130, y: 300, icon: 'grid', label: t('node_grid') }),
                    node({
                        id: 'battery',
                        kind: 'storage',
                        x: 810,
                        y: 300,
                        icon: 'battery',
                        label: t('node_battery'),
                        soc: { oid: '' },
                    }),
                    // A junction, so five elements share one crossing point instead of every line
                    // running to every other node
                    node({ id: 'bus', kind: 'bus', x: 470, y: 300 }),
                    node({ id: 'home', kind: 'sink', x: 320, y: 510, icon: 'house', label: t('node_home') }),
                    node({
                        id: 'wallbox',
                        kind: 'sink',
                        x: 630,
                        y: 510,
                        icon: 'wallbox',
                        label: t('node_wallbox'),
                        hideWhenZero: false,
                    }),
                ],
                edges: [
                    edge({ id: 'pv-bus', from: 'pv', to: 'bus', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'grid-bus', from: 'grid', to: 'bus', value: { oid: '' }, mode: 'signed' }),
                    edge({ id: 'battery-bus', from: 'battery', to: 'bus', value: { oid: '' }, mode: 'signed' }),
                    edge({ id: 'bus-home', from: 'bus', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'bus-wallbox', from: 'bus', to: 'wallbox', value: { oid: '' }, mode: 'positive' }),
                ],
            };

        case 'pv-battery-heating':
            return {
                v: 1,
                canvas: { w: 940, h: 620, grid: 10 },
                defaults: { ...BASE_DEFAULTS },
                nodes: [
                    node({ id: 'pv', kind: 'source', x: 470, y: 100, icon: 'solar', label: t('node_pv') }),
                    node({ id: 'grid', kind: 'grid', x: 130, y: 300, icon: 'grid', label: t('node_grid') }),
                    node({
                        id: 'battery',
                        kind: 'storage',
                        x: 810,
                        y: 300,
                        icon: 'battery',
                        label: t('node_battery'),
                        soc: { oid: '' },
                    }),
                    node({ id: 'bus', kind: 'bus', x: 470, y: 300 }),
                    node({ id: 'home', kind: 'sink', x: 320, y: 510, icon: 'house', label: t('node_home') }),
                    node({
                        id: 'heatpump',
                        kind: 'sink',
                        x: 630,
                        y: 510,
                        icon: 'heatpump',
                        label: t('node_heatpump'),
                    }),
                ],
                edges: [
                    edge({ id: 'pv-bus', from: 'pv', to: 'bus', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'grid-bus', from: 'grid', to: 'bus', value: { oid: '' }, mode: 'signed' }),
                    edge({ id: 'battery-bus', from: 'battery', to: 'bus', value: { oid: '' }, mode: 'signed' }),
                    edge({ id: 'bus-home', from: 'bus', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'bus-heatpump', from: 'bus', to: 'heatpump', value: { oid: '' }, mode: 'positive' }),
                ],
            };

        case 'water-house':
            return {
                v: 1,
                canvas: { w: 860, h: 470, grid: 10 },
                defaults: defaultsOf('water'),
                nodes: [
                    node({
                        id: 'meter',
                        kind: 'grid',
                        x: 160,
                        y: 235,
                        icon: 'watermeter',
                        label: t('node_water_meter'),
                    }),
                    node({ id: 'home', kind: 'sink', x: 470, y: 235, icon: 'house', label: t('node_home') }),
                    node({ id: 'bath', kind: 'sink', x: 740, y: 120, icon: 'shower', label: t('node_bath') }),
                    node({ id: 'garden', kind: 'sink', x: 740, y: 350, icon: 'sprinkler', label: t('node_garden') }),
                ],
                edges: [
                    edge({ id: 'meter-home', from: 'meter', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'home-bath', from: 'home', to: 'bath', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'home-garden', from: 'home', to: 'garden', value: { oid: '' }, mode: 'positive' }),
                ],
            };

        case 'water-cistern':
            return {
                v: 1,
                canvas: { w: 900, h: 560, grid: 10 },
                defaults: defaultsOf('water'),
                nodes: [
                    node({ id: 'rain', kind: 'source', x: 200, y: 120, icon: 'rain', label: t('node_rain') }),
                    node({
                        id: 'cistern',
                        kind: 'storage',
                        x: 450,
                        y: 300,
                        icon: 'tank',
                        label: t('node_cistern'),
                        // A cistern shows how full it is, which is the number its sensor reports
                        soc: { oid: '' },
                    }),
                    node({
                        id: 'meter',
                        kind: 'grid',
                        x: 200,
                        y: 480,
                        icon: 'watermeter',
                        label: t('node_water_meter'),
                    }),
                    node({ id: 'home', kind: 'sink', x: 760, y: 180, icon: 'house', label: t('node_home') }),
                    node({ id: 'garden', kind: 'sink', x: 760, y: 430, icon: 'sprinkler', label: t('node_garden') }),
                ],
                edges: [
                    edge({ id: 'rain-cistern', from: 'rain', to: 'cistern', value: { oid: '' }, mode: 'positive' }),
                    // Around the cistern, not through it: the mains reach the house on their own
                    edge({
                        id: 'meter-home',
                        from: 'meter',
                        to: 'home',
                        value: { oid: '' },
                        mode: 'positive',
                        curve: 'orthogonal',
                        fromSide: 'right',
                        toSide: 'left',
                        bend: 0.85,
                    }),
                    edge({ id: 'cistern-home', from: 'cistern', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({
                        id: 'cistern-garden',
                        from: 'cistern',
                        to: 'garden',
                        value: { oid: '' },
                        mode: 'positive',
                    }),
                ],
            };

        case 'grid-home':
            return {
                v: 1,
                canvas: { w: 700, h: 320, grid: 10 },
                defaults: { ...BASE_DEFAULTS },
                nodes: [
                    node({ id: 'grid', kind: 'grid', x: 160, y: 160, icon: 'grid', label: t('node_grid') }),
                    node({ id: 'home', kind: 'sink', x: 540, y: 160, icon: 'house', label: t('node_home') }),
                ],
                edges: [
                    edge({
                        id: 'grid-home',
                        from: 'grid',
                        to: 'home',
                        value: { oid: '' },
                        mode: 'signed',
                        showValue: true,
                    }),
                ],
            };

        case 'gas-house':
            return {
                v: 1,
                canvas: { w: 860, h: 470, grid: 10 },
                defaults: defaultsOf('gas'),
                nodes: [
                    node({ id: 'meter', kind: 'grid', x: 160, y: 235, icon: 'meter', label: t('node_gas_meter') }),
                    node({ id: 'home', kind: 'sink', x: 470, y: 235, icon: 'house', label: t('node_home') }),
                    node({ id: 'heating', kind: 'sink', x: 740, y: 120, icon: 'boiler', label: t('node_heating') }),
                    node({ id: 'stove', kind: 'sink', x: 740, y: 350, icon: 'stove', label: t('node_stove') }),
                ],
                edges: [
                    edge({ id: 'meter-home', from: 'meter', to: 'home', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'home-heating', from: 'home', to: 'heating', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'home-stove', from: 'home', to: 'stove', value: { oid: '' }, mode: 'positive' }),
                ],
            };

        case 'heat-pump':
            return {
                v: 1,
                canvas: { w: 900, h: 560, grid: 10 },
                defaults: defaultsOf('heat'),
                nodes: [
                    node({ id: 'pump', kind: 'source', x: 180, y: 150, icon: 'heatpump', label: t('node_heatpump') }),
                    node({ id: 'solar', kind: 'source', x: 180, y: 400, icon: 'sun', label: t('node_solar_thermal') }),
                    node({
                        id: 'buffer',
                        kind: 'storage',
                        x: 470,
                        y: 275,
                        icon: 'heatstorage',
                        label: t('node_buffer'),
                        // A buffer is as full as it is warm: the sensor on top of it says so
                        soc: { oid: '' },
                    }),
                    node({
                        id: 'heating',
                        kind: 'sink',
                        x: 760,
                        y: 150,
                        icon: 'radiator',
                        label: t('node_heating_circuit'),
                    }),
                    node({ id: 'water', kind: 'sink', x: 760, y: 400, icon: 'boiler', label: t('node_hot_water') }),
                ],
                edges: [
                    edge({ id: 'pump-buffer', from: 'pump', to: 'buffer', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'solar-buffer', from: 'solar', to: 'buffer', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'buffer-heating', from: 'buffer', to: 'heating', value: { oid: '' }, mode: 'positive' }),
                    edge({ id: 'buffer-water', from: 'buffer', to: 'water', value: { oid: '' }, mode: 'positive' }),
                ],
            };

        case 'empty':
        default:
            return { v: 1, canvas: { w: 900, h: 560, grid: 10 }, defaults: { ...BASE_DEFAULTS }, nodes: [], edges: [] };
    }
}
