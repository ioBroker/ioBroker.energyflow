/**
 * The editing surface.
 *
 * It renders the very same {@link EnergyFlowView} the widget renders at runtime, with live state
 * values, and puts a transparent interaction layer on top. That is the whole reason there is no
 * graph-editor library here: a library draws the diagram *its* way, and then what the user arranges
 * in the editor is not quite what appears in the view. Here there is only one renderer, so the
 * preview is not a preview -- it is the result.
 *
 * Dragging updates the document on every pointer move, marked `transient` so the undo stack gets one
 * entry for the whole gesture instead of one per pixel.
 *
 * Selecting works as in any drawing program: a click selects one node, Shift or Ctrl (⌘ on a Mac) plus
 * click adds or removes one, a frame dragged over the empty canvas selects everything it touches, and
 * dragging any selected node moves all of them.
 */
import React from 'react';

import {
    bendAt,
    computeRuntime,
    createEdge,
    moveNodes,
    nodeRect,
    cachedMax,
    snap,
    updateEdge,
    EnergyFlowView,
    type EnergyFlowConfig,
    type EdgeSegment,
    type EnergyFlowTheme,
    type FlowNode,
    type Point,
    type HistoryGetter,
    type TimeGetter,
    type UnitGetter,
    type ValueGetter,
} from '@energyflow/core';

import { sameNodes, selectedNodeIds, selectNodes } from './selection';
import type { EditorSelection } from './types';

export interface CanvasProps {
    config: EnergyFlowConfig;
    theme: EnergyFlowTheme;
    /** Live values, so the designer shows the real diagram while it is being built */
    values: ValueGetter;
    /** Units of the states, from their objects */
    units?: UnitGetter;
    /** When the states were written and changed, for nodes that show it */
    times?: TimeGetter;
    /** The present, for "12 minutes ago" */
    now?: number;
    /** Recorded values, for nodes that draw a chart */
    history?: HistoryGetter;
    /** Raw state values, for status texts */
    raw?: (oid: string) => unknown;
    /** Today's energy per state */
    energy?: (oid: string) => number | undefined;
    selection: EditorSelection;
    onSelect: (selection: EditorSelection) => void;
    /**
     * @param config the new document
     * @param transient true while a gesture is still running -- do not push an undo entry yet
     */
    onChange: (config: EnergyFlowConfig, transient?: boolean) => void;
    showGrid: boolean;
    animate: boolean;
}

/** What a pointer gesture is currently doing */
type Gesture =
    | { kind: 'none' }
    | {
          kind: 'move';
          /** Every node that moves -- the whole selection when a selected node is dragged */
          ids: string[];
          /** Where the gesture started, in canvas units */
          origin: Point;
          /** The document before the gesture, so every move is computed from the same base */
          base: EnergyFlowConfig;
          /** Whether the pointer travelled far enough to count as a drag rather than a click */
          moved: boolean;
          /**
           * A plain press on one of several selected nodes: if it turns out to be a click rather than
           * a drag, this node alone becomes the selection. Decided on release, because at the press it
           * could still be the start of moving them all.
           */
          clickSelects?: string;
      }
    | { kind: 'connect'; fromId: string; cursor: Point }
    | {
          kind: 'bend';
          edgeId: string;
          /** The segment as it was when the drag started; its ends do not move during the drag */
          segment: EdgeSegment;
          base: EnergyFlowConfig;
          moved: boolean;
      }
    | {
          kind: 'marquee';
          origin: Point;
          cursor: Point;
          /** The selection before the frame, kept when Shift or Ctrl was held */
          before: string[];
      };

/** Width of the invisible stroke that makes an edge clickable, in canvas units */
const EDGE_HIT_WIDTH = 20;

/** How far the pointer must travel before a press turns into a drag */
const DRAG_THRESHOLD = 3;

