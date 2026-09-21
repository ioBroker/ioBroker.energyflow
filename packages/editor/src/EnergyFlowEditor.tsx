/**
 * The designer.
 *
 * A full-screen dialog the host opens; it edits a copy and only reports back on OK, so cancelling
 * really cancels -- see the note on the `open` prop for how that works. Nothing in here knows which
 * application it is running in -- see {@link EditorContext}.
 *
 * Undo works because every edit in `@energyflow/core` returns a new document: the history is a list of
 * those. A drag reports its intermediate positions as `transient`, which go into a draft that is not
 * on the history, so one drag is one undo step.
 */
import React from 'react';
import {
    AppBar,
    Box,
    Button,
    Dialog,
    Divider,
    IconButton,
    Stack,
    Tooltip,
    Toolbar,
    Typography,
    useTheme,
} from '@mui/material';
import {
    Add,
    BatteryFull,
    Bolt,
    Check,
    Close,
    Code,
    CropFree,
    Dashboard,
    Grid4x4,
    Home,
    PlayArrow,
    Pause,
    Redo,
    TextFields,
    Undo,
    WbSunny,
} from '@mui/icons-material';

import {
    collectOids,
    computeRuntime,
    createNode,
    fitCanvas,
    normalizeConfig,
    themeFromMui,
    type EnergyFlowConfig,
    type NodeKind,
} from '@energyflow/core';

import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { PresetDialog } from './PresetDialog';
import { JsonDialog } from './JsonDialog';
import { useLiveValues } from './useLiveValues';
import type { EditorContext, EditorSelection } from './types';

export interface EnergyFlowEditorProps {
    /**
     * Whether the dialog is shown.
     *
     * **Mount this component only while the designer is open** (`{open ? <EnergyFlowEditor .../> : null}`).
     * Every bit of editing state -- the document, the undo stack, the selection -- is initialised on
     * mount from `value`, so unmounting is what discards a cancelled session. Keeping it mounted with
     * `open={false}` would carry the abandoned edits into the next time it is opened.
     */
    open: boolean;
    /** The stored configuration; a string containing JSON is accepted too */
    value: unknown;
    onClose: () => void;
    /** Called on OK with the edited document */
    onSave: (config: EnergyFlowConfig) => void;
    context: EditorContext;
    /** Shown in the title bar, e.g. the widget name */
    title?: string;
}

/** How many documents the undo stack keeps */
const HISTORY_LIMIT = 60;

/** The palette on the left. `bus` is last because it is the one that needs explaining. */
const PALETTE: { kind: NodeKind; icon: React.ReactElement; label: string }[] = [
    { kind: 'source', icon: <WbSunny />, label: 'kind_source' },
    { kind: 'sink', icon: <Home />, label: 'kind_sink' },
    { kind: 'storage', icon: <BatteryFull />, label: 'kind_storage' },
    { kind: 'grid', icon: <Bolt />, label: 'kind_grid' },
    { kind: 'label', icon: <TextFields />, label: 'kind_label' },
    { kind: 'bus', icon: <Add />, label: 'kind_bus' },
];

