/**
 * Where an edge attaches to a node and which way it runs.
 *
 * This file is why the document has no `d` attributes in it. `iobroker.energiefluss-erweitert`
 * stores the finished path (`"M237 103 V 124.6 A 15 15 0 0 0 252 139.6 H 422 ..."`) together with
 * the two slots it was drawn between, so dragging a node leaves every path it touches pointing at
 * the old position until the user redraws them by hand. Here the route is recomputed from the two
 * node rectangles on every render, and dragging a node is free.
 */
import type { EdgeCurve, NodeShape, Point, Rect, Side } from './types';

/** A point on the outline of a node, plus the direction an edge should leave in */
export interface Anchor {
    point: Point;
    /** Unit vector pointing away from the node */
    dir: Point;
}

/** The finished route of an edge */
export interface EdgeGeometry {
    /** The `d` attribute of the SVG path */
    d: string;
    /** Halfway along the route -- where a value label goes */
    mid: Point;
    /** Direction of travel at `mid`, so a label can be pushed to the side of the line */
    midDir: Point;
    /** Approximate length in canvas units */
    length: number;
}

const SIDE_NORMALS: Record<Exclude<Side, 'auto'>, Point> = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
};

function center(rect: Rect): Point {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function length(vector: Point): number {
    return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

function normalize(vector: Point): Point {
    const len = length(vector);
    // A zero vector happens when two nodes sit on exactly the same spot, which the editor allows
    // while dragging. Pick an arbitrary direction rather than producing NaN coordinates.
    return len < 1e-6 ? { x: 1, y: 0 } : { x: vector.x / len, y: vector.y / len };
}

/**
 * The side of a rectangle that faces a point.
 *
 * Compares the offset relative to the half-extents rather than in absolute units, so a wide, flat
 * node hands out its long sides rather than its short ones.
 */
function sideTowards(rect: Rect, towards: Point): Exclude<Side, 'auto'> {
    const c = center(rect);
    const dx = (towards.x - c.x) / Math.max(rect.w / 2, 1);
    const dy = (towards.y - c.y) / Math.max(rect.h / 2, 1);
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'bottom' : 'top';
}

/**
 * Where an edge leaves or enters a node.
 *
 * A circle with `auto` attaches radially -- on the straight line between the two nodes -- which is
 * what makes the classic sun/house/battery diagram look right without anybody choosing sides. Every
 * other combination attaches at the middle of a side.
 *
 * @param rect the box of the node
 * @param shape how the node is drawn
 * @param side the configured side, or `auto`
 * @param towards the point the edge runs to
 * @returns the anchor point and its outward direction
 */
export function anchorOf(rect: Rect, shape: NodeShape, side: Side | undefined, towards: Point): Anchor {
    const c = center(rect);
    const effective = !side || side === 'auto' ? null : side;

    if (shape === 'circle') {
        const dir = effective ? SIDE_NORMALS[effective] : normalize({ x: towards.x - c.x, y: towards.y - c.y });
        // An ellipse rather than a circle when the node was resized to a non-square box
        const point = { x: c.x + dir.x * (rect.w / 2), y: c.y + dir.y * (rect.h / 2) };
        return { point, dir };
    }

    const chosen = effective || sideTowards(rect, towards);
    const dir = SIDE_NORMALS[chosen];
    const point = {
        x: c.x + dir.x * (rect.w / 2),
        y: c.y + dir.y * (rect.h / 2),
    };
    return { point, dir };
}

/** Point on a cubic Bézier at parameter `t` */
function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    return {
        x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
        y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
    };
}

/** Tangent of a cubic Bézier at parameter `t`, normalized */
function cubicTangentAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
    const mt = 1 - t;
    return normalize({
        x: 3 * mt * mt * (c1.x - p0.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x),
        y: 3 * mt * mt * (c1.y - p0.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y),
    });
}

/** Length of a cubic, sampled. Exact enough for placing a label and for animation timing. */
function cubicLength(p0: Point, c1: Point, c2: Point, p3: Point, samples = 16): number {
    let total = 0;
    let previous = p0;
    for (let i = 1; i <= samples; i++) {
        const current = cubicAt(p0, c1, c2, p3, i / samples);
        total += length({ x: current.x - previous.x, y: current.y - previous.y });
        previous = current;
    }
    return total;
}

function format(value: number): string {
    // Two decimals is below what any display can resolve and keeps the `d` attribute short, which
    // matters because it is re-created on every render
    return Number.isFinite(value) ? `${Math.round(value * 100) / 100}` : '0';
}

/** The route of a polyline, with the corners rounded off */
function roundedPolyline(points: Point[], radius: number): string {
    if (points.length < 2) {
        return '';
    }
    if (points.length === 2) {
        return `M${format(points[0].x)} ${format(points[0].y)} L${format(points[1].x)} ${format(points[1].y)}`;
    }

    let d = `M${format(points[0].x)} ${format(points[0].y)}`;

    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1];
        const corner = points[i];
        const next = points[i + 1];

        const incoming = { x: corner.x - previous.x, y: corner.y - previous.y };
        const outgoing = { x: next.x - corner.x, y: next.y - corner.y };
        const incomingLength = length(incoming);
        const outgoingLength = length(outgoing);

        if (incomingLength < 1e-6 || outgoingLength < 1e-6) {
            continue;
        }

        // Never eat more than half of either segment, or consecutive corners would overlap
        const r = Math.min(radius, incomingLength / 2, outgoingLength / 2);
        const start = {
            x: corner.x - (incoming.x / incomingLength) * r,
            y: corner.y - (incoming.y / incomingLength) * r,
        };
        const end = {
            x: corner.x + (outgoing.x / outgoingLength) * r,
            y: corner.y + (outgoing.y / outgoingLength) * r,
        };

        d += ` L${format(start.x)} ${format(start.y)} Q${format(corner.x)} ${format(corner.y)} ${format(end.x)} ${format(end.y)}`;
    }

    const last = points[points.length - 1];
    d += ` L${format(last.x)} ${format(last.y)}`;
    return d;
}

