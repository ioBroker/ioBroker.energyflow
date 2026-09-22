/**
 * The detail view of a node: its value over a chosen period, with minimum, average and maximum.
 *
 * Opened by the click action "chart" in the vis-2 widget and the device card. It imports nothing but
 * MUI and the core, so the widget bundles can take it by path without pulling in the designer and
 * `@iobroker/gui-components` with it.
 */
import React from 'react';
import {
    Box,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    SvgIcon,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';

import { HistoryChart, historyStatsText, type EnergyFlowTheme, type HistoryPoint } from '@energyflow/core';

/**
 * The close cross, drawn here: `@mui/icons-material` is not among the modules vis-2 shares, and one
 * icon from it drags about 70 kB of MUI internals into the widget's first chunk
 */
function CloseIcon(): React.JSX.Element {
    return (
        <SvgIcon>
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </SvgIcon>
    );
}

/** The periods on offer, in ms */
const PERIODS: [string, number][] = [
    ['1h', 3600000],
    ['6h', 6 * 3600000],
    ['24h', 24 * 3600000],
    ['7d', 7 * 24 * 3600000],
    ['30d', 30 * 24 * 3600000],
];

/** Points per chart: enough for a dialog's width, few enough for a month of a busy state */
const POINTS = 300;

export interface HistoryDialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    color: string;
    theme: EnergyFlowTheme;
    unit?: string;
    /** Reads the recorded values of a stretch of time, averaged into steps of `step` ms */
    load: (start: number, end: number, step: number) => Promise<HistoryPoint[]>;
    /** Translates a key of this widget set */
    t: (key: string, ...args: (string | number)[]) => string;
}

function HistoryDialogBody(props: HistoryDialogProps): React.JSX.Element {
    const { title, color, theme, unit, load, t, onClose } = props;
    const [period, setPeriod] = React.useState(PERIODS[2][1]);
    const [data, setData] = React.useState<{
        period: number;
        start: number;
        end: number;
        points: HistoryPoint[];
    } | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    // The host hands in a new function on every render -- a widget re-renders with every reading. Only
    // opening and choosing a period read the history; the latest function is kept here for that
    const loadRef = React.useRef(load);
    React.useEffect(() => {
        loadRef.current = load;
    });

    React.useEffect(() => {
        let cancelled = false;
        const end = Date.now();
        const start = end - period;
        loadRef
            .current(start, end, Math.max(Math.round(period / POINTS), 1000))
            .then(points => !cancelled && setData({ period, start, end, points }))
            .catch((caught: unknown) => !cancelled && setError(String(caught)));
        return () => {
            cancelled = true;
        };
    }, [period]);

    const current = data && data.period === period ? data : null;
    const stats = current ? historyStatsText(current.points, unit, theme.locale) : null;

    return (
        <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>{title}</Box>
                <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={period}
                    onChange={(_event, value: number | null) => value && setPeriod(value)}
                >
                    {PERIODS.map(([name, length]) => (
                        <ToggleButton
                            key={name}
                            value={length}
                        >
                            {name}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
                <IconButton onClick={onClose}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent>
                {error ? (
                    <Typography color="error">{error}</Typography>
                ) : !current ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress size={28} />
                    </Box>
                ) : current.points.length < 2 ? (
                    <Typography
                        color="text.secondary"
                        sx={{ py: 6, textAlign: 'center' }}
                    >
                        {t('history_no_data')}
                    </Typography>
                ) : (
                    <>
                        <HistoryChart
                            points={current.points}
                            start={current.start}
                            end={current.end}
                            color={color}
                            theme={theme}
                            unit={unit}
                        />
                        {stats ? (
                            <Stack
                                direction="row"
                                spacing={3}
                                sx={{ justifyContent: 'center', mt: 1 }}
                            >
                                <Typography variant="body2">
                                    {t('history_min')}: <b>{stats.min}</b>
                                </Typography>
                                <Typography variant="body2">
                                    {t('history_avg')}: <b>{stats.avg}</b>
                                </Typography>
                                <Typography variant="body2">
                                    {t('history_max')}: <b>{stats.max}</b>
                                </Typography>
                            </Stack>
                        ) : null}
                    </>
                )}
            </DialogContent>
        </>
    );
}

export function HistoryDialog(props: HistoryDialogProps): React.JSX.Element {
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            fullWidth
            maxWidth="md"
        >
            {/* Mounted only while open, so every opening starts on the default period and reads anew */}
            {props.open ? <HistoryDialogBody {...props} /> : null}
        </Dialog>
    );
}

export default HistoryDialog;
