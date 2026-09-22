/**
 * A small chart of a value's recent past, drawn into its node.
 *
 * The numbers come from the installation's default history adapter (`system.config` ->
 * `common.defaultHistory`, e.g. `history.0` or `sql.0`). The hosts read them -- this module only
 * decides what to ask for, caches the answers per page and turns them into paths.
 */
import { sourceUnit, type UnitGetter } from './units';
import { resolveSrc } from './values';
import { isSrcState, type EnergyFlowConfig, type FlowNode, type HistoryPeriod, type Rect } from './types';

/** Length of each period in ms */
export const HISTORY_PERIODS: Record<HistoryPeriod, number> = {
    '15m': 15 * 60000,
    '30m': 30 * 60000,
    '1h': 3600000,
    '3h': 3 * 3600000,
    '6h': 6 * 3600000,
    '12h': 12 * 3600000,
    '24h': 24 * 3600000,
};

/** How many points a chart is read with: enough for its width in a node, few enough to stay cheap */
export const HISTORY_POINTS = 60;

export interface HistoryPoint {
    ts: number;
    val: number;
}

/** The recorded values of a state over a period, oldest first; undefined while not read */
export type HistoryGetter = (oid: string, period: HistoryPeriod) => HistoryPoint[] | undefined;

/** What a {@link HistoryReader} is asked for: a stretch, in steps, averaged or summed up */
export interface HistoryReadOptions {
    start: number;
    end: number;
    step: number;
    /** `average` unless said otherwise */
    aggregate?: 'average' | 'integral';
    /** For `integral`: the time unit in seconds -- 3600 turns watts into watt-hours */
    integralUnit?: number;
}

/** Reads a stretch of history -- `socket.getHistory` of a host */
export type HistoryReader = (oid: string, options: HistoryReadOptions) => Promise<unknown>;

/** What a diagram needs from the history: one entry per state and period */
export interface HistoryRequest {
    oid: string;
    period: HistoryPeriod;
}

/**
 * The histories a diagram shows. Only a plain state can have one: a formula of several states has no
 * recorded past of its own.
 *
 * @param config the diagram
 * @returns the state and period of every node with a chart, without duplicates
 */
export function historyRequests(config: EnergyFlowConfig): HistoryRequest[] {
    const seen = new Set<string>();
    const requests: HistoryRequest[] = [];
    for (const node of config.nodes || []) {
        if (!node.history || !node.value || !isSrcState(node.value) || !node.value.oid) {
            continue;
        }
        const key = `${node.value.oid}|${node.history}`;
        if (!seen.has(key)) {
            seen.add(key);
            requests.push({ oid: node.value.oid, period: node.history });
        }
    }
    return requests;
}

/**
 * How long a read history stays good: a sixtieth of its period, but at least a minute -- a 24 h chart
 * does not change visibly in a minute, a 15 min one does.
 *
 * @param period the period
 * @returns ms
 */
export function historyRefreshMs(period: HistoryPeriod): number {
    return Math.max(60000, HISTORY_PERIODS[period] / HISTORY_POINTS);
}

const cache = new Map<string, { at: number; points: HistoryPoint[] }>();
const pending = new Map<string, Promise<void>>();

/**
 * Accept what a history adapter returns: `{ val, ts }` objects, with nulls and strings in between.
 *
 * @param result the answer of `getHistory`
 * @returns the numeric points, oldest first
 */
export function historyPoints(result: unknown): HistoryPoint[] {
    const rows = Array.isArray(result) ? result : [];
    const points: HistoryPoint[] = [];
    for (const row of rows as { val?: unknown; ts?: unknown }[]) {
        const val = typeof row?.val === 'number' ? row.val : Number(row?.val);
        if (typeof row?.ts === 'number' && row.val !== null && row.val !== undefined && Number.isFinite(val)) {
            points.push({ ts: row.ts, val });
        }
    }
    return points.sort((a, b) => a.ts - b.ts);
}

/**
 * Read the histories that are missing or stale.
 *
 * @param requests what the diagram needs
 * @param read how to read one
 * @param now the present
 * @returns whether anything new arrived
 */
export async function loadHistory(requests: HistoryRequest[], read: HistoryReader, now = Date.now()): Promise<boolean> {
    let changed = false;
    await Promise.all(
        requests.map(({ oid, period }) => {
            const key = `${oid}|${period}`;
            const known = cache.get(key);
            if (known && now - known.at < historyRefreshMs(period)) {
                return Promise.resolve();
            }
            let running = pending.get(key);
            if (!running) {
                const length = HISTORY_PERIODS[period];
                running = read(oid, { start: now - length, end: now, step: Math.round(length / HISTORY_POINTS) })
                    .then(
                        result => {
                            cache.set(key, { at: now, points: historyPoints(result) });
                            changed = true;
                        },
                        // Not recorded, adapter stopped: remember "nothing" for a while instead of asking
                        // again on every render
                        () => {
                            cache.set(key, { at: now, points: [] });
                        },
                    )
                    .finally(() => pending.delete(key));
                pending.set(key, running);
            }
            return running;
        }),
    );
    return changed;
}

/** The cached history of a state, see {@link loadHistory} */
export const cachedHistory: HistoryGetter = (oid, period) => cache.get(`${oid}|${period}`)?.points;

/**
 * The chart as SVG paths: a line, and the area under it.
 *
 * The range is anchored at zero when the values come near it anyway -- a PV curve then grows out of
 * the bottom instead of floating, and the area means "how much". A value that only moves a little
 * around a large amount (a battery voltage between 52 and 54 V) gets its own minimum and maximum
 * instead; against zero it would be a flat line at the top.
 *
 * @param points the values, oldest first
 * @param box where to draw, in canvas units
 * @param start the left edge in time
 * @param end the right edge in time
 * @returns the paths, or null when there is nothing to draw
 */
