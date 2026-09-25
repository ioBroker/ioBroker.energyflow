/**
 * Which line carries something, worked out from the elements rather than from a state per line.
 *
 * A water installation is not wired like an energy one. Nobody meters every pipe; what exists is a
 * valve that is open or shut, a pump that runs or does not, a tank that is full or empty, and maybe
 * one flow sensor somewhere. From those few facts the picture follows: water can only flow where
 * there is something to give, something to take, and nothing shut in between.
 *
 * The way it is worked out is **paths**: for every taker, every way the water could reach it is
 * followed, and its demand is divided over those ways by how wide each of them is -- the valves on
 * it, and its length as the only stand-in for resistance. A line then carries the sum of what runs
 * through it, with the ways that use it against each other cancelling out. That one rule covers a
 * chain, a branch, a half-open valve, two tanks on one tap, and a ring fed from both ends, where the
 * two flows meet somewhere in the middle and that pipe carries nothing.
 *
 * It is still **not** a simulation: no pressure, no head, no real pipe resistance, and a valve at
 * half a turn counts as half. What it gets right is what a person reading the diagram would say.
 */
import { resolveSrc, type ValueGetter } from './values';
import type { FlowConfig, FlowEdge, FlowNode } from './types';

/** What an element does to what flows through it; `FlowNode.hydraulic` is one of these */
export type HydraulicRole =
    /** Gives, as long as nothing says otherwise: the house connection, a well */
    | 'supply'
    /** Gives while it holds something, takes while something arrives: a tank */
    | 'store'
    /** Lets through or shuts: a valve */
    | 'gate'
    /** Moves it, and shuts while it stands: a pump */
    | 'driver'
    /** Measures it: a meter, a flow sensor. A number above zero is proof that something flows */
    | 'meter'
    /** Takes it: a tap, a garden, a house */
    | 'demand'
    /** Neither of those: a junction, a caption */
    | 'pass';

/** The symbols that say what an inline element is, when the node kind cannot */
const ROLE_BY_ICON: Record<string, HydraulicRole> = {
    valve: 'gate',
    waterpump: 'driver',
    watermeter: 'meter',
    flowsensor: 'meter',
    meter: 'meter',
    filter: 'pass',
};

/**
 * How many ways to one taker are followed, and how long each may be.
 *
 * A diagram is small, but a mesh of rings has more ways through it than anybody wants to count. The
 * widest ways are found first, so a cap cuts off the ones that would hardly carry anything.
 */
const MAX_WAYS = 12;
const MAX_LENGTH = 14;

/**
 * The role a node has unless it names one itself.
 *
 * It comes from what the node already is -- its kind, and for the things that sit in a line, its
 * symbol. The palette places a valve as a junction carrying the valve symbol, so the symbol is what
 * tells a valve from a pump.
 *
 * @param node the node
 * @returns its role
 */
export function defaultRole(node: FlowNode): HydraulicRole {
    if (node.hydraulic) {
        return node.hydraulic;
    }
    switch (node.kind) {
        case 'source':
        case 'grid':
            return 'supply';
        case 'storage':
            return 'store';
        case 'sink':
            return 'demand';
        case 'bus':
            return (node.icon && ROLE_BY_ICON[node.icon]) || 'pass';
        default:
            return 'pass';
    }
}

/** What the runtime already knows about a node when the flow is worked out */
export interface HydraulicNode {
    role: HydraulicRole;
    /** Its own reading, null when it has none or nobody has written it */
    value: number | null;
    /** How full a store is, in percent; null when unknown */
    level: number | null;
    /** What its reading is in; only a reading in the unit of the diagram is an amount */
    unit?: string;
}

export interface HydraulicFlow {
    /** The line carries something */
    live: boolean;
    /** How much, in the unit of the diagram; null means "flows, amount unknown" */
    value: number | null;
    /** 1 along the line as it was drawn, -1 against it */
    direction: 1 | -1;
}

/** Whether a reading means "on": a boolean state arrives as 1/0, a percentage as 0..100 */
function isOn(value: number | null): boolean {
    return value === null ? false : Math.abs(value) > 0;
}

/**
 * How far a gate is open, as a fraction.
 *
 * Only a reading in percent is a fraction: a valve whose state is a boolean, or a plain 0/1, says
 * open or shut and nothing in between. Physically a valve at half a turn does not pass half the
 * water -- but as a share of what the branches get, "half as much as the other one" is what a person
 * reading the picture means, and it is the only reading the state supports.
 *
 * @param node the node
 * @returns 1 for anything that is not a partly open gate
 */
