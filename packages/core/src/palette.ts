/**
 * What the designer offers to place, per medium.
 *
 * The graph does not change with the medium -- a valve, a pump and a junction are all one node that
 * something flows through, which is what `bus` is. What changes is what a user is looking for: in a
 * water installation nobody looks for "a bus", they look for a valve. So the palette is a list of
 * entries: each one is a kind plus the icon and the name it should appear with, and several entries
 * may share a kind. Only an entry that is *not* simply a kind carries an icon of its own -- otherwise
 * the palette would show one symbol for a consumer and the inspector's list another.
 *
 * Energy is deliberately the list it always was: one entry per kind, in the order the designer has
 * shown them since the first version.
 */
import type { MediumId } from './media';
import type { FlowNode, NodeKind } from './types';

export interface PaletteEntry {
    /** Unique within its medium; only used as a React key and in tests */
    id: string;
    kind: NodeKind;
    /**
     * The icon a node created from this entry gets. Undefined leaves it to the kind, which takes it
     * from the medium; an empty string means the node deliberately has none.
     */
    icon?: string;
    /** i18n key of the name; without one it is the name of the kind in this medium (`kindLabel`) */
    label?: string;
    /**
     * The element shows a reading of its own: it is placed with an empty state binding, so the
     * inspector has something to fill in. A plain junction has none -- it shows what passes through.
     */
    reads?: boolean;
    /**
     * Its state is usually a switch rather than a number. The two i18n keys are the words for true
     * and for false; the element is placed with that text mapping, so a bound boolean reads as
     * "open"/"closed" instead of "1 l/min".
     */
    onOff?: [string, string];
}

/**
 * The colour of a switched element while it is off. Grey rather than the medium's colour, so a shut
 * valve is visibly shut; it is written into the document as an ordinary rule the user can change.
 */
export const SWITCH_OFF_COLOR = '#64748B';

/** The entries every medium ends with: a caption, a picture, and the thing that needs explaining */
const TAIL: PaletteEntry[] = [
    { id: 'label', kind: 'label' },
    { id: 'image', kind: 'image' },
    { id: 'bus', kind: 'bus' },
];

export const PALETTE: Record<MediumId, PaletteEntry[]> = {
    energy: [
        { id: 'source', kind: 'source' },
        { id: 'sink', kind: 'sink' },
        { id: 'storage', kind: 'storage' },
        { id: 'grid', kind: 'grid' },
        ...TAIL,
    ],
    water: [
        { id: 'source', kind: 'source' },
        { id: 'sink', kind: 'sink' },
        { id: 'storage', kind: 'storage' },
        { id: 'connection', kind: 'grid' },
        // In the line rather than at its end: a garden meter, a flow sensor, a pump, a valve
        { id: 'meter', kind: 'bus', icon: 'watermeter', label: 'palette_meter', reads: true },
        { id: 'flow', kind: 'bus', icon: 'flowsensor', label: 'palette_flow', reads: true },
        {
            id: 'pump',
            kind: 'bus',
            icon: 'waterpump',
            label: 'palette_pump',
            reads: true,
            onOff: ['state_on', 'state_off'],
        },
        {
            id: 'valve',
            kind: 'bus',
            icon: 'valve',
            label: 'palette_valve',
            reads: true,
            onOff: ['state_open', 'state_closed'],
        },
        ...TAIL,
    ],
    gas: [
        { id: 'source', kind: 'source' },
        { id: 'sink', kind: 'sink' },
        { id: 'storage', kind: 'storage' },
        { id: 'connection', kind: 'grid' },
        { id: 'meter', kind: 'bus', icon: 'meter', label: 'palette_meter', reads: true },
        {
            id: 'valve',
            kind: 'bus',
            icon: 'valve',
            label: 'palette_valve',
            reads: true,
            onOff: ['state_open', 'state_closed'],
        },
        ...TAIL,
    ],
    heat: [
        { id: 'source', kind: 'source' },
        { id: 'sink', kind: 'sink' },
        { id: 'storage', kind: 'storage' },
        { id: 'grid', kind: 'grid' },
        { id: 'meter', kind: 'bus', icon: 'meter', label: 'palette_meter', reads: true },
        {
            id: 'pump',
            kind: 'bus',
            icon: 'waterpump',
            label: 'palette_pump',
            reads: true,
            onOff: ['state_on', 'state_off'],
        },
        {
            id: 'valve',
            kind: 'bus',
            icon: 'valve',
            label: 'palette_valve',
            reads: true,
            onOff: ['state_open', 'state_closed'],
        },
        ...TAIL,
    ],
};