export function sparklinePaths(
    points: HistoryPoint[],
    box: Rect,
    start: number,
    end: number,
): { line: string; area: string } | null {
    const inside = points.filter(point => point.ts >= start && point.ts <= end);
    if (inside.length < 2 || end <= start) {
        return null;
    }
    let min = Infinity;
    let max = -Infinity;
    for (const point of inside) {
        min = Math.min(min, point.val);
        max = Math.max(max, point.val);
    }
    // "Near zero": within a quarter of the largest amount
    if (min >= 0 && min <= max * 0.25) {
        min = 0;
    } else if (max <= 0 && max >= min * 0.25) {
        max = 0;
    }
    if (max === min) {
        max = min + 1;
    }
    const x = (ts: number): number => box.x + ((ts - start) / (end - start)) * box.w;
    const y = (val: number): number => box.y + box.h - ((val - min) / (max - min)) * box.h;
    const round = (value: number): string => (Math.round(value * 10) / 10).toString();

    const line = inside.map((point, i) => `${i ? 'L' : 'M'}${round(x(point.ts))} ${round(y(point.val))}`).join(' ');
    // The area closes at zero where zero is in range, else at the edge nearer to it
    const zero = round(y(Math.min(Math.max(0, min), max)));
    const area = `${line} L${round(x(inside[inside.length - 1].ts))} ${zero} L${round(x(inside[0].ts))} ${zero} Z`;
    return { line, area };
}

/** How long today's energy stays good before it is read again */
const ENERGY_REFRESH_MS = 5 * 60000;

const energyCache = new Map<string, { at: number; day: number; value: number | null }>();

/**
 * The states whose energy of today the diagram shows.
 *
 * @param config the diagram
 * @returns their ids, without duplicates
 */
export function energyRequests(config: EnergyFlowConfig): string[] {
    const ids = new Set<string>();
    for (const node of config.nodes || []) {
        if (node.energyToday && node.value && isSrcState(node.value) && node.value.oid) {
            ids.add(node.value.oid);
        }
    }
    return [...ids];
}

/** Local midnight of the day `now` falls in */
function startOfDay(now: number): number {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * Read today's energy of power states: the history adapter integrates since midnight, which needs no
 * counter state of its own -- the reason most setups have a daily kWh only for the PV.
 *
 * @param oids the power states
 * @param read how to read history
 * @param now the present
 * @returns whether anything new arrived
 */
export async function loadEnergyToday(oids: string[], read: HistoryReader, now = Date.now()): Promise<boolean> {
    const day = startOfDay(now);
    let changed = false;
    await Promise.all(
        oids.map(oid => {
            const known = energyCache.get(oid);
            if (known && known.day === day && now - known.at < ENERGY_REFRESH_MS) {
                return Promise.resolve();
            }
            return read(oid, {
                start: day,
                end: now,
                step: Math.max(now - day, 60000),
                aggregate: 'integral',
                integralUnit: 3600,
            }).then(
                result => {
                    const points = historyPoints(result);
                    const value = points.length ? points.reduce((sum, point) => sum + point.val, 0) : null;
                    energyCache.set(oid, { at: now, day, value });
                    changed = true;
                },
                () => {
                    energyCache.set(oid, { at: now, day, value: null });
                },
            );
        }),
    );
    return changed;
}

/**
 * Today's energy of a power state, in the state's unit times hours (Wh for W); undefined while unknown.
 *
 * @param oid the state
 * @returns the energy
 */
export function cachedEnergyToday(oid: string): number | undefined {
    const known = energyCache.get(oid);
    return known && known.day === startOfDay(Date.now()) && known.value !== null ? known.value : undefined;
}

/** What the detail view of a node charts */
export interface DetailTarget {
    oid: string;
    /** The unit of the values after `scale` */
    unit?: string;
    /** The node's own rescaling, when the chart shows the node's value */
    scale: (val: number) => number | null;
}

/**
 * The state a node's detail view charts: the one named in its click action, or else the one behind
 * its value -- charted through the value's rescaling, so the chart shows what the node shows.
 *
 * @param node the clicked node
 * @param config its diagram
 * @param units the units of the state objects
 * @returns the target, or null when the node has no state to chart
 */
export function detailTarget(node: FlowNode, config: EnergyFlowConfig, units?: UnitGetter): DetailTarget | null {
    const valueOid = node.value && isSrcState(node.value) ? node.value.oid : undefined;
    const oid = node.action?.oid || valueOid;
    if (!oid) {
        return null;
    }
    if (oid === valueOid) {
        return {
            oid,
            unit: node.unit || sourceUnit(node.value, units) || config.defaults?.unit,
            scale: val => resolveSrc(node.value, () => val),
        };
    }
    return { oid, unit: units?.(oid), scale: val => val };
}

/**
 * Read a stretch of a detail chart.
 *
 * @param read how to read history
 * @param target what to read
 * @param start the stretch
 * @param end the stretch
 * @param step averaged into steps of this many ms
 * @returns the points, rescaled
 */
export async function readDetail(
    read: HistoryReader,
    target: DetailTarget,
    start: number,
    end: number,
    step: number,
): Promise<HistoryPoint[]> {
    const points = historyPoints(await read(target.oid, { start, end, step }));
    return points
        .map(point => ({ ts: point.ts, val: target.scale(point.val) }))
        .filter((point): point is HistoryPoint => point.val !== null);
}
