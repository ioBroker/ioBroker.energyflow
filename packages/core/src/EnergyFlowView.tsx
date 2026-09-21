/**
 * The renderer. One `<svg>` with a `viewBox`, so the whole diagram scales into whatever box the host
 * gives it -- a 2x2 tile in the device manager or a full-width vis-2 view -- without any of the
 * per-element pixel arithmetic the predecessor needs.
 *
 * No MUI, no `styled()`, no icon package: see `theme.ts` for why, and `icons.tsx` for the icons.
 * The only dependency is React itself.
 *
 * The animation is CSS on a second, dashed copy of each line. That keeps it on the compositor, makes
 * it pausable with one class on the root element, and costs one extra `<path>` per flowing edge --
 * where a JavaScript animation would cost a `requestAnimationFrame` loop per diagram and a re-render
 * of everything in it.
 */
import React from 'react';

import { withAlpha, type EnergyFlowTheme } from './theme';
import { renderBuiltinIcon } from './icons';
import type { EdgeRuntime, FlowRuntime, NodeRuntime } from './runtime';
import type { FlowNode, Point } from './types';

/**
 * `--ef-shift` is the distance the dash pattern travels in one cycle: one gap, negative along the
 * path and positive against it. Because the pattern repeats every gap, the end of a cycle looks
 * exactly like its start and the loop is seamless whatever the duration.
 */
const CSS = `
.ef-root { display: block; width: 100%; height: 100%; }
.ef-dots {
    animation-name: ef-flow;
    animation-duration: var(--ef-dur, 1s);
    animation-timing-function: linear;
    animation-iteration-count: infinite;
}
.ef-paused .ef-dots { animation-play-state: paused; }
.ef-clickable { cursor: pointer; }
.ef-node-hit { fill: transparent; stroke: none; }
@keyframes ef-flow { to { stroke-dashoffset: var(--ef-shift, -26px); } }
@media (prefers-reduced-motion: reduce) {
    .ef-dots { animation-name: none; }
}
`;

export interface EnergyFlowViewProps {
    runtime: FlowRuntime;
    theme: EnergyFlowTheme;
    /**
     * Whether the dots move. The host decides: it knows whether the tab is hidden, whether the
     * widget scrolled out of view and whether the user asked for reduced motion. While this is
     * false, an active edge shows a static arrow instead, so the direction is still readable.
     */
    animate?: boolean;
    /** Called when a node with an action is clicked */
    onNodeClick?: (node: FlowNode, event: React.MouseEvent) => void;
    /** Drawn behind everything -- the editor puts its grid here */
    background?: React.ReactNode;
    /** Drawn on top of everything -- the editor puts its handles here */
    overlay?: React.ReactNode;
    /** Ids of nodes drawn with a selection ring */
    selectedNodes?: string[];
    /** Ids of edges drawn with a selection ring */
    selectedEdges?: string[];
    /**
     * Drop the node labels and the edge labels.
     *
     * For a small tile -- a 1x1 card in the device manager is a couple of centimetres across -- the
     * text scales down with the `viewBox` until it is a grey smudge, and the shapes and the moving
     * dots carry the information better on their own. The values inside the nodes stay.
     */
    hideLabels?: boolean;
    className?: string;
    style?: React.CSSProperties;
    /** Forwarded to the `<svg>`, so the editor can attach its pointer handling */
    svgProps?: React.SVGProps<SVGSVGElement>;
}

/** An arrowhead at `point`, pointing along `direction` */
function arrowPath(point: Point, direction: Point, size: number, reversed: boolean): string {
    const dx = reversed ? -direction.x : direction.x;
    const dy = reversed ? -direction.y : direction.y;
    // The two barbs are the direction vector rotated by +/- 140 degrees, scaled to `size`
    const angle = Math.atan2(dy, dx);
    const spread = (140 * Math.PI) / 180;
    const tipX = point.x + dx * size * 0.5;
    const tipY = point.y + dy * size * 0.5;
    const left = { x: tipX + Math.cos(angle + spread) * size, y: tipY + Math.sin(angle + spread) * size };
    const right = { x: tipX + Math.cos(angle - spread) * size, y: tipY + Math.sin(angle - spread) * size };
    const r = (value: number): number => Math.round(value * 100) / 100;
    return `M${r(left.x)} ${r(left.y)} L${r(tipX)} ${r(tipY)} L${r(right.x)} ${r(right.y)}`;
}