/**
 * The smallest distance between two grid dots, in canvas units. Snapping still uses the configured
 * grid; only the drawing thins out, because a dot every 10 units is a grey haze rather than a grid.
 */
const GRID_MIN_SPACING = 20;

/**
 * Client coordinates to canvas units.
 *
 * The SVG has a `viewBox` and is scaled by CSS, so the only reliable conversion is through the
 * element's own screen matrix -- computing it from `getBoundingClientRect` breaks as soon as
 * `preserveAspectRatio` letterboxes the drawing, which it does at almost every container size.
 */
function toCanvasPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point {
    const ctm = svg.getScreenCTM();
    if (!ctm) {
        return { x: 0, y: 0 };
    }
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
}

/** Whether a press asks to add to the selection rather than replace it */
function isAdditive(event: React.PointerEvent): boolean {
    return event.shiftKey || event.ctrlKey || event.metaKey;
}

/** The rectangle spanned by two corners, whichever way the frame was dragged */
function spanRect(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** The topmost node under a point, or null. Later nodes are drawn on top, so search backwards. */
function nodeAt(config: EnergyFlowConfig, point: Point): FlowNode | null {
    for (let i = config.nodes.length - 1; i >= 0; i--) {
        const rect = nodeRect(config.nodes[i]);
        if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
            return config.nodes[i];
        }
    }
    return null;
}

