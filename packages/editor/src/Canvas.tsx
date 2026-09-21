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
 */
import React from 'react';

import {
    computeRuntime,
    createEdge,
    moveNodes,
    nodeRect,
    EnergyFlowView,
    type EnergyFlowConfig,
    type EnergyFlowTheme,
    type FlowNode,
    type Point,
    type ValueGetter,
} from '@energyflow/core';

import type { EditorSelection } from './types';

export interface CanvasProps {
    config: EnergyFlowConfig;
    theme: EnergyFlowTheme;
    /** Live values, so the designer shows the real diagram while it is being built */
    values: ValueGetter;
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
          nodeId: string;
          /** Where the gesture started, in canvas units */
          origin: Point;
          /** The document before the gesture, so every move is computed from the same base */
          base: EnergyFlowConfig;
          /** Whether the pointer travelled far enough to count as a drag rather than a click */
          moved: boolean;
      }
    | { kind: 'connect'; fromId: string; cursor: Point };

/** Width of the invisible stroke that makes an edge clickable, in canvas units */
const EDGE_HIT_WIDTH = 20;

/** How far the pointer must travel before a press turns into a drag */
const DRAG_THRESHOLD = 3;

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
    const { config, theme, values, selection, onSelect, onChange, showGrid, animate } = props;
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    /**
     * No ref shadowing this: the pointer handlers are ordinary props, recreated on every render, so
     * each one already closes over the current gesture. A drag re-renders anyway, because it reports
     * every intermediate position to the parent.
     */
    const [gesture, setGesture] = React.useState<Gesture>({ kind: 'none' });

    const runtime = React.useMemo(() => computeRuntime(config, values, theme), [config, values, theme]);

    const selectedNode = selection.kind === 'node' ? selection.id : undefined;
    const selectedEdge = selection.kind === 'edge' ? selection.id : undefined;

    const startMove = (event: React.PointerEvent, node: FlowNode): void => {
        const svg = svgRef.current;
        if (!svg) {
            return;
        }
        event.stopPropagation();
        // Capture on the SVG, not on the node: the pointer leaves the node as soon as it moves, and
        // without capture the gesture would end there
        svg.setPointerCapture(event.pointerId);
        onSelect({ kind: 'node', id: node.id });
        setGesture({
            kind: 'move',
            nodeId: node.id,
            origin: toCanvasPoint(svg, event.clientX, event.clientY),
            base: config,
            moved: false,
        });
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
        onChange(moveNodes(current.base, [current.nodeId], dx, dy), true);
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
        }

        setGesture({ kind: 'none' });
    };

    const gridSize = config.canvas.grid || 0;

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
            {showGrid && gridSize > 0 ? (
                <>
                    <defs>
                        <pattern
                            id="ef-grid"
                            width={gridSize}
                            height={gridSize}
                            patternUnits="userSpaceOnUse"
                        >
                            <circle
                                cx={0}
                                cy={0}
                                r={0.7}
                                fill={theme.border}
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
            selectedNodes={selectedNode ? [selectedNode] : []}
            selectedEdges={selectedEdge ? [selectedEdge] : []}
            svgProps={{
                ref: svgRef,
                onPointerDown: () => onSelect({ kind: 'canvas' }),
                onPointerMove,
                onPointerUp: endGesture,
                onPointerCancel: endGesture,
                style: { touchAction: 'none' },
            }}
        />
    );
}

export default Canvas;