function EdgeLayer({
    edges,
    animate,
    selected,
    animationGap,
    dotSize,
}: {
    edges: EdgeRuntime[];
    animate: boolean;
    selected: Set<string>;
    animationGap: number;
    dotSize: number;
}): React.ReactElement {
    return (
        <g className="ef-edges">
            {edges.map(edge => {
                if (!edge.visible) {
                    return null;
                }
                const isSelected = selected.has(edge.edge.id);
                const moving = animate && edge.dotDuration > 0;

                return (
                    <g key={edge.edge.id}>
                        {isSelected ? (
                            <path
                                d={edge.geometry.d}
                                fill="none"
                                stroke={edge.color}
                                strokeOpacity={0.3}
                                strokeWidth={edge.width + 8}
                                strokeLinecap="round"
                            />
                        ) : null}
                        <path
                            d={edge.geometry.d}
                            fill="none"
                            stroke={edge.color}
                            strokeWidth={edge.width}
                            strokeLinecap="round"
                        />
                        {moving ? (
                            <path
                                className="ef-dots"
                                d={edge.geometry.d}
                                fill="none"
                                stroke={edge.color}
                                strokeWidth={dotSize}
                                strokeLinecap="round"
                                // A dash of (almost) zero length plus a round cap is a dot. The gap
                                // is what the animation shifts by, so dots stay evenly spaced
                                // whatever the path length.
                                strokeDasharray={`0.01 ${animationGap}`}
                                style={
                                    {
                                        '--ef-dur': `${edge.dotDuration}s`,
                                        '--ef-shift': `${edge.direction < 0 ? animationGap : -animationGap}px`,
                                    } as React.CSSProperties
                                }
                            />
                        ) : null}
                        {!moving && edge.active ? (
                            <path
                                d={arrowPath(
                                    edge.geometry.mid,
                                    edge.geometry.midDir,
                                    // Big enough to read at a glance even on a thin line: the arrow
                                    // has to carry the direction on its own here, since the dots
                                    // that normally do that are standing still
                                    Math.max(edge.width * 4, 12),
                                    edge.direction < 0,
                                )}
                                fill="none"
                                stroke={edge.color}
                                strokeWidth={edge.width}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        ) : null}
                    </g>
                );
            })}
        </g>
    );
}

function EdgeLabels({
    edges,
    theme,
    fontSize,
}: {
    edges: EdgeRuntime[];
    theme: EnergyFlowTheme;
    fontSize: number;
}): React.ReactElement {
    return (
        <g className="ef-edge-labels">
            {edges.map(edge => {
                if (!edge.visible || !edge.edge.showValue) {
                    return null;
                }
                return (
                    <text
                        key={edge.edge.id}
                        x={edge.labelPos.x}
                        y={edge.labelPos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={fontSize}
                        fontWeight={600}
                        fill={edge.active ? theme.text : theme.textSecondary}
                        // The label sits on top of the line it belongs to; a halo in the background
                        // colour keeps it legible without a solid box behind it
                        stroke={theme.mode === 'dark' ? '#000' : '#fff'}
                        strokeWidth={fontSize * 0.28}
                        strokeOpacity={0.55}
                        paintOrder="stroke"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                        {edge.valueText.text}
                    </text>
                );
            })}
        </g>
    );
}

/** The body of a node: the shape, its tint and the charge level of a battery */
function NodeShapeBody({ node, theme }: { node: NodeRuntime; theme: EnergyFlowTheme }): React.ReactElement {
    const { rect, shape, color } = node;
    const tint = withAlpha(color, theme.mode === 'dark' ? 0.16 : 0.09);
    const outline = withAlpha(color, 0.45);
    const radius = shape === 'rounded' ? 16 : shape === 'square' ? 8 : 0;

    if (shape === 'circle') {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        return (
            <>
                <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rect.w / 2}
                    ry={rect.h / 2}
                    fill={theme.surface}
                />
                <ellipse
                    cx={cx}
                    cy={cy}
                    rx={rect.w / 2}
                    ry={rect.h / 2}
                    fill={tint}
                    stroke={outline}
                    strokeWidth={1.6}
                />
            </>
        );
    }

    const clipId = `ef-clip-${node.node.id}`;

    return (
        <>
            <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                rx={radius}
                fill={theme.surface}
            />
            {/* The base tint goes under the charge level, so the empty part of a battery looks like
                the other nodes rather than like a hole */}
            <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                rx={radius}
                fill={tint}
            />
            {/* The charge level is drawn inside the body, clipped to the rounded shape, so a battery
                reads as a container that fills up rather than as a number with a bar next to it. The
                step from the tint to the fill has to be big enough to read at tile size. */}
            {node.soc !== null ? (
                <>
                    <clipPath id={clipId}>
                        <rect
                            x={rect.x}
                            y={rect.y}
                            width={rect.w}
                            height={rect.h}
                            rx={radius}
                        />
                    </clipPath>
                    <g clipPath={`url(#${clipId})`}>
                        <rect
                            x={rect.x}
                            y={rect.y + rect.h * (1 - node.soc / 100)}
                            width={rect.w}
                            height={rect.h * (node.soc / 100)}
                            fill={withAlpha(color, theme.mode === 'dark' ? 0.4 : 0.26)}
                        />
                    </g>
                </>
            ) : null}
            <rect
                x={rect.x}
                y={rect.y}
                width={rect.w}
                height={rect.h}
                rx={radius}
                fill="none"
                stroke={outline}
                strokeWidth={1.6}
            />
        </>
    );
}

