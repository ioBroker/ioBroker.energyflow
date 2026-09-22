/**
 * Copying nodes: between diagrams, between the designer in vis-2 and the one in the admin tab, between
 * browser windows.
 *
 * What goes onto the clipboard is plain JSON text with a format marker, so it survives every route a
 * text can take -- and a text that happens to be JSON of something else is never mistaken for nodes.
 * Connections go along only where both ends are copied too: one leading out of the set would have
 * nothing to attach to in the diagram it is pasted into.
 */
import { normalizeConfig } from './defaults';
import { allIds, snap, uniqueId } from './model';
import type { EnergyFlowConfig, FlowEdge, FlowNode, Point } from './types';

/** Marks clipboard text as nodes of this widget */
export const CLIPBOARD_FORMAT = 'iobroker.energyflow/nodes';

export interface NodeClipboard {
    format: typeof CLIPBOARD_FORMAT;
    v: 1;
    nodes: FlowNode[];
    /** Only connections between the copied nodes */
    edges: FlowEdge[];
}

/** The smallest distance a paste moves its nodes, in canvas units, when the grid is finer than that */
const PASTE_MIN_STEP = 20;

/**
 * Take nodes out of a document for the clipboard.
 *
 * @param config the document
 * @param ids the nodes to copy; unknown ids are ignored
 * @returns what to put on the clipboard, or null when none of the ids exists
 */
export function copyNodes(config: EnergyFlowConfig, ids: string[]): NodeClipboard | null {
    const wanted = new Set(ids);
    const nodes = config.nodes.filter(node => wanted.has(node.id));
    if (!nodes.length) {
        return null;
    }
    const edges = config.edges.filter(edge => wanted.has(edge.from) && wanted.has(edge.to));
    // A deep copy: the clipboard must not share objects with a document that is edited afterwards
    return JSON.parse(JSON.stringify({ format: CLIPBOARD_FORMAT, v: 1, nodes, edges })) as NodeClipboard;
}

/**
 * Read clipboard text.
 *
 * @param text whatever the clipboard holds
 * @returns the nodes, or null when the text is anything else
 */
export function parseClipboard(text: string): NodeClipboard | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object' || (value as NodeClipboard).format !== CLIPBOARD_FORMAT) {
        return null;
    }
    const raw = value as Partial<NodeClipboard>;
    // The same cleaning a stored document gets: clipboard text is as easy to edit by hand as a file
    const clean = normalizeConfig({ nodes: raw.nodes, edges: raw.edges });
    const nodes = clean.nodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!nodes.length) {
        return null;
    }
    const ids = new Set(nodes.map(node => node.id));
    const edges = clean.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    return { format: CLIPBOARD_FORMAT, v: 1, nodes, edges };
}

/**
 * Insert copied nodes into a document.
 *
 * The copies land one step down and to the right of the originals -- further, if that spot is taken,
 * so pasting three times gives a staircase instead of three copies hiding under each other. Ids that
 * are taken are numbered (`pv` becomes `pv-2`), and the connections follow the renamed nodes.
 *
 * @param config the document to paste into
 * @param clipboard what was copied
 * @returns the new document and the ids of the pasted nodes, to select them
 */
export function pasteNodes(
    config: EnergyFlowConfig,
    clipboard: NodeClipboard,
): { config: EnergyFlowConfig; ids: string[] } {
    const grid = config.canvas.grid;
    const step = grid && grid > 0 ? grid * Math.max(1, Math.ceil(PASTE_MIN_STEP / grid)) : PASTE_MIN_STEP;

    const occupied = new Set(config.nodes.map(node => `${node.x},${node.y}`));
    const lands = (offset: number): boolean =>
        clipboard.nodes.some(node => occupied.has(`${snap(node.x + offset, grid)},${snap(node.y + offset, grid)}`));
    let offset = step;
    for (let attempt = 0; attempt < 100 && lands(offset); attempt++) {
        offset += step;
    }

    // Keep the group inside the canvas -- as a group, so its layout survives. Copies out of a larger
    // diagram would otherwise land where nobody can see or grab them
    const xs = clipboard.nodes.map(node => node.x + offset);
    const ys = clipboard.nodes.map(node => node.y + offset);
    const shift = (min: number, max: number, size: number): number => {
        if (max > size) {
            return Math.max(size - max, -min);
        }
        return min < 0 ? -min : 0;
    };
    const dx = offset + shift(Math.min(...xs), Math.max(...xs), config.canvas.w);
    const dy = offset + shift(Math.min(...ys), Math.max(...ys), config.canvas.h);

    const taken = allIds(config);
    const renamed = new Map<string, string>();
    const nodes: FlowNode[] = clipboard.nodes.map(node => {
        const id = uniqueId(node.id, taken);
        taken.push(id);
        renamed.set(node.id, id);
        return { ...node, id, x: snap(node.x + dx, grid), y: snap(node.y + dy, grid) };
    });

    const moved = (point: Point): Point => ({ x: Math.round(point.x + dx), y: Math.round(point.y + dy) });
    const edges: FlowEdge[] = clipboard.edges.flatMap(edge => {
        const from = renamed.get(edge.from);
        const to = renamed.get(edge.to);
        if (!from || !to) {
            return [];
        }
        const id = uniqueId(`${from}-${to}`, taken);
        taken.push(id);
        const copy: FlowEdge = { ...edge, id, from, to };
        if (edge.waypoints) {
            copy.waypoints = edge.waypoints.map(moved);
        }
        return [copy];
    });

    return {
        config: { ...config, nodes: [...config.nodes, ...nodes], edges: [...config.edges, ...edges] },
        ids: nodes.map(node => node.id),
    };
}
