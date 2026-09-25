/**
 * The designer.
 *
 * A full-screen dialog the host opens; it edits a copy and only reports back on OK, so cancelling
 * really cancels -- see the note on the `open` prop for how that works. Nothing in here knows which
 * application it is running in -- see {@link EditorContext}.
 *
 * Undo works because every edit in `@flow/core` returns a new document: the history is a list of
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
    Menu,
    MenuItem,
    Snackbar,
    Stack,
    Tooltip,
    Toolbar,
    Typography,
    useTheme,
} from '@mui/material';
import {
    Autorenew,
    Check,
    Close,
    Code,
    CropFree,
    Dashboard,
    Grid4x4,
    Image as ImageIcon,
    PlayArrow,
    Pause,
    Redo,
    Undo,
    ViewSidebar,
} from '@mui/icons-material';

import {
    collectOids,
    computeRuntime,
    diagramFileName,
    slugify,
    createNode,
    fitCanvas,
    mediumOf,
    needsClock,
    paletteOf,
    SWITCH_OFF_COLOR,
    switchTextMap,
    normalizeConfig,
    themeFromMui,
    type FlowConfig,
    type PaletteEntry,
} from '@flow/core';

import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { PresetDialog } from './PresetDialog';
import { JsonDialog } from './JsonDialog';
import { useClock, useLiveStates } from './useLiveValues';
import { useObjectUnits } from './useObjectUnits';
import { useDefaultHistory, useEnergyToday, useHistory } from './useHistory';
import { ResizeHandle } from './ResizeHandle';
import { usePersistentState } from './usePersistentState';
import { useEditorShortcuts } from './useEditorShortcuts';
import { paletteLabel } from './labels';
import { kindIcon } from './kindIcon';
import { DeviceWizard } from './DeviceWizard';
import { exportPng, exportSvg } from './exportImage';
import type { EditorContext, EditorSelection } from './types';

export interface FlowEditorProps {
    /**
     * Whether the dialog is shown.
     *
     * **Mount this component only while the designer is open** (`{open ? <FlowEditor .../> : null}`).
     * Every bit of editing state -- the document, the undo stack, the selection -- is initialised on
     * mount from `value`, so unmounting is what discards a cancelled session. Keeping it mounted with
     * `open={false}` would carry the abandoned edits into the next time it is opened.
     */
    open: boolean;
    /** The stored configuration; a string containing JSON is accepted too */
    value: unknown;
    /**
     * Dialog: called on cancel and after a save, to close it.
     * Inline: called on "discard" -- the host reloads the stored diagram, typically by remounting.
     */
    onClose: () => void;
    /** Called with the edited document on OK (dialog) or on save (inline) */
    onSave: (config: FlowConfig) => void;
    context: EditorContext;
    /** Shown in the title bar, e.g. the widget name */
    title?: string;
    /**
     * `dialog` -- a full-screen dialog over whatever opened it; what a widget attribute uses.
     * `inline` -- fills its parent and stays open after saving; what the admin tab uses, where the
     * designer *is* the page rather than something opened from it.
     */
    variant?: 'dialog' | 'inline';
    /** Told whenever the document starts or stops differing from what was last saved */
    onDirtyChange?: (dirty: boolean) => void;
    /** Extra elements for the toolbar, left of the save button -- the admin tab puts its menu here */
    toolbarExtra?: React.ReactNode;
    /** Elements at the very start of the toolbar -- the admin tab puts its list toggle here */
    toolbarStart?: React.ReactNode;
}

/** Limits of the properties panel, in pixels */
const INSPECTOR_DEFAULT = 350;
const INSPECTOR_MIN = 260;
const INSPECTOR_MAX = 720;

/** How many documents the undo stack keeps */
const HISTORY_LIMIT = 60;

/** Edits with the same merge key closer together than this are one undo step: a held arrow key */
const MERGE_WINDOW_MS = 1000;

/**
 * How long the designer waits after the last change before it saves by itself.
 *
 * Long enough that dragging a node is one save and not thirty, short enough that nobody loses work
 * by closing the tab. It only applies to the admin tab: in the dialog of a widget, saving closes it,
 * and a dialog that closes itself while somebody is drawing would be a bug, not a feature.
 */
const AUTOSAVE_MS = 10000;

