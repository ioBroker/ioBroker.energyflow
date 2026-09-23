/**
 * The built-in icon set.
 *
 * Hand-drawn in a 24x24 box rather than pulled from `@mui/icons-material`, for two reasons. The
 * diagram is one SVG document -- an icon has to be *inside* it to scale with the `viewBox`, and a
 * MUI icon is a React component that renders its own `<svg>` wrapper. And a widget set that imports
 * icons by name from MUI drags a share of that package into a bundle the browser downloads before
 * the first diagram appears.
 *
 * A node may instead name a URL or a data URI; the renderer detects that and emits an `<image>`.
 */
import React from 'react';

export type IconMode = 'stroke' | 'fill';

export interface IconDefinition {
    /** Shapes in a 0 0 24 24 coordinate system */
    body: React.ReactElement;
    /** Whether the shapes are outlined or solid */
    mode: IconMode;
    /** Grouping in the editor's icon picker */
    category: 'production' | 'storage' | 'grid' | 'consumption' | 'misc';
    /** i18n key of the label shown in the picker */
    label: string;
    /**
     * For an icon that can show a level (the battery): the empty outline, and the box inside it that
     * fills from the bottom. Used instead of `body` when a level is known.
     */
    level?: { outline: React.ReactElement; x: number; y: number; w: number; h: number };
}

/** Eight rays around the sun, computed so the angles are exact */
const sunRays = (): React.ReactElement[] =>
    Array.from({ length: 8 }, (_unused, i) => {
        const angle = (i * Math.PI) / 4;
        const round = (value: number): number => Math.round(value * 100) / 100;
        return (
            <line
                key={i}
                x1={round(12 + Math.cos(angle) * 6.4)}
                y1={round(12 + Math.sin(angle) * 6.4)}
                x2={round(12 + Math.cos(angle) * 9.4)}
                y2={round(12 + Math.sin(angle) * 9.4)}
            />
        );
    });

