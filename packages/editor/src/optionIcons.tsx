/**
 * The icons of the designer's choices, in one place, so the same thing carries the same symbol in
 * every list. These are the abstract ones -- a kind, a route, a shape -- as the inspector and the
 * assistant show them; the palette instead draws the icon the node will really get, which depends on
 * the medium (a source of water is a well, not a sun).
 *
 * The routing and shape icons are drawn here -- no icon set has "a line with one Bézier bend".
 */
import React from 'react';
import { SvgIcon, type SvgIconProps } from '@mui/material';
import {
    Add,
    ArrowRightAlt,
    BatteryFull,
    Block,
    Bolt,
    CallSplit,
    ChangeCircle,
    CircleOutlined,
    CropSquare,
    East,
    Edit,
    Event,
    History,
    Home,
    HorizontalRule,
    Image,
    Link,
    LocalFireDepartment,
    North,
    Numbers,
    OpenWith,
    Schedule,
    ShowChart,
    South,
    SyncAlt,
    TextFields,
    Thermostat,
    ToggleOn,
    Update,
    WaterDrop,
    WbSunny,
    Web,
    West,
} from '@mui/icons-material';

import type { EdgeCurve, EdgeMode, MediumId, NodeKind, NodeShape, Side, TimestampFormat } from '@flow/core';

function StrokeIcon(props: SvgIconProps & { children: React.ReactNode }): React.JSX.Element {
    const { children, ...rest } = props;
    return (
        <SvgIcon {...rest}>
            <g
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                {children}
            </g>
        </SvgIcon>
    );
}

export const KIND_ICONS: Record<NodeKind, React.ReactElement> = {
    source: <WbSunny />,
    sink: <Home />,
    storage: <BatteryFull />,
    grid: <Bolt />,
    bus: <Add />,
    label: <TextFields />,
    image: <Image />,
};

/** What flows: the lightning, the drop, the flame and the thermometer, wherever the medium is shown */
export const MEDIUM_ICONS: Record<MediumId, React.ReactElement> = {
    energy: <Bolt />,
    water: <WaterDrop />,
    gas: <LocalFireDepartment />,
    heat: <Thermostat />,
};

export const SHAPE_ICONS: Record<NodeShape, React.ReactElement> = {
    circle: <CircleOutlined />,
    rounded: (
        <StrokeIcon>
            <rect
                x={3}
                y={6}
                width={18}
                height={12}
                rx={4}
            />
        </StrokeIcon>
    ),
    square: <CropSquare />,
    none: <Numbers />,
};

export const CURVE_ICONS: Record<EdgeCurve, React.ReactElement> = {
    bezier: (
        <StrokeIcon>
            <path d="M3 18C11 18 13 6 21 6" />
        </StrokeIcon>
    ),
    orthogonal: (
        <StrokeIcon>
            <path d="M3 18H12V6H21" />
        </StrokeIcon>
    ),
    straight: (
        <StrokeIcon>
            <path d="M3 18L21 6" />
        </StrokeIcon>
    ),
};

export const SIDE_ICONS: Record<Side, React.ReactElement> = {
    auto: <OpenWith />,
    top: <North />,
    right: <East />,
    bottom: <South />,
    left: <West />,
};

export const MODE_ICONS: Record<EdgeMode, React.ReactElement> = {
    signed: <SyncAlt />,
    positive: <ArrowRightAlt />,
    split: <CallSplit />,
};

export const TIMESTAMP_ICONS: Record<'none' | 'lc' | 'ts', React.ReactElement> = {
    none: <HorizontalRule />,
    lc: <ChangeCircle />,
    ts: <Update />,
};

export const TIMESTAMP_FORMAT_ICONS: Record<TimestampFormat, React.ReactElement> = {
    relative: <History />,
    time: <Schedule />,
    datetime: <Event />,
};

export const ACTION_ICONS: Record<'none' | 'toggle' | 'setValue' | 'url' | 'view' | 'chart', React.ReactElement> = {
    none: <Block />,
    toggle: <ToggleOn />,
    setValue: <Edit />,
    url: <Link />,
    view: <Web />,
    chart: <ShowChart />,
};
