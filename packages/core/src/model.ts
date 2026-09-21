/**
 * Editing operations on a document.
 *
 * All of them are pure: they take a document and return a new one. That is not ceremony -- the editor
 * gets undo/redo for free by keeping a stack of the documents these functions returned, and the live
 * preview re-renders because the object identity changed, without a single `forceUpdate`.
 */
import { nodeRect } from './defaults';
import type { EnergyFlowConfig, FlowEdge, FlowNode, NodeKind, Point, Rect } from './types';

/**
 * A readable, unique id.
 *
 * Ids appear in the document and in `waypoints` keys, so a random string would make a diagram hard to
 * read when somebody looks at the JSON. Counting up from the prefix keeps `pv`, `pv-2`, `pv-3`.
 *
 * @param prefix the desired id
 * @param taken the ids already in use
 * @returns `prefix`, or `prefix-<n>` if that is taken
 */
export function uniqueId(prefix: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    if (!used.has(prefix)) {
        return prefix;
    }
    for (let i = 2; ; i++) {
        const candidate = `${prefix}-${i}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

/** All node and edge ids, so a new one cannot collide with either */
export function allIds(config: EnergyFlowConfig): string[] {
    return [...config.nodes.map(node => node.id), ...config.edges.map(edge => edge.id)];
}

/**
 * Round a coordinate to the snap grid.
 *
 * @param value the coordinate
 * @param grid the grid size; 0 or undefined disables snapping
 * @returns the snapped coordinate
 */
export function snap(value: number, grid: number | undefined): number {
    if (!grid || grid <= 0) {
        return Math.round(value);
    }
    return Math.round(value / grid) * grid;
}

export function addNode(config: EnergyFlowConfig, node: FlowNode): EnergyFlowConfig {
    return { ...config, nodes: [...config.nodes, node] };
}

export function updateNode(config: EnergyFlowConfig, id: string, patch: Partial<FlowNode>): EnergyFlowConfig {
    return {
        ...config,
        nodes: config.nodes.map(node => (node.id === id ? { ...node, ...patch } : node)),
    };
}

/**
 * Remove a node and every edge that touched it.
 *
 * Leaving the edges behind would be worse than deleting them: the renderer skips an edge whose
 * endpoint is gone, so they would be invisible but still in the document, and they would reappear the
 * moment somebody created a node with the same id again.
 */
export function removeNode(config: EnergyFlowConfig, id: string): EnergyFlowConfig {
    return {
        ...config,
        nodes: config.nodes.filter(node => node.id !== id),
        edges: config.edges.filter(edge => edge.from !== id && edge.to !== id),
    };
}

/**
 * Rename a node, keeping the edges attached to it.
 *
 * @param config the document
 * @param id the current id
 * @param newId the desired id
 * @returns the document, unchanged if `newId` is already taken
 */
export function renameNode(config: EnergyFlowConfig, id: string, newId: string): EnergyFlowConfig {
    if (!newId || newId === id || allIds(config).includes(newId)) {
        return config;
    }
    return {
        ...config,
        nodes: config.nodes.map(node => (node.id === id ? { ...node, id: newId } : node)),
        edges: config.edges.map(edge => ({
            ...edge,
            from: edge.from === id ? newId : edge.from,
            to: edge.to === id ? newId : edge.to,
        })),
    };
}

export function addEdge(config: EnergyFlowConfig, edge: FlowEdge): EnergyFlowConfig {
    return { ...config, edges: [...config.edges, edge] };
}

export function updateEdge(config: EnergyFlowConfig, id: string, patch: Partial<FlowEdge>): EnergyFlowConfig {
    return {
        ...config,
        edges: config.edges.map(edge => (edge.id === id ? { ...edge, ...patch } : edge)),
    };
}

export function removeEdge(config: EnergyFlowConfig, id: string): EnergyFlowConfig {
    return { ...config, edges: config.edges.filter(edge => edge.id !== id) };
}

/**
 * Move a set of nodes by a delta, snapping the result to the grid.
 *
 * Snapping the *result* rather than the delta is what makes dragging a group feel right: every node
 * lands on the grid, instead of the group keeping whatever sub-grid offsets it started with.
 *
 * @param config the document
 * @param ids the nodes to move
 * @param dx horizontal delta in canvas units
 * @param dy vertical delta
 * @returns the document with those nodes moved
 */
export function moveNodes(config: EnergyFlowConfig, ids: string[], dx: number, dy: number): EnergyFlowConfig {
    const moving = new Set(ids);
    const grid = config.canvas.grid;
    return {
        ...config,
        nodes: config.nodes.map(node =>
            moving.has(node.id) ? { ...node, x: snap(node.x + dx, grid), y: snap(node.y + dy, grid) } : node,
        ),
    };
}

/**
 * A default node of the given kind, placed at a point.
 *
 * @param config the document it goes into, for the id and the grid
 * @param kind what to create
 * @param at where to put its centre, in canvas units
 * @param label its label
 * @returns the new node
 */
export function createNode(config: EnergyFlowConfig, kind: NodeKind, at: Point, label?: string): FlowNode {
    const grid = config.canvas.grid;
    const node: FlowNode = {
        id: uniqueId(kind, allIds(config)),
        kind,
        x: snap(at.x, grid),
        y: snap(at.y, grid),
        label,
    };
    // A node that shows no number is decoration; every other kind gets an empty source so the
    // inspector has something to bind and the node draws its placeholder right away
    if (kind !== 'label' && kind !== 'image' && kind !== 'bus') {
        node.value = { oid: '' };
    }
    if (kind === 'storage') {
        node.soc = { oid: '' };
    }
    return node;
}

/**
 * A default edge between two nodes.
 *
 * The mode is guessed from what it connects, because that guess is right almost every time: a line
 * out of the grid or a battery carries energy in both directions, a line out of a PV array does not.
 *
 * @param config the document it goes into
 * @param from source node id
 * @param to target node id
 * @returns the new edge
 */
export function createEdge(config: EnergyFlowConfig, from: string, to: string): FlowEdge {
    const fromNode = config.nodes.find(node => node.id === from);
    const toNode = config.nodes.find(node => node.id === to);
    const bidirectional =
        fromNode?.kind === 'grid' ||
        fromNode?.kind === 'storage' ||
        toNode?.kind === 'grid' ||
        toNode?.kind === 'storage';

    return {
        id: uniqueId(`${from}-${to}`, allIds(config)),
        from,
        to,
        value: { oid: '' },
        mode: bidirectional ? 'signed' : 'positive',
    };
}

/** The smallest box containing every node, or null for an empty document */
export function contentBounds(config: EnergyFlowConfig): Rect | null {
    if (!config.nodes.length) {
        return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of config.nodes) {
        const rect = nodeRect(node);
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.w);
        maxY = Math.max(maxY, rect.y + rect.h);
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Shrink or grow the canvas so the content sits in it with an even margin, and shift the nodes with
 * it. Used by the editor's "fit" command after a layout has been rearranged.
 *
 * @param config the document
 * @param margin space to leave around the content, in canvas units
 * @returns the document with a fitted canvas
 */
export function fitCanvas(config: EnergyFlowConfig, margin = 40): EnergyFlowConfig {
    const bounds = contentBounds(config);
    if (!bounds) {
        return config;
    }
    // Labels are drawn below a node and are not part of its rectangle, so the bottom needs more room
    const dx = margin - bounds.x;
    const dy = margin - bounds.y;

    return {
        ...config,
        canvas: {
            ...config.canvas,
            w: Math.max(Math.round(bounds.w + margin * 2), 200),
            h: Math.max(Math.round(bounds.h + margin * 2 + 18), 160),
        },
        nodes: config.nodes.map(node => ({ ...node, x: Math.round(node.x + dx), y: Math.round(node.y + dy) })),
    };
}