function opening(node: HydraulicNode): number {
    if (node.role !== 'gate' || node.unit !== '%' || node.value === null) {
        return 1;
    }
    return Math.min(Math.max(Math.abs(node.value) / 100, 0), 1);
}

/**
 * Whether something can pass through this node at all.
 *
 * A shut valve stops everything. So does a pump that stands: that is the normal case in a pressurised
 * installation, and it is what makes "pump off" a dark diagram instead of a flowing one. A node whose
 * state nobody has written is treated as open -- an unconfigured diagram should draw, not go dark.
 */
function passes(node: HydraulicNode): boolean {
    if (node.role === 'gate' || node.role === 'driver') {
        return node.value === null ? true : isOn(node.value);
    }
    return true;
}

/** Whether this node can give something right now */
function canSupply(node: HydraulicNode): boolean {
    if (node.role === 'supply') {
        return true;
    }
    if (node.role === 'store') {
        // An empty tank gives nothing; one that does not say how full it is is taken as having some
        return node.level === null ? true : node.level > 0;
    }
    return false;
}

/** Whether this node can take something */
function canTake(node: HydraulicNode): boolean {
    return node.role === 'demand' || node.role === 'store';
}

/**
 * Whether water may run from one node to the other through this line.
 *
 * A pump is the one element with a side: it pushes the way it was drawn. Without that rule a pump
 * would feed backwards into the tank that feeds it, which is exactly the picture this is meant to
 * avoid. Everything else lets water through both ways -- a valve does not care which side it is on.
 */
function allowed(from: string, to: string, edge: FlowEdge, nodes: Map<string, HydraulicNode>): boolean {
    if (nodes.get(from)?.role === 'driver' && edge.from !== from) {
        return false;
    }
    return !(nodes.get(to)?.role === 'driver' && edge.to !== to);
}

/** What a node reads, if that is a quantity in the unit the diagram counts in */
function quantity(node: HydraulicNode | undefined, flowUnit: string | undefined): number | null {
    if (!node || node.value === null || !isOn(node.value)) {
        return null;
    }
    if (node.unit !== undefined && flowUnit !== undefined && node.unit !== flowUnit) {
        return null;
    }
    return Math.abs(node.value);
}

/** One line, seen from a node */
interface Step {
    edge: FlowEdge;
    other: string;
}

/** One way water can take from a giver to a taker */
interface Way {
    /** The lines it runs over, each with the sign it runs in */
    steps: { edge: FlowEdge; along: boolean }[];
    /** How much of the taker's demand this way gets: wide gates and few corners */
    width: number;
    /**
     * How open the way is, gates only. What decides *how much a taker gets* must not depend on how
     * far away it is -- a flow sensor in its pipe would otherwise make it a longer way and give it
     * less, and a measuring device is not a resistance.
     */
    gates: number;
}

/**
 * Every way water can reach this taker, widest first.
 *
 * Walked backwards from the taker, because that is where the demand is: each step goes to the node
 * that would feed this one. Every node is visited once per way, so a way never runs in circles, and
 * a way is finished the moment it arrives at something that can give.
 */
function waysTo(
    taker: string,
    steps: Map<string, Step[]>,
    nodes: Map<string, HydraulicNode>,
    givers: Set<string>,
): Way[] {
    const found: Way[] = [];
    const walk = (at: string, visited: Set<string>, used: Way['steps'], width: number): void => {
        if (found.length >= MAX_WAYS || used.length >= MAX_LENGTH) {
            return;
        }
        for (const step of steps.get(at) || []) {
            if (visited.has(step.other)) {
                continue;
            }
            const node = nodes.get(step.other);
            if (!node || !passes(node)) {
                continue;
            }
            // Backwards: the water would run from the node we are stepping to, into the one we are on
            if (!allowed(step.other, at, step.edge, nodes)) {
                continue;
            }
            const along = step.edge.from === step.other;
            const next = [...used, { edge: step.edge, along }];
            const narrowed = width * opening(node);
            if (givers.has(step.other)) {
                // The length of the way is the only stand-in for the resistance of the pipe
                found.push({ steps: next, width: narrowed / next.length, gates: narrowed });
                if (found.length >= MAX_WAYS) {
                    return;
                }
                continue;
            }
            walk(step.other, new Set([...visited, step.other]), next, narrowed);
        }
    };
    walk(taker, new Set([taker]), [], 1);
    return found;
}

/**
 * Which lines carry something, and how much.
 *
 * @param config the diagram
 * @param nodes what is known about each node
 * @param flowUnit the unit the diagram counts in; a reading in another one says "it runs", not "how much"
 * @returns one entry per line that carries something; lines that are not in it are idle
 */