function NodeLayer({
    nodes,
    theme,
    selected,
    onNodeClick,
    hideLabels,
    labelFontSize,
}: {
    nodes: NodeRuntime[];
    theme: EnergyFlowTheme;
    selected: Set<string>;
    onNodeClick?: (node: FlowNode, event: React.MouseEvent) => void;
    hideLabels?: boolean;
    labelFontSize: number;
}): React.ReactElement {
    return (
        <g className="ef-nodes">
            {nodes.map(node => {
                if (!node.visible) {
                    return null;
                }

                const { rect } = node;
                const cx = rect.x + rect.w / 2;
                const cy = rect.y + rect.h / 2;
                const isSelected = selected.has(node.node.id);
                const clickable = !!node.node.action && node.node.action.type !== 'none';

                if (node.node.kind === 'label') {
                    return (
                        <text
                            key={node.node.id}
                            x={cx}
                            y={cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={node.fontSize}
                            fontWeight={600}
                            fill={node.node.color || theme.text}
                            style={{ userSelect: 'none' }}
                        >
                            {node.node.text || node.node.label || ''}
                        </text>
                    );
                }

                if (node.node.kind === 'image') {
                    return node.icon ? (
                        <image
                            key={node.node.id}
                            x={rect.x}
                            y={rect.y}
                            width={rect.w}
                            height={rect.h}
                            href={node.icon}
                            preserveAspectRatio="xMidYMid meet"
                        />
                    ) : null;
                }

                if (node.node.kind === 'bus') {
                    return (
                        <circle
                            key={node.node.id}
                            cx={cx}
                            cy={cy}
                            r={Math.min(rect.w, rect.h) / 2}
                            fill={node.color}
                            stroke={isSelected ? theme.text : 'none'}
                            strokeWidth={isSelected ? 2 : 0}
                        />
                    );
                }

                const hasBadges = node.badges.length > 0 || node.soc !== null;
                const iconSize = Math.min(rect.w, rect.h) * 0.34;
                const iconY = cy - rect.h * 0.16;
                // Without an icon there is no top half to leave free, so the value moves into the
                // middle -- a small box with nothing but a number would otherwise look bottom-heavy
                const valueY = node.icon ? cy + rect.h * 0.15 : cy - (hasBadges ? node.fontSize * 0.4 : 0);

                return (
                    <g
                        key={node.node.id}
                        className={clickable ? 'ef-clickable' : undefined}
                        onClick={clickable && onNodeClick ? event => onNodeClick(node.node, event) : undefined}
                    >
                        {node.node.label ? <title>{node.node.label}</title> : null}

                        {isSelected ? (
                            <rect
                                x={rect.x - 6}
                                y={rect.y - 6}
                                width={rect.w + 12}
                                height={rect.h + 12}
                                rx={node.shape === 'circle' ? (rect.w + 12) / 2 : 20}
                                fill="none"
                                stroke={node.color}
                                strokeWidth={2}
                                strokeDasharray="6 4"
                            />
                        ) : null}

                        <NodeShapeBody
                            node={node}
                            theme={theme}
                        />

                        {renderBuiltinIcon(node.icon, { x: cx, y: iconY, size: iconSize, color: node.color }) ??
                            (node.icon && !node.icon.startsWith('ef:') ? (
                                <image
                                    x={cx - iconSize / 2}
                                    y={iconY - iconSize / 2}
                                    width={iconSize}
                                    height={iconSize}
                                    href={node.icon}
                                    preserveAspectRatio="xMidYMid meet"
                                />
                            ) : null)}

                        <text
                            x={cx}
                            y={valueY}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={node.fontSize}
                            fontWeight={700}
                            fill={theme.text}
                            style={{ userSelect: 'none' }}
                        >
                            {node.valueText.text}
                        </text>

                        {hasBadges ? (
                            <text
                                x={cx}
                                y={valueY + node.fontSize * 0.95}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={node.fontSize * 0.64}
                                fill={theme.textSecondary}
                                style={{ userSelect: 'none' }}
                            >
                                {[
                                    node.soc !== null ? `${Math.round(node.soc)} %` : null,
                                    ...node.badges.map(badge =>
                                        badge.label ? `${badge.label} ${badge.text}` : badge.text,
                                    ),
                                ]
                                    .filter(Boolean)
                                    .join('  ·  ')}
                            </text>
                        ) : null}

                        {node.node.label && !hideLabels ? (
                            <text
                                x={cx}
                                y={rect.y + rect.h + labelFontSize + 3}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={labelFontSize}
                                fill={theme.textSecondary}
                                style={{ userSelect: 'none' }}
                            >
                                {node.node.label}
                            </text>
                        ) : null}

                        {/* A transparent shape over the whole node so a click anywhere on it counts,
                            not only on the text or the icon */}
                        {clickable ? (
                            <rect
                                className="ef-node-hit"
                                x={rect.x}
                                y={rect.y}
                                width={rect.w}
                                height={rect.h}
                                rx={node.shape === 'circle' ? rect.w / 2 : 16}
                            />
                        ) : null}
                    </g>
                );
            })}
        </g>
    );
}

/**
 * Draw a diagram.
 *
 * @param props the runtime to draw, the theme and the interaction hooks
 * @returns the SVG element
 */
export function EnergyFlowView(props: EnergyFlowViewProps): React.ReactElement {
    const { runtime, theme, animate = true, onNodeClick, background, overlay, className, style, svgProps } = props;
    const hideLabels = props.hideLabels;
    const { canvas } = runtime.config;

    const selectedNodes = React.useMemo(() => new Set(props.selectedNodes || []), [props.selectedNodes]);
    const selectedEdges = React.useMemo(() => new Set(props.selectedEdges || []), [props.selectedEdges]);

    return (
        <svg
            {...svgProps}
            className={`ef-root${animate ? '' : ' ef-paused'}${className ? ` ${className}` : ''}`}
            viewBox={`0 0 ${canvas.w} ${canvas.h}`}
            preserveAspectRatio="xMidYMid meet"
            style={style}
        >
            <style>{CSS}</style>
            {canvas.background ? (
                <rect
                    x={0}
                    y={0}
                    width={canvas.w}
                    height={canvas.h}
                    fill={canvas.background}
                />
            ) : null}
            {background}
            <EdgeLayer
                edges={runtime.edges}
                animate={animate}
                selected={selectedEdges}
                animationGap={runtime.animation.gap}
                dotSize={runtime.animation.dotSize}
            />
            <NodeLayer
                nodes={runtime.nodes}
                theme={theme}
                selected={selectedNodes}
                onNodeClick={onNodeClick}
                hideLabels={hideLabels}
                labelFontSize={runtime.labelFontSize}
            />
            {hideLabels ? null : (
                <EdgeLabels
                    edges={runtime.edges}
                    theme={theme}
                    fontSize={runtime.labelFontSize}
                />
            )}
            {overlay}
        </svg>
    );
}

export default EnergyFlowView;