export const BUILTIN_ICONS: Record<string, IconDefinition> = {
    sun: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_sun',
        body: (
            <>
                <circle
                    cx="12"
                    cy="12"
                    r="4.2"
                />
                {sunRays()}
            </>
        ),
    },
    solar: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_solar',
        body: (
            <>
                <path d="M3.5 14.5 L6.5 5.5 H17.5 L20.5 14.5 Z" />
                <path d="M4.7 11 H19.3" />
                <path d="M10.6 5.5 L9.4 14.5" />
                <path d="M13.4 5.5 L14.6 14.5" />
                <path d="M12 14.5 V19.5" />
                <path d="M8 19.5 H16" />
            </>
        ),
    },
    wind: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_wind',
        body: (
            <>
                <path d="M12 21 V13" />
                <path d="M9.5 21 H14.5" />
                <path d="M12 11.5 V4" />
                <path d="M13.3 12.7 L19.5 16.2" />
                <path d="M10.7 12.7 L4.5 16.2" />
                <circle
                    cx="12"
                    cy="12"
                    r="1.4"
                />
            </>
        ),
    },
    rain: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_rain',
        body: (
            <>
                <path d="M6.8 13.5 Q3.5 13.5 3.5 10.4 Q3.5 7.6 6.4 7.3 Q7.3 3.5 11.2 3.5 Q15 3.5 15.8 7 Q20.5 7 20.5 10.4 Q20.5 13.5 17.4 13.5 Z" />
                <path d="M8 16.5 L7 19.5" />
                <path d="M12 16.5 L11 19.5" />
                <path d="M16 16.5 L15 19.5" />
            </>
        ),
    },
    well: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_well',
        body: (
            <>
                <path d="M3.5 9.5 L12 4 L20.5 9.5" />
                <path d="M7.5 9.5 V13" />
                <path d="M16.5 9.5 V13" />
                <path d="M5.5 20.5 V13 H18.5 V20.5 Z" />
                <path d="M12 9.5 V13" />
            </>
        ),
    },
    hydro: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_hydro',
        body: (
            <>
                <circle
                    cx="12"
                    cy="10.5"
                    r="6"
                />
                <path d="M12 4.5 V16.5" />
                <path d="M6 10.5 H18" />
                <path d="M7.8 6.3 L16.2 14.7" />
                <path d="M16.2 6.3 L7.8 14.7" />
                <path d="M2.5 20 q2.4 -1.9 4.8 0 t4.8 0 t4.8 0 t4.8 0" />
            </>
        ),
    },
    generator: {
        mode: 'stroke',
        category: 'production',
        label: 'icon_generator',
        body: (
            <>
                <circle
                    cx="12"
                    cy="12"
                    r="8.5"
                />
                <path d="M13 6.5 L8.5 13 H11.5 L10.8 17.5 L15.5 11 H12.4 Z" />
            </>
        ),
    },
    battery: {
        mode: 'stroke',
        category: 'storage',
        label: 'icon_battery',
        body: (
            <>
                <rect
                    x="7"
                    y="5.5"
                    width="10"
                    height="15.5"
                    rx="2"
                />
                <rect
                    x="10"
                    y="2.5"
                    width="4"
                    height="3"
                    rx="1"
                />
                <path d="M9.5 16.5 H14.5" />
            </>
        ),
        // With a charge level the fixed bar goes: it reads as "almost empty" at 98 %
        level: {
            outline: (
                <>
                    <rect
                        x="7"
                        y="5.5"
                        width="10"
                        height="15.5"
                        rx="2"
                    />
                    <rect
                        x="10"
                        y="2.5"
                        width="4"
                        height="3"
                        rx="1"
                    />
                </>
            ),
            x: 8.9,
            y: 7.4,
            w: 6.2,
            h: 11.7,
        },
    },
    cistern: {
        mode: 'stroke',
        category: 'storage',
        label: 'icon_cistern',
        body: (
            <>
                <rect
                    x="4.5"
                    y="6.5"
                    width="15"
                    height="14"
                    rx="3"
                />
                <path d="M6.8 14.5 q2.3 -1.9 4.6 0 t4.6 0" />
                <path d="M12 6.5 V3" />
                <path d="M9.5 3 H14.5" />
            </>
        ),
    },
    heatstorage: {
        mode: 'stroke',
        category: 'storage',
        label: 'icon_heatstorage',
        body: (
            <>
                <rect
                    x="6"
                    y="3"
                    width="12"
                    height="18"
                    rx="4"
                />
                <path d="M9.6 8.4 q1.6 2 0 4 q-1.6 2 0 4" />
                <path d="M14.4 8.4 q1.6 2 0 4 q-1.6 2 0 4" />
            </>
        ),
    },
    grid: {
        mode: 'stroke',
        category: 'grid',
        label: 'icon_grid',
        body: (
            <>
                <path d="M5 21 L12 3 L19 21" />
                <path d="M12 3 V21" />
                <path d="M7.6 15 H16.4" />
                <path d="M9.3 10.5 H14.7" />
            </>
        ),
    },
    watermeter: {
        mode: 'stroke',
        category: 'grid',
        label: 'icon_watermeter',
        body: (
            <>
                <circle
                    cx="12"
                    cy="12"
                    r="5.6"
                />
                <path d="M12 8.6 c1.8 2.2 1.8 3.4 0 4.8 c-1.8 -1.4 -1.8 -2.6 0 -4.8 Z" />
                <path d="M2.5 12 H6.4" />
                <path d="M17.6 12 H21.5" />
                <path d="M2.5 10 V14" />
                <path d="M21.5 10 V14" />
            </>
        ),
    },
    meter: {
        mode: 'stroke',
        category: 'grid',
        label: 'icon_meter',
        body: (
            <>
                <circle
                    cx="12"
                    cy="12"
                    r="8.5"
                />
                <path d="M12 12 L16 8.5" />
                <path d="M12 3.5 V5.5" />
                <path d="M5.2 8.7 L7 9.7" />
                <path d="M18.8 8.7 L17 9.7" />
            </>
        ),
    },
    plug: {
        mode: 'stroke',
        category: 'grid',
        label: 'icon_plug',
        body: (
            <>
                <path d="M9 2.5 V7" />
                <path d="M15 2.5 V7" />
                <path d="M6 7 H18 V11.5 A6 6 0 0 1 6 11.5 Z" />
                <path d="M12 17.5 V21.5" />
            </>
        ),
    },
    house: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_house',
        body: (
            <>
                <path d="M3.8 11.3 L12 4.2 L20.2 11.3 V20 H3.8 Z" />
                <path d="M9.6 20 V14.4 H14.4 V20" />
            </>
        ),
    },
    car: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_car',
        body: (
            <>
                <path d="M3.5 16 V12.5 L5.6 8 H18.4 L20.5 12.5 V16 H3.5 Z" />
                <circle
                    cx="7.5"
                    cy="17.6"
                    r="1.7"
                />
                <circle
                    cx="16.5"
                    cy="17.6"
                    r="1.7"
                />
                <path d="M5.2 12.5 H18.8" />
            </>
        ),
    },
    wallbox: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_wallbox',
        body: (
            <>
                <rect
                    x="6.5"
                    y="2.5"
                    width="11"
                    height="13"
                    rx="2"
                />
                <path d="M9.5 6.5 H14.5" />
                <path d="M9.5 10 H14.5" />
                <path d="M12 15.5 V18.5 Q12 21 14.5 21 H17.5" />
            </>
        ),
    },
    heatpump: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_heatpump',
        body: (
            <>
                <rect
                    x="3"
                    y="4"
                    width="18"
                    height="16"
                    rx="2"
                />
                <circle
                    cx="12"
                    cy="12"
                    r="3.4"
                />
                <path d="M12 8.6 V5.6" />
                <path d="M12 15.4 V18.4" />
                <path d="M8.6 12 H5.6" />
                <path d="M15.4 12 H18.4" />
            </>
        ),
    },
    radiator: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_radiator',
        body: (
            <>
                <rect
                    x="4"
                    y="5"
                    width="16"
                    height="14"
                    rx="1.6"
                />
                <path d="M8 5 V19" />
                <path d="M12 5 V19" />
                <path d="M16 5 V19" />
            </>
        ),
    },
    water: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_water',
        body: <path d="M12 3 C12 3 5.5 10.8 5.5 14.8 A6.5 6.5 0 0 0 18.5 14.8 C18.5 10.8 12 3 12 3 Z" />,
    },
    light: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_light',
        body: (
            <>
                <path d="M12 2.8 A6.2 6.2 0 0 1 15.2 14.3 V16.2 H8.8 V14.3 A6.2 6.2 0 0 1 12 2.8 Z" />
                <path d="M9.4 18.8 H14.6" />
                <path d="M10.4 21.3 H13.6" />
            </>
        ),
    },
    pool: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_pool',
        body: (
            <>
                <path d="M3 8.5 Q6 6.5 9 8.5 T15 8.5 T21 8.5" />
                <path d="M3 13.5 Q6 11.5 9 13.5 T15 13.5 T21 13.5" />
                <path d="M3 18.5 Q6 16.5 9 18.5 T15 18.5 T21 18.5" />
            </>
        ),
    },
    stove: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_stove',
        body: (
            <>
                <rect
                    x="3.5"
                    y="3.5"
                    width="17"
                    height="17"
                    rx="2.5"
                />
                <circle
                    cx="8.6"
                    cy="8.6"
                    r="2.2"
                />
                <circle
                    cx="15.4"
                    cy="8.6"
                    r="2.2"
                />
                <circle
                    cx="8.6"
                    cy="15.4"
                    r="2.2"
                />
                <circle
                    cx="15.4"
                    cy="15.4"
                    r="2.2"
                />
            </>
        ),
    },
    inverter: {
        mode: 'stroke',
        category: 'misc',
        label: 'icon_inverter',
        body: (
            <>
                <rect
                    x="3"
                    y="5"
                    width="18"
                    height="14"
                    rx="2"
                />
                <path d="M12 5 V19" />
                <path d="M5.4 15 C6.6 15 6.6 9 7.8 9 C9 9 9 15 10.2 15" />
                <path d="M13.8 9 H18.6" />
                <path d="M13.8 15 H18.6" />
                <path d="M15 12 H17.4" />
            </>
        ),
    },
    fridge: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_fridge',
        body: (
            <>
                <rect
                    x="6"
                    y="2.5"
                    width="12"
                    height="19"
                    rx="2"
                />
                <path d="M6 9.5 H18" />
                <path d="M9 5.5 V7.5" />
                <path d="M9 12 V14.5" />
            </>
        ),
    },
    washer: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_washer',
        body: (
            <>
                <rect
                    x="4"
                    y="3"
                    width="16"
                    height="18"
                    rx="2"
                />
                <circle
                    cx="12"
                    cy="13.5"
                    r="4.4"
                />
                <path d="M7 6.5 H9.5" />
            </>
        ),
    },
    valve: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_valve',
        body: (
            <>
                <path d="M4.5 10.5 L12 15 L4.5 19.5 Z" />
                <path d="M19.5 10.5 L12 15 L19.5 19.5 Z" />
                <path d="M12 15 V8" />
                <path d="M8.5 6.5 H15.5" />
            </>
        ),
    },
    sprinkler: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_sprinkler',
        body: (
            <>
                <path d="M12 20.5 V13" />
                <path d="M8.5 20.5 H15.5" />
                <circle
                    cx="12"
                    cy="11.4"
                    r="1.5"
                />
                <path d="M5.5 13 Q5.8 5.5 10.6 4.2" />
                <path d="M18.5 13 Q18.2 5.5 13.4 4.2" />
            </>
        ),
    },
    filter: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_filter',
        body: (
            <>
                <path d="M3.5 5 H20.5 L14 12.5 V19 L10 21 V12.5 Z" />
                <path d="M8 8.5 H16" />
            </>
        ),
    },
    shower: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_shower',
        body: (
            <>
                <path d="M12 3 V6.2" />
                <path d="M6.5 10 Q6.5 6.2 12 6.2 Q17.5 6.2 17.5 10 Z" />
                <path d="M8.5 13 V14.6" />
                <path d="M12 13 V15.6" />
                <path d="M15.5 13 V14.6" />
                <path d="M10 17.6 V19.2" />
                <path d="M14 17.6 V19.2" />
            </>
        ),
    },
    tap: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_tap',
        body: (
            <>
                <path d="M5 20.5 V8 H14.5 V11.5" />
                <path d="M3 6 H7" />
                <path d="M5 6 V8" />
                <path d="M14.5 14 c1.5 1.8 1.5 2.7 0 3.9 c-1.5 -1.2 -1.5 -2.1 0 -3.9 Z" />
            </>
        ),
    },
    consumers: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_consumers',
        body: (
            <>
                <path d="M3.8 11.3 L12 4.2 L20.2 11.3 V20 H3.8 Z" />
                <circle
                    cx="12"
                    cy="15.4"
                    r="3.2"
                />
                <path d="M10.7 14.6 h0.01" />
                <path d="M13.3 14.6 h0.01" />
            </>
        ),
    },
    microwave: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_microwave',
        body: (
            <>
                <rect
                    x="2.5"
                    y="6"
                    width="19"
                    height="12"
                    rx="2"
                />
                <rect
                    x="5"
                    y="8.5"
                    width="9.5"
                    height="7"
                    rx="1"
                />
                <circle
                    cx="18.2"
                    cy="10.4"
                    r="1.1"
                />
                <path d="M16.6 14 H19.8" />
            </>
        ),
    },
    oven: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_oven',
        body: (
            <>
                <rect
                    x="3.5"
                    y="3.5"
                    width="17"
                    height="17"
                    rx="2"
                />
                <path d="M3.5 8.2 H20.5" />
                <circle
                    cx="7"
                    cy="5.8"
                    r="0.9"
                />
                <circle
                    cx="10.2"
                    cy="5.8"
                    r="0.9"
                />
                <path d="M6.2 10 H17.8" />
                <rect
                    x="6.2"
                    y="12"
                    width="11.6"
                    height="6.2"
                    rx="1"
                />
            </>
        ),
    },
    dishwasher: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_dishwasher',
        body: (
            <>
                <rect
                    x="4"
                    y="3"
                    width="16"
                    height="18"
                    rx="2"
                />
                <path d="M4 7.5 H20" />
                <circle
                    cx="7"
                    cy="5.2"
                    r="0.9"
                />
                <path d="M12 8.8 c1.3 1.6 1.3 2.5 0 3.5 c-1.3 -1 -1.3 -1.9 0 -3.5 Z" />
                <circle
                    cx="12"
                    cy="16.6"
                    r="3.4"
                />
            </>
        ),
    },
    dryer: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_dryer',
        body: (
            <>
                <rect
                    x="4"
                    y="3"
                    width="16"
                    height="18"
                    rx="2"
                />
                <path d="M7 6.5 H9.5" />
                <circle
                    cx="12"
                    cy="14"
                    r="4.6"
                />
                <path d="M10.6 12.2 q1.5 1.8 0 3.6" />
                <path d="M13.4 12.2 q1.5 1.8 0 3.6" />
            </>
        ),
    },
    coffee: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_coffee',
        body: (
            <>
                <path d="M5.5 9.5 H17 V14 Q17 17.5 13.5 17.5 H9 Q5.5 17.5 5.5 14 Z" />
                <path d="M17 11 H19 Q21 11 21 13 Q21 15 19 15 H17" />
                <path d="M7 20.5 H16" />
                <path d="M9.5 7 q1.3 -1.5 0 -3" />
                <path d="M13 7 q1.3 -1.5 0 -3" />
            </>
        ),
    },
    freezer: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_freezer',
        body: (
            <>
                <rect
                    x="6"
                    y="2.5"
                    width="12"
                    height="19"
                    rx="2"
                />
                <path d="M6 9.5 H18" />
                <path d="M9 5.5 V7.5" />
                <path d="M12 11.8 V18.4" />
                <path d="M9.2 13.4 L14.8 16.8" />
                <path d="M14.8 13.4 L9.2 16.8" />
            </>
        ),
    },
    tv: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_tv',
        body: (
            <>
                <rect
                    x="2.5"
                    y="4.5"
                    width="19"
                    height="12.5"
                    rx="2"
                />
                <path d="M12 17 V20.5" />
                <path d="M8 20.5 H16" />
            </>
        ),
    },
    ac: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_ac',
        body: (
            <>
                <rect
                    x="2.5"
                    y="4.5"
                    width="19"
                    height="8"
                    rx="2"
                />
                <path d="M5.2 10 H18.8" />
                <path d="M6.5 16 q1.7 -1.7 3.4 0 t3.4 0" />
                <path d="M8.5 19.6 q1.7 -1.7 3.4 0 t3.4 0" />
            </>
        ),
    },
    ventilation: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_ventilation',
        body: (
            <>
                <rect
                    x="2.5"
                    y="6"
                    width="19"
                    height="12"
                    rx="2"
                />
                <path d="M5.5 9.6 H14.5" />
                <path d="M12.6 7.9 L14.5 9.6 L12.6 11.3" />
                <path d="M18.5 14.4 H9.5" />
                <path d="M11.4 12.7 L9.5 14.4 L11.4 16.1" />
            </>
        ),
    },
    fan: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_fan',
        body: (
            <>
                <circle
                    cx="12"
                    cy="12"
                    r="1.8"
                />
                <path d="M12 10.2 C12 6.4 10.1 3.8 7.6 4.3 C5.3 4.8 5.1 7.7 7 9.3 C8.4 10.5 10.2 10.2 12 10.2 Z" />
                <path
                    d="M12 10.2 C12 6.4 10.1 3.8 7.6 4.3 C5.3 4.8 5.1 7.7 7 9.3 C8.4 10.5 10.2 10.2 12 10.2 Z"
                    transform="rotate(120 12 12)"
                />
                <path
                    d="M12 10.2 C12 6.4 10.1 3.8 7.6 4.3 C5.3 4.8 5.1 7.7 7 9.3 C8.4 10.5 10.2 10.2 12 10.2 Z"
                    transform="rotate(240 12 12)"
                />
            </>
        ),
    },
    heater: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_heater',
        body: (
            <>
                <rect
                    x="3.5"
                    y="7"
                    width="17"
                    height="10"
                    rx="2.5"
                />
                <path d="M7.6 10 q1.5 2 0 4" />
                <path d="M12 10 q1.5 2 0 4" />
                <path d="M16.4 10 q1.5 2 0 4" />
            </>
        ),
    },
    waterpump: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_waterpump',
        body: (
            <>
                <circle
                    cx="11"
                    cy="13.5"
                    r="5.4"
                />
                <circle
                    cx="11"
                    cy="13.5"
                    r="1.6"
                />
                <path d="M11 8.1 V4.5" />
                <path d="M8.4 4.5 H13.6" />
                <path d="M16.4 13.5 H20.5" />
                <path d="M20.5 11.6 V15.4" />
            </>
        ),
    },
    boiler: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_boiler',
        body: (
            <>
                <rect
                    x="6.5"
                    y="3"
                    width="11"
                    height="18"
                    rx="4"
                />
                <path d="M12 9.5 c2.3 2.6 2.3 4 0 5.8 c-2.3 -1.8 -2.3 -3.2 0 -5.8 Z" />
                <path d="M17.5 7.5 H20.5" />
                <path d="M3.5 16.5 H6.5" />
            </>
        ),
    },
    server: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_server',
        body: (
            <>
                <rect
                    x="3"
                    y="4"
                    width="18"
                    height="6"
                    rx="1.6"
                />
                <rect
                    x="3"
                    y="14"
                    width="18"
                    height="6"
                    rx="1.6"
                />
                <path d="M6.5 7 H7.5" />
                <path d="M6.5 17 H7.5" />
            </>
        ),
    },
    flame: {
        mode: 'stroke',
        category: 'consumption',
        label: 'icon_flame',
        body: (
            <path d="M12 2.5 C12 2.5 6.8 8.4 6.8 13.4 A5.2 5.2 0 0 0 17.2 13.4 C17.2 9.6 14.2 7.2 14.2 7.2 C14.2 10.4 12.8 11.6 12.8 11.6 C13.8 7.4 12 2.5 12 2.5 Z" />
        ),
    },
    bolt: {
        mode: 'fill',
        category: 'misc',
        label: 'icon_bolt',
        body: <path d="M13.4 2 L5.8 13.2 H10.9 L10.2 22 L18.2 10.4 H12.7 Z" />,
    },
};

