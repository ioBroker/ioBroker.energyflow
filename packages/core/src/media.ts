/**
 * What flows through the diagram.
 *
 * The renderer and the runtime know nothing about this: a line is a line, and a number is a number
 * in whatever unit it was given. The medium is what the *designer* uses to stop asking the same
 * questions again -- which unit, how fast should the dots run, what is a "producer" called when the
 * thing flowing is water, which templates make sense, which icon a new node gets.
 *
 * So this table is presets, not behaviour. Everything it sets is an ordinary field of the document
 * that the user can overrule afterwards, and a diagram whose medium is missing behaves exactly like
 * one of energy -- which is what every diagram written before this existed is.
 */
import type { FlowConfig, NodeKind } from './types';

export type MediumId = 'energy' | 'water' | 'gas' | 'heat';

/** In the order the designer offers them */
export const MEDIUM_IDS: MediumId[] = ['energy', 'water', 'gas', 'heat'];

export interface Medium {
    id: MediumId;
    /** i18n key of the name */
    label: string;
    /** The unit a diagram of this medium counts in */
    unit: string;
    /**
     * A flow that makes the dots run at their normal speed, in `unit`. 3 kW is a household under
     * load; 12 l/min is a shower; 2 m3/h of gas is a boiler in winter.
     */
    refValue: number;
    /**
     * What a counter of the day counts in when its state object says nothing. An inverter reports
     * its yield in kWh, a water meter its day in litres -- a bare number has to be read as the one
     * the trade is used to, or it is off by a thousand.
     */
    counterUnit: string;
    /**
     * Below this a line counts as idle, in `unit`. One watt of standby should not make the diagram
     * twitch -- but one cubic metre of gas an hour is a boiler at full power, so the number cannot
     * be the same for all of them.
     */
    threshold: number;
    /**
     * What a store shows when neither it nor its state object says: a tank of water or gas is read
     * as how full it is, a percentage. A battery is not -- its number is the power it takes or gives,
     * and reading that as a percentage would be wrong by three orders of magnitude.
     */
    storageUnit?: string;
    /**
     * The colour of a switched element of this medium while it is on: water runs blue, gas and heat
     * burn. Written into the document when the element is placed, so it is an ordinary colour the
     * user can change, and it is one literal for both themes -- like every colour a user picks.
     */
    accent?: string;
    /** The icon a node of a kind gets when it names none */
    icons: Partial<Record<NodeKind, string>>;
}

export const MEDIA: Record<MediumId, Medium> = {
    energy: {
        id: 'energy',
        label: 'medium_energy',
        unit: 'W',
        refValue: 3000,
        counterUnit: 'kWh',
        threshold: 1,
        icons: { source: 'solar', sink: 'house', storage: 'battery', grid: 'grid' },
    },
    water: {
        id: 'water',
        label: 'medium_water',
        unit: 'l/min',
        refValue: 12,
        counterUnit: 'l',
        threshold: 0.1,
        storageUnit: '%',
        accent: '#2F6FED',
        // The house connection is where the mains arrive -- the meter is a thing of its own, and
        // sits in the line rather than at its end
        icons: { source: 'well', sink: 'house', storage: 'cistern', grid: 'pipe' },
    },
    gas: {
        id: 'gas',
        label: 'medium_gas',
        unit: 'm³/h',
        refValue: 2,
        counterUnit: 'm³',
        threshold: 0.02,
        storageUnit: '%',
        accent: '#E0901A',
        icons: { source: 'flame', sink: 'house', storage: 'cistern', grid: 'meter' },
    },
    heat: {
        id: 'heat',
        label: 'medium_heat',
        unit: 'W',
        refValue: 8000,
        counterUnit: 'kWh',
        threshold: 1,
        icons: { source: 'heatpump', sink: 'radiator', storage: 'heatstorage', grid: 'flame' },
    },
};

/**
 * The medium of a diagram.
 *
 * @param config the diagram
 * @returns its medium; energy for none and for anything unknown
 */
export function mediumOf(config: FlowConfig | undefined): Medium {
    return MEDIA[config?.defaults?.medium as MediumId] ?? MEDIA.energy;
}

/**
 * What picking a medium writes into a document: the unit and the speed of the dots, which are the
 * two numbers a user would otherwise have to know. Energy writes no `medium` at all -- a document
 * without one is an energy document, and every diagram written before this existed is one.
 *
 * @param medium what flows
 * @returns the defaults of a new diagram of that medium
 */
export function mediumDefaults(medium: MediumId): FlowConfig['defaults'] {
    if (medium === 'energy') {
        return { unit: MEDIA.energy.unit };
    }
    return { medium, unit: MEDIA[medium].unit, animation: { refPower: MEDIA[medium].refValue } };
}