/** Total length of a polyline */
function polylineLength(points: Point[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += length({ x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y });
    }
    return total;
}

/** The point halfway along a polyline, and the direction of travel there */
function polylineMid(points: Point[]): { mid: Point; midDir: Point } {
    const half = polylineLength(points) / 2;
    let travelled = 0;

    for (let i = 1; i < points.length; i++) {
        const segment = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
        const segmentLength = length(segment);
        if (travelled + segmentLength >= half && segmentLength > 1e-6) {
            const t = (half - travelled) / segmentLength;
            return {
                mid: { x: points[i - 1].x + segment.x * t, y: points[i - 1].y + segment.y * t },
                midDir: normalize(segment),
            };
        }
        travelled += segmentLength;
    }

    const last = points[points.length - 1] || { x: 0, y: 0 };
    return { mid: last, midDir: { x: 1, y: 0 } };
}

/**
 * A right-angled route between two anchors.
 *
 * The shape depends on whether each end leaves horizontally or vertically: two horizontal ends get
 * a vertical connecting segment in the middle, a horizontal and a vertical end get a single corner.
 */
function orthogonalPoints(from: Anchor, to: Anchor): Point[] {
    const fromHorizontal = Math.abs(from.dir.x) > Math.abs(from.dir.y);
    const toHorizontal = Math.abs(to.dir.x) > Math.abs(to.dir.y);

    if (fromHorizontal && toHorizontal) {
        const mx = (from.point.x + to.point.x) / 2;
        return [from.point, { x: mx, y: from.point.y }, { x: mx, y: to.point.y }, to.point];
    }
    if (!fromHorizontal && !toHorizontal) {
        const my = (from.point.y + to.point.y) / 2;
        return [from.point, { x: from.point.x, y: my }, { x: to.point.x, y: my }, to.point];
    }
    if (fromHorizontal) {
        return [from.point, { x: to.point.x, y: from.point.y }, to.point];
    }
    return [from.point, { x: from.point.x, y: to.point.y }, to.point];
}

/** How far the Bézier control points are pushed out along the anchor directions */
function controlOffset(from: Point, to: Point): number {
    const distance = length({ x: to.x - from.x, y: to.y - from.y });
    // Proportional in the middle range, capped at both ends: short edges must not loop back on
    // themselves, long ones must not turn into a semicircle
    return Math.min(Math.max(distance * 0.38, 26), 170);
}

/**
 * Compute the route of an edge.
 *
 * @param from where it leaves
 * @param to where it arrives
 * @param curve the requested shape
 * @param waypoints fixed intermediate points; they force a polyline route
 * @param cornerRadius how much the corners of a polyline are rounded
 * @returns path, midpoint and length
 */
export function edgeGeometry(
    from: Anchor,
    to: Anchor,
    curve: EdgeCurve = 'bezier',
    waypoints?: Point[],
    cornerRadius = 16,
): EdgeGeometry {
    const hasWaypoints = Array.isArray(waypoints) && waypoints.length > 0;

    // Waypoints are an explicit instruction about where the line has to go, so they always win over
    // a computed curve -- rounding the corners is as far as the interpretation goes
    if (hasWaypoints) {
        const points = [from.point, ...waypoints, to.point];
        const { mid, midDir } = polylineMid(points);
        return { d: roundedPolyline(points, cornerRadius), mid, midDir, length: polylineLength(points) };
    }

    if (curve === 'straight') {
        const points = [from.point, to.point];
        const { mid, midDir } = polylineMid(points);
        return {
            d: `M${format(from.point.x)} ${format(from.point.y)} L${format(to.point.x)} ${format(to.point.y)}`,
            mid,
            midDir,
            length: polylineLength(points),
        };
    }

    if (curve === 'orthogonal') {
        const points = orthogonalPoints(from, to);
        const { mid, midDir } = polylineMid(points);
        return { d: roundedPolyline(points, cornerRadius), mid, midDir, length: polylineLength(points) };
    }

    const offset = controlOffset(from.point, to.point);
    const c1 = { x: from.point.x + from.dir.x * offset, y: from.point.y + from.dir.y * offset };
    const c2 = { x: to.point.x + to.dir.x * offset, y: to.point.y + to.dir.y * offset };

    return {
        d: `M${format(from.point.x)} ${format(from.point.y)} C${format(c1.x)} ${format(c1.y)} ${format(c2.x)} ${format(c2.y)} ${format(to.point.x)} ${format(to.point.y)}`,
        mid: cubicAt(from.point, c1, c2, to.point, 0.5),
        midDir: cubicTangentAt(from.point, c1, c2, to.point, 0.5),
        length: cubicLength(from.point, c1, c2, to.point),
    };
}

/**
 * Push a label off the line so it does not sit on top of it.
 *
 * @param point the point on the line
 * @param direction direction of travel there
 * @param distance how far to move, in canvas units
 * @returns the offset point
 */
export function offsetFromLine(point: Point, direction: Point, distance: number): Point {
    // The normal of the direction; the sign is chosen so a label ends up above a horizontal line
    // and to the right of a vertical one, which is where a reader looks for it
    const normal = direction.x >= 0 ? { x: direction.y, y: -direction.x } : { x: -direction.y, y: direction.x };
    return { x: point.x + normal.x * distance, y: point.y + normal.y * distance };
}