/** Groups of the picker, in the order it shows them */
export const ICON_CATEGORIES: { id: IconDefinition['category']; label: string }[] = [
    { id: 'production', label: 'icon_cat_production' },
    { id: 'storage', label: 'icon_cat_storage' },
    { id: 'grid', label: 'icon_cat_grid' },
    { id: 'consumption', label: 'icon_cat_consumption' },
    { id: 'misc', label: 'icon_cat_misc' },
];

/** Whether the value names one of the built-in icons rather than an image */
export function isBuiltinIcon(icon: string | undefined): boolean {
    return !!icon && Object.prototype.hasOwnProperty.call(BUILTIN_ICONS, icon);
}

export interface IconRenderOptions {
    /** Centre of the icon in canvas units */
    x: number;
    y: number;
    /** Edge length of the square the icon is drawn into, in canvas units */
    size: number;
    color: string;
    /** A level in percent, for an icon that can show one -- the battery's state of charge */
    level?: number | null;
}

/**
 * Render an icon into the diagram, in canvas coordinates.
 *
 * Returns null for an unknown name, which the caller uses to fall back to an `<image>` or to nothing
 * at all -- an icon that was removed from the set must not take the diagram with it.
 *
 * @param name the icon name
 * @param options where and how large to draw it
 * @returns an SVG group, or null
 */
