/**
 * A value over time, large: the detail view a node opens on click.
 *
 * Plain SVG like the diagram itself -- no chart library for one line with two axes. The numbers are
 * written with the same formatting as the node, so "2.4 kW" on the axis means what it means in the
 * diagram.
 */
import React from 'react';

import { formatNumber, formatValue } from './format';
import type { HistoryPoint } from './history';
import { withAlpha, type FlowTheme } from './theme';

export interface HistoryChartProps {
    points: HistoryPoint[];
    start: number;
    end: number;
    color: string;
    theme: FlowTheme;
    unit?: string;
    /** Width and height of the drawing, in pixels */
    width?: number;
    height?: number;
}

/** Min, max and the time-weighted-enough average of a series; null for no data */
export function historyStats(points: HistoryPoint[]): { min: number; max: number; avg: number } | null {
    if (!points.length) {
        return null;
    }
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const point of points) {
        min = Math.min(min, point.val);
        max = Math.max(max, point.val);
        sum += point.val;
    }
    return { min, max, avg: sum / points.length };
}

/** A tick label for a point in time: the clock within a day, the date beyond */
function timeLabel(ts: number, span: number, locale?: string): string {
    const date = new Date(ts);
    if (span <= 36 * 3600000) {
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

export function HistoryChart(props: HistoryChartProps): React.JSX.Element {
    const { points, start, end, color, theme, unit, width = 640, height = 280 } = props;
    const pad = { left: 64, right: 12, top: 12, bottom: 28 };
    const plot = { x: pad.left, y: pad.top, w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };

    const stats = historyStats(points);
    let low = stats?.min ?? 0;
    let high = stats?.max ?? 1;
    // Zero stays in view when the values come near it -- the same rule as the small chart in a node
    if (low >= 0 && low <= high * 0.25) {
        low = 0;
    } else if (high <= 0 && high >= low * 0.25) {
        high = 0;
    }
    if (high === low) {
        high = low + 1;
    }
    const x = (ts: number): number => plot.x + ((ts - start) / Math.max(end - start, 1)) * plot.w;
    const y = (val: number): number => plot.y + plot.h - ((val - low) / (high - low)) * plot.h;
    const label = (val: number): string => formatValue(val, { unit, locale: theme.locale }).text;

    const line = points
        .map((point, i) => `${i ? 'L' : 'M'}${x(point.ts).toFixed(1)} ${y(point.val).toFixed(1)}`)
        .join(' ');
    const base = y(Math.min(Math.max(0, low), high)).toFixed(1);
    const area =
        points.length > 1
            ? `${line} L${x(points[points.length - 1].ts).toFixed(1)} ${base} L${x(points[0].ts).toFixed(1)} ${base} Z`
            : '';

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => low + (high - low) * fraction);
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => start + (end - start) * fraction);

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            role="img"
        >
            {yTicks.map(tick => (
                <g key={`y${tick}`}>
                    <line
                        x1={plot.x}
                        x2={plot.x + plot.w}
                        y1={y(tick)}
                        y2={y(tick)}
                        stroke={theme.border}
                        strokeWidth={1}
                    />
                    <text
                        x={plot.x - 6}
                        y={y(tick)}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fontSize={11}
                        fill={theme.textSecondary}
                    >
                        {label(tick)}
                    </text>
                </g>
            ))}
            {xTicks.map((tick, i) => (
                <text
                    key={`x${tick}`}
                    x={x(tick)}
                    y={height - 8}
                    textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                    fontSize={11}
                    fill={theme.textSecondary}
                >
                    {timeLabel(tick, end - start, theme.locale)}
                </text>
            ))}
            {area ? (
                <path
                    d={area}
                    fill={withAlpha(color, 0.18)}
                />
            ) : null}
            {points.length > 1 ? (
                <path
                    d={line}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                />
            ) : null}
            {stats ? (
                <line
                    x1={plot.x}
                    x2={plot.x + plot.w}
                    y1={y(stats.avg)}
                    y2={y(stats.avg)}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="5 4"
                    opacity={0.8}
                />
            ) : null}
        </svg>
    );
}

/**
 * The statistics of a series, written the way the node writes its value.
 *
 * @param points the series
 * @param unit its unit
 * @param locale for the numbers
 * @returns min, max and average as text, or null without data
 */
export function historyStatsText(
    points: HistoryPoint[],
    unit: string | undefined,
    locale?: string,
): { min: string; max: string; avg: string } | null {
    const stats = historyStats(points);
    if (!stats) {
        return null;
    }
    const write = (val: number): string =>
        unit ? formatValue(val, { unit, locale }).text : formatNumber(val, Math.abs(val) >= 100 ? 0 : 2, locale);
    return { min: write(stats.min), max: write(stats.max), avg: write(stats.avg) };
}

export default HistoryChart;