export function Canvas(props: CanvasProps): React.JSX.Element {
    const { config, theme, values, units, times, now, history, raw, energy } = props;
    const { selection, onSelect, onChange, showGrid, animate } = props;
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    /**
     * No ref shadowing this: the pointer handlers are ordinary props, recreated on every render, so
     * each one already closes over the current gesture. A drag re-renders anyway, because it reports
     * every intermediate position to the parent.
     */
    const [gesture, setGesture] = React.useState<Gesture>({ kind: 'none' });

    const runtime = React.useMemo(
        () => computeRuntime(config, values, theme, { units, maxima: cachedMax, times, now, history, raw, energy }),
        [config, values, theme, units, times, now, history, raw, energy],
    );

    const selectedIds = selectedNodeIds(selection);
    // The connect handle belongs to exactly one node; with several selected it would be ambiguous
    const selectedNode = selection.kind === 'node' ? selection.id : undefined;
    const selectedEdge = selection.kind === 'edge' ? selection.id : undefined;

    const startMove = (event: React.PointerEvent, node: FlowNode): void => {
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        event.stopPropagation();

        let ids: string[];
        let clickSelects: string | undefined;
        if (isAdditive(event)) {
            ids = selectedIds.includes(node.id) ? selectedIds.filter(id => id !== node.id) : [...selectedIds, node.id];
            onSelect(selectNodes(ids));
            // Taken out of the selection: there is nothing under the pointer left to drag
            if (!ids.includes(node.id)) {
                return;
            }
        } else if (selectedIds.includes(node.id)) {
            ids = selectedIds;
            clickSelects = selectedIds.length > 1 ? node.id : undefined;
        } else {
            ids = [node.id];
            onSelect({ kind: 'node', id: node.id });
        }

        // Capture on the SVG, not on the node: the pointer leaves the node as soon as it moves, and
        // without capture the gesture would end there
        svg.setPointerCapture(event.pointerId);
        setGesture({
            kind: 'move',
            ids,
            origin: toCanvasPoint(svg, event.clientX, event.clientY),
            base: config,
            moved: false,
            clickSelects,
        });
    };

    /** A press on the middle segment of an orthogonal route: selects the edge and lets it be dragged */
    const startBend = (event: React.PointerEvent, edgeId: string, segment: EdgeSegment): void => {
        const svg = svgRef.current;
        if (!svg || event.button !== 0) {
            return;
        }
        event.stopPropagation();
        onSelect({ kind: 'edge', id: edgeId });
        svg.setPointerCapture(event.pointerId);
        setGesture({ kind: 'bend', edgeId, segment, base: config, moved: false });
    };

    /** A press on the empty canvas: clears the selection, and a drag from there draws a frame */
    const startMarquee = (event: React.PointerEvent<SVGSVGElement>): void => {
        const svg = svgRef.current;
        if (!svg || event.button !== 0) {
            return;
        }
        const additive = isAdditive(event);
        if (!additive) {
            onSelect({ kind: 'canvas' });
        }
        const point = toCanvasPoint(svg, event.clientX, event.clientY);
        svg.setPointerCapture(event.pointerId);
        setGesture({ kind: 'marquee', origin: point, cursor: point, before: additive ? selectedIds : [] });
    };

    const startConnect = (event: React.PointerEvent, node: FlowNode): void => {
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        event.stopPropagation();
        svg.setPointerCapture(event.pointerId);
        setGesture({ kind: 'connect', fromId: node.id, cursor: toCanvasPoint(svg, event.clientX, event.clientY) });
    };

    const onPointerMove = (event: React.PointerEvent): void => {
        const current = gesture;
        const svg = svgRef.current;
        if (current.kind === 'none' || !svg) {
            return;
        }

        const point = toCanvasPoint(svg, event.clientX, event.clientY);

        if (current.kind === 'connect') {
            setGesture({ ...current, cursor: point });
            return;
        }

        if (current.kind === 'bend') {
            // On the grid, like everything else that is dragged; stored as a fraction between the ends
            const value = snap(current.segment.axis === 'x' ? point.x : point.y, config.canvas.grid);
            const bend = Math.round(bendAt(current.segment, value) * 1000) / 1000;
            if (!current.moved) {
                setGesture({ ...current, moved: true });
            }
            onChange(updateEdge(current.base, current.edgeId, { bend }), true);
            return;
        }

        if (current.kind === 'marquee') {
            setGesture({ ...current, cursor: point });
            // Everything the frame touches, not only what it covers completely: a frame drawn across a
            // row of nodes is meant to take the row
            const frame = spanRect(current.origin, point);
            const hits = config.nodes
                .filter(node => {
                    const rect = nodeRect(node);
                    return (
                        rect.x < frame.x + frame.w &&
                        rect.x + rect.w > frame.x &&
                        rect.y < frame.y + frame.h &&
                        rect.y + rect.h > frame.y
                    );
                })
                .map(node => node.id);
            const next = [...new Set([...current.before, ...hits])];
            if (!sameNodes(selection, next)) {
                onSelect(selectNodes(next));
            }
            return;
        }

        const dx = point.x - current.origin.x;
        const dy = point.y - current.origin.y;

        if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
            return;
        }
        if (!current.moved) {
            setGesture({ ...current, moved: true });
        }

        // Always computed from `base`, never from the previous frame: accumulating deltas would drift
        // because every step is snapped to the grid
        onChange(moveNodes(current.base, current.ids, dx, dy), true);
    };

    const endGesture = (event: React.PointerEvent): void => {
        const current = gesture;
        const svg = svgRef.current;
        if (current.kind === 'none') {
            return;
        }
        if (svg?.hasPointerCapture(event.pointerId)) {
            svg.releasePointerCapture(event.pointerId);
        }

        if (current.kind === 'connect' && svg) {
            const target = nodeAt(config, toCanvasPoint(svg, event.clientX, event.clientY));
            if (target && target.id !== current.fromId) {
                const edge = createEdge(config, current.fromId, target.id);
                onChange({ ...config, edges: [...config.edges, edge] });
                onSelect({ kind: 'edge', id: edge.id });
            }
        } else if (current.kind === 'move' && current.moved) {
            // Re-emit the final position as a non-transient change so it lands on the undo stack
            onChange(config);
        } else if (current.kind === 'bend' && current.moved) {
            onChange(config);
        } else if (current.kind === 'move' && current.clickSelects) {
            onSelect({ kind: 'node', id: current.clickSelects });
        }

        setGesture({ kind: 'none' });
    };

    const gridSize = config.canvas.grid || 0;
    // A whole multiple of the snap grid, so every dot is a position a node can actually land on
    const dotStep = gridSize > 0 ? gridSize * Math.max(1, Math.ceil(GRID_MIN_SPACING / gridSize)) : 0;

    const background = (
        <>
            <rect
                x={0}
                y={0}
                width={config.canvas.w}
                height={config.canvas.h}
                fill="none"
                stroke={theme.border}
                strokeWidth={1}
                strokeDasharray="4 4"
            />
            {showGrid && dotStep > 0 ? (
                <>
                    <defs>
                        {/* The dot sits in the middle of the tile and the tile is shifted back by half a
                            step: a dot at the tile's corner is clipped to a quarter, which is what made
                            the grid invisible. The colour is the secondary text colour, faded, because
                            the divider colour of a dark theme is itself almost transparent */}
                        <pattern
                            id="ef-grid"
                            x={-dotStep / 2}
                            y={-dotStep / 2}
                            width={dotStep}
                            height={dotStep}
                            patternUnits="userSpaceOnUse"
                        >
                            <circle
                                cx={dotStep / 2}
                                cy={dotStep / 2}
                                r={Math.max(1, dotStep / 16)}
                                fill={theme.textSecondary}
                                fillOpacity={0.35}
                            />
                        </pattern>
                    </defs>
                    <rect
                        x={0}
                        y={0}
                        width={config.canvas.w}
                        height={config.canvas.h}
                        fill="url(#ef-grid)"
                    />
                </>
            ) : null}
        </>
    );

    const connectingFrom = gesture.kind === 'connect' ? runtime.nodeById[gesture.fromId] : undefined;

    const overlay = (
        <g>
            {/* Edge hit areas. A transparent stroke wide enough to aim at, with `pointerEvents` on the
                stroke only, so the area inside a curve stays clickable for whatever is behind it */}
            {runtime.edges.map(edge =>
                edge.visible ? (
                    <path
                        key={`hit-${edge.edge.id}`}
                        d={edge.geometry.d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={EDGE_HIT_WIDTH}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onPointerDown={event => {
                            event.stopPropagation();
                            onSelect({ kind: 'edge', id: edge.edge.id });
                        }}
                    />
                ) : null,
            )}

            {/* The movable middle segments of orthogonal routes, over the rest of their line so a press
                there drags the segment instead of only selecting the edge. A double click puts it back
                in the middle */}
            {runtime.edges.map(edge => {
                const segment = edge.visible ? edge.geometry.segment : undefined;
                if (!segment) {
                    return null;
                }
                return (
                    <line
                        key={`bend-${edge.edge.id}`}
                        x1={segment.start.x}
                        y1={segment.start.y}
                        x2={segment.end.x}
                        y2={segment.end.y}
                        stroke="transparent"
                        strokeWidth={EDGE_HIT_WIDTH}
                        style={{
                            pointerEvents: 'stroke',
                            cursor: segment.axis === 'x' ? 'ew-resize' : 'ns-resize',
                        }}
                        onPointerDown={event => startBend(event, edge.edge.id, segment)}
                        onDoubleClick={() => onChange(updateEdge(config, edge.edge.id, { bend: undefined }))}
                    />
                );
            })}

            {/* Node hit areas, on top of the edges so a node under a line still wins */}
            {runtime.nodes.map(node => {
                const { rect } = node;
                return (
                    <rect
                        key={`hit-${node.node.id}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.w}
                        height={rect.h}
                        rx={node.shape === 'circle' ? Math.min(rect.w, rect.h) / 2 : 14}
                        fill="transparent"
                        style={{ cursor: 'move' }}
                        onPointerDown={event => startMove(event, node.node)}
                    />
                );
            })}

            {/* The connect handle of the selected node */}
            {selectedNode && runtime.nodeById[selectedNode]
                ? (() => {
                      const node = runtime.nodeById[selectedNode];
                      const handleX = node.rect.x + node.rect.w + 14;
                      const handleY = node.rect.y + node.rect.h / 2;
                      return (
                          <g
                              style={{ cursor: 'crosshair' }}
                              onPointerDown={event => startConnect(event, node.node)}
                          >
                              <circle
                                  cx={handleX}
                                  cy={handleY}
                                  r={11}
                                  fill={theme.surface}
                                  stroke={node.color}
                                  strokeWidth={1.8}
                              />
                              <path
                                  d={`M${handleX - 5} ${handleY} H${handleX + 5} M${handleX} ${handleY - 5} V${handleY + 5}`}
                                  stroke={node.color}
                                  strokeWidth={1.8}
                                  strokeLinecap="round"
                              />
                          </g>
                      );
                  })()
                : null}

            {/* A grip on the middle segment of the selected edge, so it is visible that it can be moved */}
            {selectedEdge && runtime.edges.find(edge => edge.edge.id === selectedEdge)?.geometry.segment
                ? (() => {
                      const edge = runtime.edges.find(item => item.edge.id === selectedEdge)!;
                      const segment = edge.geometry.segment!;
                      const cx = (segment.start.x + segment.end.x) / 2;
                      const cy = (segment.start.y + segment.end.y) / 2;
                      const vertical = segment.axis === 'x';
                      return (
                          <rect
                              x={cx - (vertical ? 5 : 14)}
                              y={cy - (vertical ? 14 : 5)}
                              width={vertical ? 10 : 28}
                              height={vertical ? 28 : 10}
                              rx={5}
                              fill={theme.surface}
                              stroke={edge.color}
                              strokeWidth={1.8}
                              style={{ pointerEvents: 'none' }}
                          />
                      );
                  })()
                : null}

            {/* The selection frame */}
            {gesture.kind === 'marquee'
                ? (() => {
                      const frame = spanRect(gesture.origin, gesture.cursor);
                      return (
                          <rect
                              x={frame.x}
                              y={frame.y}
                              width={frame.w}
                              height={frame.h}
                              fill={theme.textSecondary}
                              fillOpacity={0.08}
                              stroke={theme.textSecondary}
                              strokeWidth={1}
                              strokeDasharray="5 4"
                              vectorEffect="non-scaling-stroke"
                              style={{ pointerEvents: 'none' }}
                          />
                      );
                  })()
                : null}

            {/* The rubber band while a connection is being drawn */}
            {connectingFrom && gesture.kind === 'connect' ? (
                <line
                    x1={connectingFrom.rect.x + connectingFrom.rect.w / 2}
                    y1={connectingFrom.rect.y + connectingFrom.rect.h / 2}
                    x2={gesture.cursor.x}
                    y2={gesture.cursor.y}
                    stroke={connectingFrom.color}
                    strokeWidth={2.5}
                    strokeDasharray="7 5"
                    style={{ pointerEvents: 'none' }}
                />
            ) : null}
        </g>
    );

    return (
        <EnergyFlowView
            runtime={runtime}
            theme={theme}
            animate={animate}
            background={background}
            overlay={overlay}
            selectedNodes={selectedIds}
            selectedEdges={selectedEdge ? [selectedEdge] : []}
            svgProps={{
                ref: svgRef,
                // Focusable, and focused by any press on it: the keyboard shortcuts act while the focus is
                // in the designer, and a click on the drawing is the clearest way of saying "here". It
                // also takes the focus out of an inspector field, so Delete deletes the node, not a letter
                tabIndex: -1,
                onPointerDownCapture: () => svgRef.current?.focus({ preventScroll: true }),
                onPointerDown: startMarquee,
                onPointerMove,
                onPointerUp: endGesture,
                onPointerCancel: endGesture,
                style: { touchAction: 'none', outline: 'none' },
            }}
        />
    );
}

export default Canvas;