export function FlowEditor(props: FlowEditorProps): React.JSX.Element {
    const { open, value, onClose, onSave, context, title, onDirtyChange, toolbarExtra, toolbarStart } = props;
    const inline = props.variant === 'inline';
    const muiTheme = useTheme();

    /**
     * The undo stack and the position in it, in one piece of state on purpose: pushing an entry has to
     * move the index to the *trimmed* length, and two separate setState calls cannot see each other's
     * result, so they drift apart as soon as the stack hits its cap.
     */
    const [past, setPast] = React.useState<{ history: FlowConfig[]; index: number }>(() => ({
        history: [normalizeConfig(value)],
        index: 0,
    }));
    /** The document during a gesture; not on the history, so a drag is one undo step */
    const [draft, setDraft] = React.useState<FlowConfig | null>(null);
    const [selection, setSelection] = React.useState<EditorSelection>({ kind: 'canvas' });
    const [showGrid, setShowGrid] = React.useState(true);
    const [animate, setAnimate] = React.useState(true);
    /**
     * Width and visibility of the properties panel. Remembered per browser, and shared by the dialog in
     * vis-2 and the admin tab -- whoever likes it wide likes it wide everywhere.
     */
    const [inspector, setInspector] = usePersistentState('flow.editor.inspector', {
        width: INSPECTOR_DEFAULT,
        open: true,
    });
    // An empty diagram has nothing to inspect, so the useful first step is offering the templates
    const [jsonOpen, setJsonOpen] = React.useState(false);
    const [wizardOpen, setWizardOpen] = React.useState(false);
    const [exportAnchor, setExportAnchor] = React.useState<HTMLElement | null>(null);
    const [exportError, setExportError] = React.useState<string | null>(null);
    const [presetsOpen, setPresetsOpen] = React.useState(() => !normalizeConfig(value).nodes.length);

    const config = draft ?? past.history[past.index];

    /**
     * The document as it was last saved. Dirty is an identity comparison, and that is enough: every
     * edit produces a new object, and undoing back to the saved state returns *that* object from the
     * history -- so "changed, then changed back" correctly reads as clean.
     */
    const [baseline, setBaseline] = React.useState<FlowConfig>(() => past.history[0]);
    const dirty = config !== baseline;
    const [autosave, setAutosave] = usePersistentState('flow.editor.autosave', false);

    React.useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const flowTheme = React.useMemo(
        () => themeFromMui(muiTheme, context.lang === 'en' ? 'en-US' : context.lang),
        [muiTheme, context.lang],
    );

    /** Everything the designer draws; keyboard shortcuts apply while the focus is in here */
    const rootRef = React.useRef<HTMLDivElement | null>(null);

    const oids = React.useMemo(() => collectOids(config), [config]);
    const { values, times, raw } = useLiveStates(context.socket, oids);
    const now = useClock(needsClock(config));
    const units = useObjectUnits(context.socket, oids);
    const historyInstance = useDefaultHistory(context.socket);
    const history = useHistory(context.socket, config, historyInstance);
    const energy = useEnergyToday(context.socket, config, historyInstance);

    /** The last edit that asked to be merged, see `commit` */
    const lastMerge = React.useRef<{ key: string; at: number } | null>(null);

    /**
     * Put an edit on the undo stack.
     *
     * @param next the new document
     * @param transient a gesture is still running -- keep it in the draft, off the stack
     * @param merge edits with the same key in quick succession replace each other on the stack, so
     *   holding an arrow key for a second is one undo step and not sixty
     */
    const commit = React.useCallback((next: FlowConfig, transient?: boolean, merge?: string): void => {
        if (transient) {
            setDraft(next);
            return;
        }
        const now = Date.now();
        const merging = !!merge && lastMerge.current?.key === merge && now - lastMerge.current.at < MERGE_WINDOW_MS;
        lastMerge.current = merge ? { key: merge, at: now } : null;
        setDraft(null);
        setPast(previous => {
            if (merging && previous.index > 0) {
                const history = previous.history.slice(0, previous.index + 1);
                history[history.length - 1] = next;
                return { history, index: history.length - 1 };
            }
            // Anything that was undone is dropped, which is what every editor does
            const trimmed = previous.history.slice(0, previous.index + 1);
            trimmed.push(next);
            // Keep the stack bounded; 60 steps is far more than a diagram of this size needs
            const capped = trimmed.length > HISTORY_LIMIT ? trimmed.slice(trimmed.length - HISTORY_LIMIT) : trimmed;
            return { history: capped, index: capped.length - 1 };
        });
    }, []);

    useEditorShortcuts({
        root: rootRef,
        config,
        selection,
        commit,
        select: setSelection,
        disabled: draft !== null,
    });

    const canUndo = past.index > 0 || draft !== null;
    const canRedo = past.index < past.history.length - 1;

    const undo = (): void => {
        // After an undo the top of the stack is no longer the step a merge would extend
        lastMerge.current = null;
        // A gesture in progress is undone by dropping the draft, which restores the position the drag
        // started from without spending a history step
        if (draft) {
            setDraft(null);
            return;
        }
        setPast(previous => (previous.index > 0 ? { ...previous, index: previous.index - 1 } : previous));
    };

    const redo = (): void => {
        lastMerge.current = null;
        setDraft(null);
        setPast(previous =>
            previous.index < previous.history.length - 1 ? { ...previous, index: previous.index + 1 } : previous,
        );
    };

    const addNode = (entry: PaletteEntry): void => {
        // Drop it in the middle of the free upper area rather than at 0,0 -- a new node that lands
        // under an existing one looks like nothing happened
        const at = { x: config.canvas.w / 2, y: Math.min(80 + config.nodes.length * 20, config.canvas.h - 80) };
        const node = createNode(config, entry.kind, at, paletteLabel(entry, config, context.t));
        // An entry that names an icon means it: a valve is a node that something flows through, and
        // without the icon it would be indistinguishable from a pump
        if (entry.icon !== undefined) {
            node.icon = entry.icon;
        }
        // A valve, a pump, a meter: they show their own reading, not the sum of their lines
        if (entry.reads && !node.value) {
            node.value = { oid: '' };
        }
        // ... and a switch is shown as a word. The state behind a valve is a boolean far more often
        // than a number, and "1 l/min" would be nonsense; a percentage valve is a number field away
        if (entry.onOff) {
            const [on, off] = entry.onOff;
            node.display = 'text';
            node.textMap = switchTextMap(context.t(on), context.t(off));
            // On it carries the colour of its medium, off it is grey -- a glance at the diagram says
            // which valve is open. Zero is off for a boolean and for a percentage alike
            const accent = mediumOf(config).accent;
            if (accent) {
                node.color = accent;
            }
            node.rules = [{ op: '==', value: 0, color: SWITCH_OFF_COLOR }];
        }
        commit({ ...config, nodes: [...config.nodes, node] });
        setSelection({ kind: 'node', id: node.id });
    };

    /** What this diagram is made of: a water installation has valves and pumps, not "a bus" */
    const palette = React.useMemo(() => paletteOf(mediumOf(config).id), [config]);

    /**
     * Saving by itself: every change restarts the clock, so a burst of edits is one save. The effect
     * depends on `config`, which is what makes it a debounce -- the pending timer is cleared on the
     * next change and the one that finally fires holds the current document.
     */
    React.useEffect(() => {
        if (!inline || !autosave || !dirty) {
            return undefined;
        }
        const timer = setTimeout(() => {
            lastMerge.current = null;
            onSave(config);
            setBaseline(config);
        }, AUTOSAVE_MS);
        return () => clearTimeout(timer);
    }, [inline, autosave, dirty, config, onSave]);

    const runtimeForTitle = React.useMemo(() => computeRuntime(config, () => null, flowTheme), [config, flowTheme]);

    const save = (): void => {
        // What was saved must stay on the stack as its own step, not be merged into the next one
        lastMerge.current = null;
        onSave(config);
        if (inline) {
            // The page stays open, so what was just saved becomes the new "clean"
            setBaseline(config);
        } else {
            onClose();
        }
    };

    const body = (
        <Box
            ref={rootRef}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                // Inline it fills the host's box; in the dialog it is a flex child of the paper
                height: inline ? '100%' : undefined,
            }}
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
                    {toolbarStart}
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
                    <Tooltip title={context.t('editor_export_image')}>
                        <IconButton
                            size="small"
                            onClick={event => setExportAnchor(event.currentTarget)}
                        >
                            <ImageIcon />
                        </IconButton>
                    </Tooltip>
                    <Menu
                        anchorEl={exportAnchor}
                        open={!!exportAnchor}
                        onClose={() => setExportAnchor(null)}
                    >
                        {(['svg', 'png'] as const).map(format => (
                            <MenuItem
                                key={format}
                                onClick={() => {
                                    setExportAnchor(null);
                                    const svg = rootRef.current?.querySelector<SVGSVGElement>('svg.ef-root');
                                    if (!svg) {
                                        return;
                                    }
                                    const name = slugify(title || 'flow');
                                    const background = config.canvas.background || flowTheme.background;
                                    if (format === 'svg') {
                                        exportSvg(svg, name, background);
                                    } else {
                                        exportPng(svg, name, background).catch((error: unknown) =>
                                            setExportError(String(error)),
                                        );
                                    }
                                }}
                            >
                                {context.t(`editor_export_${format}`)}
                            </MenuItem>
                        ))}
                    </Menu>

                    <Box sx={{ flex: 1 }} />

                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ mr: 2 }}
                    >
                        {context.t('insp_counts', runtimeForTitle.nodes.length, runtimeForTitle.edges.length)}
                    </Typography>

                    <Tooltip title={context.t(inspector.open ? 'editor_inspector_hide' : 'editor_inspector_show')}>
                        <IconButton
                            size="small"
                            color={inspector.open ? 'primary' : 'default'}
                            onClick={() => setInspector(previous => ({ ...previous, open: !previous.open }))}
                            sx={{ mr: 1 }}
                        >
                            <ViewSidebar />
                        </IconButton>
                    </Tooltip>

                    {toolbarExtra}

                    {inline ? (
                        <Tooltip title={context.t('editor_autosave')}>
                            <IconButton
                                size="small"
                                color={autosave ? 'primary' : 'default'}
                                onClick={() => setAutosave(previous => !previous)}
                                sx={{
                                    mr: 1,
                                    // While the clock is running the symbol turns, so the wait is
                                    // visible: something is going to be saved, and nothing is stuck
                                    '@keyframes flow-spin': { to: { transform: 'rotate(360deg)' } },
                                    '& svg': {
                                        animation: autosave && dirty ? 'flow-spin 3s linear infinite' : 'none',
                                    },
                                    '@media (prefers-reduced-motion: reduce)': { '& svg': { animation: 'none' } },
                                }}
                            >
                                <Autorenew />
                            </IconButton>
                        </Tooltip>
                    ) : null}

                    <Button
                        startIcon={<Close />}
                        onClick={onClose}
                        color="inherit"
                        // Inline there is nothing to close, only edits to throw away
                        disabled={inline && !dirty}
                    >
                        {context.t(inline ? 'editor_discard' : 'cancel')}
                    </Button>
                    <Button
                        startIcon={<Check />}
                        variant="contained"
                        disabled={inline && !dirty}
                        onClick={save}
                    >
                        {context.t(inline ? 'editor_save' : 'apply')}
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
                    {palette.map(entry => (
                        <Tooltip
                            key={entry.id}
                            title={context.t('editor_add', paletteLabel(entry, config, context.t))}
                            placement="right"
                        >
                            <IconButton onClick={() => addNode(entry)}>
                                {kindIcon(entry.kind, config, entry.icon)}
                            </IconButton>
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
                        units={units}
                        times={times}
                        now={now}
                        history={history}
                        raw={raw}
                        energy={energy}
                        selection={selection}
                        onSelect={setSelection}
                        onChange={commit}
                        showGrid={showGrid}
                        animate={animate}
                    />
                </Box>

                {/* Inspector -- the handle draws the dividing line, so the panel has no border of its own */}
                {inspector.open ? (
                    <>
                        <ResizeHandle
                            panel="right"
                            width={inspector.width}
                            min={INSPECTOR_MIN}
                            max={INSPECTOR_MAX}
                            defaultWidth={INSPECTOR_DEFAULT}
                            tooltip={context.t('editor_resize_hint')}
                            onChange={width => setInspector(previous => ({ ...previous, width }))}
                        />
                        <Box
                            sx={{
                                width: inspector.width,
                                flexShrink: 0,
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
                                units={units}
                                historyInstance={historyInstance}
                                defaultNodeColor={kind => flowTheme.kinds[kind]}
                            />
                        </Box>
                    </>
                ) : null}
            </Box>

            <JsonDialog
                open={jsonOpen}
                config={config}
                fileName={title ? diagramFileName(slugify(title)) : undefined}
                onClose={() => setJsonOpen(false)}
                onApply={next => {
                    commit(next);
                    setSelection({ kind: 'canvas' });
                }}
                context={context}
            />

            <PresetDialog
                medium={mediumOf(config).id}
                open={presetsOpen}
                onClose={() => setPresetsOpen(false)}
                onPick={picked => {
                    commit(picked);
                    setSelection({ kind: 'canvas' });
                }}
                context={context}
                theme={flowTheme}
                hasContent={config.nodes.length > 0}
                onWizard={() => {
                    setPresetsOpen(false);
                    setWizardOpen(true);
                }}
            />

            <DeviceWizard
                medium={mediumOf(config).id}
                open={wizardOpen}
                onClose={() => setWizardOpen(false)}
                onPick={picked => {
                    commit(picked);
                    setSelection({ kind: 'canvas' });
                }}
                context={context}
            />

            <Snackbar
                open={!!exportError}
                autoHideDuration={5000}
                onClose={() => setExportError(null)}
                message={exportError}
            />
        </Box>
    );

    if (inline) {
        return body;
    }

    // The paper of a full-screen dialog is already a flex column, so the same body fits both
    return (
        <Dialog
            open={open}
            fullScreen
            onClose={onClose}
        >
            {body}
        </Dialog>
    );
}

export default FlowEditor;