export function computeHydraulics(
    config: FlowConfig,
    nodes: Map<string, HydraulicNode>,
    flowUnit?: string,
): Map<string, HydraulicFlow> {
    const result = new Map<string, HydraulicFlow>();
    const edges = (config.edges || []).filter(edge => nodes.has(edge.from) && nodes.has(edge.to));
    if (!edges.length) {
        return result;
    }

    const steps = new Map<string, Step[]>();
    const add = (id: string, step: Step): void => {
        const list = steps.get(id);
        if (list) {
            list.push(step);
        } else {
            steps.set(id, [step]);
        }
    };
    for (const edge of edges) {
        add(edge.from, { edge, other: edge.to });
        add(edge.to, { edge, other: edge.from });
    }

    const givers = new Set<string>();
    const takers = new Set<string>();
    for (const [id, node] of nodes) {
        if (!passes(node)) {
            continue;
        }
        if (canSupply(node)) {
            givers.add(id);
        }
        if (canTake(node)) {
            takers.add(id);
        }
    }
    if (!givers.size || !takers.size) {
        return result;
    }

    /**
     * What each line carries, in shares as long as nothing measures anything.
     *
     * A taker's demand is divided over the ways that reach it, by how wide each of them is. A line
     * used by two ways in opposite directions carries the difference -- which is how the two halves
     * of a ring fed from both ends meet, and the pipe between them turns out to carry nothing.
     */
    const carried = new Map<string, number>();
    // Whether every taker that really takes says how much: a tank that nothing can reach is none
    let exact = false;
    let guessed = false;
    for (const taker of takers) {
        // A tank that gives cannot take from itself: its own ways are the ways out of it
        const others = new Set([...givers].filter(id => id !== taker));
        if (!others.size) {
            continue;
        }
        const ways = waysTo(taker, steps, nodes, others);
        const total = ways.reduce((sum, way) => sum + way.width, 0);
        if (!total) {
            continue;
        }
        const reading = quantity(nodes.get(taker), flowUnit);
        // What it reads, or how open the widest way to it is: a tap behind a half-closed valve takes
        // half as much as the one beside it. The length of the way divides *this* demand over the
        // ways to it -- the two halves of a ring -- but does not decide how much it gets in the first
        // place, or a sensor in its pipe would starve it
        const demand = reading ?? Math.max(...ways.map(way => way.gates));
        if (reading === null) {
            guessed = true;
        } else {
            exact = true;
        }
        for (const way of ways) {
            const share = (demand * way.width) / total;
            for (const { edge, along } of way.steps) {
                carried.set(edge.id, (carried.get(edge.id) ?? 0) + (along ? share : -share));
            }
        }
    }

    for (const edge of edges) {
        const flow = carried.get(edge.id) ?? 0;
        // What cancels out carries nothing: the place in a ring where the two flows meet
        if (Math.abs(flow) < 1e-9) {
            continue;
        }
        result.set(edge.id, { live: true, value: null, direction: flow > 0 ? 1 : -1 });
    }
    if (!result.size) {
        return result;
    }

    /**
     * From shares to litres. A meter reads what runs through it, so everything else follows from the
     * share of that one line. Where every taker reads its own use, the shares are already the real
     * amounts. Without either, the lines flow without a number.
     */
    let scale: number | null = exact && !guessed ? 1 : null;
    for (const edge of edges) {
        const share = carried.get(edge.id);
        if (!share || !result.has(edge.id)) {
            continue;
        }
        const meter = [edge.from, edge.to]
            .map(id => nodes.get(id))
            .find(node => node?.role === 'meter' && quantity(node, undefined) !== null);
        if (meter) {
            scale = (quantity(meter, undefined) as number) / Math.abs(share);
            break;
        }
    }
    if (scale === null) {
        return result;
    }
    for (const [id, flow] of result) {
        const share = Math.abs(carried.get(id) as number);
        result.set(id, { ...flow, value: Math.round(share * scale * 1000) / 1000 });
    }
    return result;
}

/**
 * What the runtime hands over: each node's role, its own reading and its level.
 *
 * @param config the diagram
 * @param get the value of a state
 * @param unitOf what a node's reading is in, as the runtime works it out
 * @returns the map `computeHydraulics` takes
 */
export function hydraulicNodes(
    config: FlowConfig,
    get: ValueGetter,
    unitOf?: (node: FlowNode) => string | undefined,
): Map<string, HydraulicNode> {
    const nodes = new Map<string, HydraulicNode>();
    for (const node of config.nodes || []) {
        const value = resolveSrc(node.value, get);
        nodes.set(node.id, {
            role: defaultRole(node),
            value,
            level: resolveSrc(node.soc, get, () => value),
            unit: unitOf?.(node),
        });
    }
    return nodes;
}