/**
 * The words a switch shows instead of a number.
 *
 * `true` and `1` are the same thing to a person, and so are `false` and `0`; ioBroker delivers
 * either, depending on the adapter. The map is keyed by the raw value as text, which is what both
 * `FlowNode.textMap` and `NodeBadge.textMap` are looked up with.
 *
 * @param on the word for true
 * @param off the word for false
 * @returns the map
 */
export function switchTextMap(on: string, off: string): Record<string, string> {
    return { true: on, 1: on, false: off, 0: off };
}

/**
 * What such a map says for one of the two states.
 *
 * @param map the map, if there is one
 * @param on true for the word of "on"
 * @returns the word, or an empty string
 */
export function switchText(map: Record<string, string> | undefined, on: boolean): string {
    if (!map) {
        return '';
    }
    return (on ? (map.true ?? map['1']) : (map.false ?? map['0'])) ?? '';
}

/**
 * The map with one of the two words changed.
 *
 * An empty text removes that state again, and a map that names nothing is dropped altogether -- so a
 * value that showed a word goes back to being a number without leaving anything behind.
 *
 * @param map the map so far
 * @param on which of the two states
 * @param text the word; empty or missing removes it
 * @returns the new map, or undefined when it holds nothing
 */
export function withSwitchText(
    map: Record<string, string> | undefined,
    on: boolean,
    text: string | undefined,
): Record<string, string> | undefined {
    const next = { ...(map || {}) };
    for (const key of on ? ['true', '1'] : ['false', '0']) {
        if (text) {
            next[key] = text;
        } else {
            delete next[key];
        }
    }
    return Object.keys(next).length ? next : undefined;
}

/**
 * What to offer for a medium.
 *
 * @param medium what flows
 * @returns the palette entries, in the order they are shown
 */
export function paletteOf(medium: MediumId): PaletteEntry[] {
    return PALETTE[medium] ?? PALETTE.energy;
}

/**
 * Which entry a node reads as -- the one it was placed from, as far as the document still shows it.
 *
 * The kind alone is not enough: a valve, a pump and a junction are all a `bus`, and only the icon
 * tells them apart. A node whose icon the user has since changed falls back to the plain entry of
 * its kind, which is the honest answer: it is no longer a valve, it is a junction with a picture.
 *
 * @param node the node
 * @param medium what flows through the diagram
 * @returns the entry, or undefined for a kind this medium does not offer
 */
export function paletteEntryOf(node: FlowNode, medium: MediumId): PaletteEntry | undefined {
    const ofKind = paletteOf(medium).filter(entry => entry.kind === node.kind);
    return (
        ofKind.find(entry => entry.icon !== undefined && entry.icon === node.icon) ??
        ofKind.find(entry => entry.icon === undefined) ??
        ofKind[0]
    );
}

/**
 * What changes when a node is turned into another entry of the palette.
 *
 * An entry with a symbol of its own brings it: "valve" without the valve means nothing. An entry
 * without one takes the symbol of its kind again -- but only if the node still wears the symbol of
 * the entry it came from. An icon the user picked is theirs and survives the change of kind.
 *
 * @param node the node
 * @param entry what it should become
 * @param medium what flows through the diagram
 * @returns the fields to write
 */
export function paletteChange(node: FlowNode, entry: PaletteEntry, medium: MediumId): Partial<FlowNode> {
    if (entry.icon !== undefined) {
        return { kind: entry.kind, icon: entry.icon };
    }
    const previous = paletteEntryOf(node, medium);
    const wore = previous?.icon !== undefined && previous.icon === node.icon;
    return wore ? { kind: entry.kind, icon: undefined } : { kind: entry.kind };
}