export function EnergyFlowEditor(props: EnergyFlowEditorProps): React.JSX.Element {
    const { open, value, onClose, onSave, context, title } = props;
    const muiTheme = useTheme();

    /**
     * The undo stack and the position in it, in one piece of state on purpose: pushing an entry has to
     * move the index to the *trimmed* length, and two separate setState calls cannot see each other's
     * result, so they drift apart as soon as the stack hits its cap.
     */
    const [past, setPast] = React.useState<{ history: EnergyFlowConfig[]; index: number }>(() => ({
        history: [normalizeConfig(value)],
        index: 0,
    }));
    /** The document during a gesture; not on the history, so a drag is one undo step */
    const [draft, setDraft] = React.useState<EnergyFlowConfig | null>(null);
    const [selection, setSelection] = React.useState<EditorSelection>({ kind: 'canvas' });
    const [showGrid, setShowGrid] = React.useState(true);
    const [animate, setAnimate] = React.useState(true);
    // An empty diagram has nothing to inspect, so the useful first step is offering the templates
    const [jsonOpen, setJsonOpen] = React.useState(false);
    const [presetsOpen, setPresetsOpen] = React.useState(() => !normalizeConfig(value).nodes.length);

    const config = draft ?? past.history[past.index];

    const flowTheme = React.useMemo(
        () => themeFromMui(muiTheme, context.lang === 'en' ? 'en-US' : context.lang),
        [muiTheme, context.lang],
    );

    const oids = React.useMemo(() => collectOids(config), [config]);
    const values = useLiveValues(context.socket, oids);

    const commit = React.useCallback((next: EnergyFlowConfig, transient?: boolean): void => {
        if (transient) {
            setDraft(next);
            return;
        }
        setDraft(null);
        setPast(previous => {
            // Anything that was undone is dropped, which is what every editor does
            const trimmed = previous.history.slice(0, previous.index + 1);
            trimmed.push(next);
            // Keep the stack bounded; 60 steps is far more than a diagram of this size needs
            const capped = trimmed.length > HISTORY_LIMIT ? trimmed.slice(trimmed.length - HISTORY_LIMIT) : trimmed;
            return { history: capped, index: capped.length - 1 };
        });
    }, []);

    const canUndo = past.index > 0 || draft !== null;
    const canRedo = past.index < past.history.length - 1;

    const undo = (): void => {
        // A gesture in progress is undone by dropping the draft, which restores the position the drag
        // started from without spending a history step
        if (draft) {
            setDraft(null);
            return;
        }
        setPast(previous => (previous.index > 0 ? { ...previous, index: previous.index - 1 } : previous));
    };

    const redo = (): void => {
        setDraft(null);
        setPast(previous =>
            previous.index < previous.history.length - 1 ? { ...previous, index: previous.index + 1 } : previous,
        );
    };

    const addNode = (kind: NodeKind): void => {
        // Drop it in the middle of the free upper area rather than at 0,0 -- a new node that lands
        // under an existing one looks like nothing happened
        const at = { x: config.canvas.w / 2, y: Math.min(80 + config.nodes.length * 20, config.canvas.h - 80) };
        const node = createNode(config, kind, at, context.t(`kind_${kind}`));
        commit({ ...config, nodes: [...config.nodes, node] });
        setSelection({ kind: 'node', id: node.id });
    };

    const runtimeForTitle = React.useMemo(() => computeRuntime(config, () => null, flowTheme), [config, flowTheme]);

    return (
        <Dialog
            open={open}
            fullScreen
            onClose={onClose}
        >
            <AppBar
                position="static"
                color="default"
                enableColorOnDark
            >
                <Toolbar
                    variant="dense"
                    sx={{ gap: 0.5 }}
                >
                    <Dashboard sx={{ mr: 1 }} />
                    <Typography
                        variant="subtitle1"
                        sx={{ mr: 2 }}
                    >
                        {title || context.t('editor_title')}
                    </Typography>

                    <Tooltip title={context.t('editor_undo')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!canUndo}
                                onClick={undo}
                            >
                                <Undo />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={context.t('editor_redo')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!canRedo}
                                onClick={redo}
                            >
                                <Redo />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ mx: 1 }}
                    />

                    <Tooltip title={context.t('editor_grid')}>
                        <IconButton
                            size="small"
                            color={showGrid ? 'primary' : 'default'}
                            onClick={() => setShowGrid(!showGrid)}
                        >
                            <Grid4x4 />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={context.t('editor_fit')}>
                        <IconButton
                            size="small"
                            onClick={() => commit(fitCanvas(config))}
                        >
                            <CropFree />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={context.t(animate ? 'editor_pause' : 'editor_play')}>
                        <IconButton
                            size="small"
                            onClick={() => setAnimate(!animate)}
                        >
                            {animate ? <Pause /> : <PlayArrow />}
                        </IconButton>
                    </Tooltip>

                    <Button
                        size="small"
                        sx={{ ml: 1 }}
                        onClick={() => setPresetsOpen(true)}
                    >
                        {context.t('editor_presets')}
                    </Button>
                    <Tooltip title={context.t('json_title')}>
                        <IconButton
                            size="small"
                            onClick={() => setJsonOpen(true)}
                        >
                            <Code />
                        </IconButton>
                    </Tooltip>

                    <Box sx={{ flex: 1 }} />

                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mr: 2 }}
                    >
                        {context.t('insp_counts', runtimeForTitle.nodes.length, runtimeForTitle.edges.length)}
                    </Typography>

                    <Button
                        startIcon={<Close />}
                        onClick={onClose}
                        color="inherit"
                    >
                        {context.t('cancel')}
                    </Button>
                    <Button
                        startIcon={<Check />}
                        variant="contained"
                        onClick={() => {
                            onSave(config);
                            onClose();
                        }}
                    >
                        {context.t('apply')}
                    </Button>
                </Toolbar>
            </AppBar>

            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
                {/* Palette */}
                <Stack
                    sx={{
                        alignItems: 'center',
                        width: 70,
                        flexShrink: 0,
                        borderRight: theme => `1px solid ${theme.palette.divider}`,
                        py: 1,
                        overflowY: 'auto',
                    }}

                    spacing={0.5}
                >
                    {PALETTE.map(entry => (
                        <Tooltip
                            key={entry.kind}
                            title={context.t('editor_add', context.t(entry.label))}
                            placement="right"
                        >
                            <IconButton onClick={() => addNode(entry.kind)}>{entry.icon}</IconButton>
                        </Tooltip>
                    ))}
                </Stack>

                {/* Canvas */}
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        p: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme =>
                            theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                    }}
                >
                    <Canvas
                        config={config}
                        theme={flowTheme}
                        values={values}
                        selection={selection}
                        onSelect={setSelection}
                        onChange={commit}
                        showGrid={showGrid}
                        animate={animate}
                    />
                </Box>

                {/* Inspector */}
                <Box
                    sx={{
                        width: 350,
                        flexShrink: 0,
                        borderLeft: theme => `1px solid ${theme.palette.divider}`,
                        p: 2,
                        overflowY: 'auto',
                    }}
                >
                    <Inspector
                        config={config}
                        selection={selection}
                        onChange={commit}
                        onSelect={setSelection}
                        context={context}
                        defaultNodeColor={kind => flowTheme.kinds[kind]}
                    />
                </Box>
            </Box>

            <JsonDialog
                open={jsonOpen}
                config={config}
                onClose={() => setJsonOpen(false)}
                onApply={next => {
                    commit(next);
                    setSelection({ kind: 'canvas' });
                }}
                context={context}
            />

            <PresetDialog
                open={presetsOpen}
                onClose={() => setPresetsOpen(false)}
                onPick={picked => {
                    commit(picked);
                    setSelection({ kind: 'canvas' });
                }}
                context={context}
                theme={flowTheme}
                hasContent={config.nodes.length > 0}
            />
        </Dialog>
    );
}

export default EnergyFlowEditor;