export function renderBuiltinIcon(name: string | undefined, options: IconRenderOptions): React.ReactElement | null {
    if (!name) {
        return null;
    }
    const definition = BUILTIN_ICONS[name];
    if (!definition) {
        return null;
    }

    const scale = options.size / 24;
    const transform = `translate(${options.x - options.size / 2} ${options.y - options.size / 2}) scale(${scale})`;
    const stroked = definition.mode === 'stroke';
    const box = definition.level;
    const level =
        box && typeof options.level === 'number' && Number.isFinite(options.level)
            ? Math.min(Math.max(options.level, 0), 100)
            : null;

    return (
        <g
            transform={transform}
            fill={stroked ? 'none' : options.color}
            stroke={stroked ? options.color : 'none'}
            // The stroke width is in the icon's own 24-unit space, so it scales with the icon and
            // stays visually constant whatever size the node is
            strokeWidth={stroked ? 1.7 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {box && level !== null ? (
                <>
                    {box.outline}
                    {level > 0 ? (
                        <rect
                            x={box.x}
                            y={box.y + box.h * (1 - level / 100)}
                            width={box.w}
                            height={box.h * (level / 100)}
                            rx={0.8}
                            fill={options.color}
                            stroke="none"
                        />
                    ) : null}
                </>
            ) : (
                definition.body
            )}
        </g>
    );
}
