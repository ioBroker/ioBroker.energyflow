/**
 * The device manager plugin.
 *
 * Same job as the vis-2 widget, other host: subscribe to the states the document names, hand the
 * numbers to `@flow/core`, render. The diagram, the colours, the directions and the animation
 * are identical because they come from the same module -- the only thing this file decides is how a
 * diagram fits into a card that may be as small as one tile.
 *
 * Sizes: a 1x1 card gets the diagram without labels (the text would be a smudge at that scale) and
 * opens the full view on a tap; the wider cards get the labels too.
 */
import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import { Close, CloseFullscreen, OpenInFull } from '@mui/icons-material';
import WidgetGeneric, {
    AdapterReact,
    type WidgetGenericProps,
    type WidgetGenericState,
    type CustomWidgetBase,
    type StateChangeListener,
} from '@iobroker/dm-widgets';
// The schema types come from `@iobroker/dm-utils`, because that is the copy `WidgetGeneric` types
// `getConfigSchema()` against -- the identical types from `@iobroker/json-config` are a different
// declaration as far as TypeScript is concerned, and the override would not match
import type { ConfigItemPanel } from '@iobroker/dm-utils';

import {
    cachedEnergyToday,
    cachedHistory,
    cachedMax,
    cachedUnit,
    collectOids,
    detailTarget,
    energyRequests,
    historyRequests,
    loadEnergyToday,
    loadHistory,
    needsClock,
    readDetail,
    computeRuntime,
    loadUnits,
    FlowView,
    emptyConfig,
    diagramFromNative,
    readDiagramAttribute,
    toNumber,
    createTheme,
    type FlowConfig,
    type FlowNode,
    type HistoryReader,
    type StateTimes,
    type FlowConfigRef,
} from '@flow/core';
import { I18N_PREFIX } from '@flow/i18n';
// By path: the package index would pull the designer and gui-components into the card's chunk
import { HistoryDialog } from '../../packages/editor/src/HistoryDialog';

/** Where the designer is loaded from when the settings dialog renders the `custom` item */
const DESIGNER_URL = './adapter/flow/dm-widgets/customDevices.js';

/**
 * `<remote alias>/<exposed module>/<exported name>`.
 *
 * The alias is `flow` on purpose: that is the name `pluginLoader.ts` of ioBroker.devices already
 * registers this same remote entry under, so `registerRemotes` in `ConfigCustom` finds it registered
 * and reuses it instead of creating a second container for the same file.
 */
const DESIGNER_COMPONENT = 'flow/Config/Designer';

export interface WidgetFlowSettings extends CustomWidgetBase {
    /** The diagram, or a reference to a stored one -- the same value the vis-2 widget stores */
    diagram?: FlowConfig | FlowConfigRef | string;
    noAnimation?: boolean;
}

interface FlowDmState extends WidgetGenericState {
    efValues: Record<string, number | null>;
    /** When each state was written and changed, for nodes that show it */
    efTimes: Record<string, StateTimes & { raw?: unknown }>;
    /** The node whose detail view is open */
    efDetail: string | null;
    /** The present, advanced while a node shows "12 minutes ago" */
    efNow: number;
    /** Bumped when recorded values for the charts have arrived */
    efHistory: number;
    efDialogOpen: boolean;
    /** The full view fills the screen; a diagram is wide and the dialog's own size wastes half of it */
    efDialogFull: boolean;
    efAnimate: boolean;
    /** The referenced diagram, as last delivered by its state, with the id it belongs to */
    efStored: { id: string; config: FlowConfig | null } | null;
    /** Bumped when units of the states have arrived, see `units.ts` in the core */
    efUnits: number;
}

/** State changes are collected for this long before the card re-renders */
const FLUSH_MS = 120;

/** How often "12 minutes ago" is recomputed */
const CLOCK_MS = 30000;

/** The part of the host's socket the charts and the stored diagrams use */
interface HistorySocket {
    getHistory: (id: string, options: ioBroker.GetHistoryOptions) => Promise<unknown>;
    subscribeObject?: (
        id: string,
        cb: (id: string, object: ioBroker.Object | null | undefined) => void,
    ) => Promise<void>;
    unsubscribeObject?: (
        id: string,
        cb: (id: string, object: ioBroker.Object | null | undefined) => void,
    ) => Promise<void>;
}

/**
 * Translate a key of this adapter. The prefix is applied when the dictionary is registered.
 *
 * `I18n` comes from the host through `@iobroker/dm-widgets` rather than from a direct
 * `@iobroker/gui-components` import, and that is a size decision, not a style one: this bundle does not
 * share `gui-components` (see `vite.config.ts`), so importing anything from its barrel here pulls the
 * whole 620 kB package into the *card* chunk -- the one every category page loads. The designer needs
 * the real package and imports it directly; the card only needs `I18n.t`.
 */
function t(key: string, ...args: (string | number)[]): string {
    const i18n = (AdapterReact as { I18n?: { t: (word: string, ...rest: unknown[]) => string } } | undefined)?.I18n;
    return i18n ? i18n.t(`${I18N_PREFIX}${key}`, ...args) : `${I18N_PREFIX}${key}`;
}

export class FlowDm extends WidgetGeneric<FlowDmState, WidgetFlowSettings> {
    private efSubscribed: string[] = [];
    private efPending: Record<string, number | null> = {};
    private efPendingTimes: Record<string, StateTimes & { raw?: unknown }> = {};
    private efClock: ReturnType<typeof setInterval> | null = null;
    /** The default history adapter: undefined until asked, null when there is none */
    private efHistoryInstance: string | null | undefined = undefined;
    private efFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private efReducedMotion = false;
    private efUnmounted = false;

    /**
     * The settings dialog of the host.
     *
     * The whole diagram is one `custom` item, which is how the designer gets into a dialog that
     * otherwise only knows text fields and checkboxes. `i18n: false` because the dictionary of this
     * adapter is already registered: `pluginLoader.ts` loads `./translations` before it loads this
     * widget, so letting `ConfigCustom` fetch the JSON files again would only duplicate the work.
     *
     * `size` repeats a field the host prepends by itself, because the one it prepends offers only
     * 1x1, 2x1 and 2x1/2. A diagram is the one widget that wants the big square, so the fourth
     * option is added here -- the host's own widgets that offer it do exactly the same.
     */
    static getConfigSchema(): { name: string; schema: ConfigItemPanel } {
        return {
            name: `${I18N_PREFIX}widget_label`,
            schema: {
                type: 'panel',
                items: {
                    size: {
                        type: 'select',
                        label: 'wm_Size',
                        options: [
                            { value: '1x1', label: '1\u00D71' },
                            { value: '2x1', label: '2\u00D71' },
                            { value: '2x0.5', label: '2\u00D7\u00BD' },
                            { value: '2x2', label: '2\u00D72' },
                        ],
                        default: '1x1',
                        format: 'radio',
                        horizontal: true,
                        noTranslation: true,
                    },
                    diagram: {
                        type: 'custom',
                        url: DESIGNER_URL,
                        name: DESIGNER_COMPONENT,
                        i18n: false,
                        newLine: true,
                        /**
                         * Generation 2 = `@iobroker/gui-components`, React 19 / MUI 9.
                         *
                         * `@iobroker/json-config` 10 reads this to refuse a component built against the
                         * previous generation. `@iobroker/dm-utils` 3.2 does not declare the field in
                         * its copy of the schema types yet, which is why nothing here checks the name --
                         * a typo would be silently dropped and the designer would then be refused.
                         */
                        guiApi: 2,
                    },
                    noAnimation: {
                        type: 'checkbox',
                        label: `${I18N_PREFIX}no_animation`,
                        newLine: true,
                    },
                },
            },
        };
    }

    constructor(props: WidgetGenericProps<WidgetFlowSettings>) {
        super(props);
        this.state = {
            ...this.state,
            efValues: {},
            efDialogOpen: false,
            efDialogFull: false,
            efAnimate: true,
            efStored: null,
            efUnits: 0,
            efTimes: {},
            efDetail: null,
            efNow: Date.now(),
            efHistory: 0,
        };
    }

    componentDidMount(): void {
        // Optional call: the compile-time mirror of WidgetGeneric inherits the lifecycle methods from
        // React.Component, where they are optional. The real class the host provides at runtime has them.
        super.componentDidMount?.();
        this.efSyncSubscriptions();

        // "12 minutes ago" has to become "13 minutes ago" without the state changing
        this.efClock = setInterval(() => {
            if (needsClock(this.efConfig)) {
                this.setState({ efNow: Date.now() });
            }
            this.efLoadHistory();
        }, CLOCK_MS);
        this.efLoadHistory();

        if (typeof window.matchMedia === 'function') {
            this.efReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
        this.setState({ efAnimate: !this.efReducedMotion && !this.props.settings?.noAnimation });
    }

    componentDidUpdate(previous: WidgetGenericProps<WidgetFlowSettings>): void {
        if (previous.settings?.diagram !== this.props.settings?.diagram) {
            this.efSyncSubscriptions();
        }
        if (previous.settings?.noAnimation !== this.props.settings?.noAnimation) {
            this.setState({ efAnimate: !this.efReducedMotion && !this.props.settings?.noAnimation });
        }
    }

    componentWillUnmount(): void {
        super.componentWillUnmount?.();
        this.efUnmounted = true;
        if (this.efClock) {
            clearInterval(this.efClock);
            this.efClock = null;
        }
        if (this.efFlushTimer) {
            clearTimeout(this.efFlushTimer);
            this.efFlushTimer = null;
        }
        for (const id of this.efSubscribed) {
            this.props.stateContext.removeState(id, this.efOnStateChange);
        }
        this.efSubscribed = [];
        this.efWatchDiagram(null);
    }

    /** The stored diagram this card is watching, if it shows one */
    private efWatched: string | null = null;

    /**
     * Follow the referenced diagram.
     *
     * A diagram is an object, so it is read with `getObject` and followed with `subscribeObject` --
     * the card's state context only carries states. Where the host gives no socket, the diagram is
     * still read once; it simply does not update until the page is reopened.
     *
     * @param id the diagram to watch, or null to stop watching
     */
    private efWatchDiagram(id: string | null): void {
        if (this.efWatched === id) {
            return;
        }
        const context = this.props.stateContext;
        const socket = (context as unknown as { socket?: HistorySocket }).socket;
        if (this.efWatched) {
            socket?.unsubscribeObject?.(this.efWatched, this.efOnDiagramChange).catch(() => undefined);
        }
        this.efWatched = id;
        if (!id) {
            return;
        }
        socket?.subscribeObject?.(id, this.efOnDiagramChange).catch(() => undefined);
        context
            .getObject<ioBroker.Object>(id)
            .then(object => {
                if (!this.efUnmounted && this.efWatched === id) {
                    this.setState(
                        { efStored: { id, config: diagramFromNative((object as ioBroker.AnyObject)?.native) } },
                        () => this.efSyncSubscriptions(),
                    );
                }
            })
            .catch(() => undefined);
    }

    private efOnDiagramChange = (id: string, object: ioBroker.Object | null | undefined): void => {
        if (this.efUnmounted || id !== this.efWatched) {
            return;
        }
        this.setState({ efStored: { id, config: diagramFromNative((object as ioBroker.AnyObject)?.native) } }, () =>
            this.efSyncSubscriptions(),
        );
    };

    /** The stored diagram this card refers to, or null if it carries its own */
    private get efRef(): string | null {
        const attribute = readDiagramAttribute(this.props.settings?.diagram);
        return 'ref' in attribute ? attribute.ref : null;
    }

    /** The document to draw -- see the same getter in the vis-2 widget for the reasoning */
    private get efConfig(): FlowConfig {
        const attribute = readDiagramAttribute(this.props.settings?.diagram);
        if ('config' in attribute) {
            return attribute.config;
        }
        const stored = this.state.efStored;
        return stored && stored.id === attribute.ref && stored.config ? stored.config : emptyConfig();
    }

    private efOnStateChange: StateChangeListener = (id, state) => {
        this.efPending[id] = state ? toNumber(state.val) : null;
        this.efPendingTimes[id] = { ts: state?.ts, lc: state?.lc, raw: state?.val };
        if (this.efFlushTimer) {
            return;
        }
        this.efFlushTimer = setTimeout(() => {
            this.efFlushTimer = null;
            const batch = this.efPending;
            const times = this.efPendingTimes;
            this.efPending = {};
            this.efPendingTimes = {};
            this.setState(previous => ({
                efValues: { ...previous.efValues, ...batch },
                efTimes: { ...previous.efTimes, ...times },
            }));
        }, FLUSH_MS);
    };

    /**
     * Read the recorded values the charts of the diagram need.
     *
     * The state context of the device manager has no history call of its own, but it is built on a
     * socket that does. The field is `protected` in the typings only; where it is missing, the card
     * simply has no charts.
     */
    private efLoadHistory(): void {
        const requests = historyRequests(this.efConfig);
        const energy = energyRequests(this.efConfig);
        const socket = (this.props.stateContext as unknown as { socket?: HistorySocket }).socket;
        if (
            (!requests.length && !energy.length) ||
            this.efHistoryInstance === null ||
            typeof socket?.getHistory !== 'function'
        ) {
            return;
        }
        const run = (instance: string): void => {
            const read: HistoryReader = (oid, options) =>
                socket.getHistory(oid, { instance, aggregate: 'average', ignoreNull: true, ...options });
            Promise.all([loadHistory(requests, read), loadEnergyToday(energy, read)])
                .then(([charts, today]) => charts || today)
                .then(changed => {
                    if (changed && !this.efUnmounted) {
                        this.setState(previous => ({ efHistory: previous.efHistory + 1, efNow: Date.now() }));
                    }
                })
                .catch(() => undefined);
        };
        if (this.efHistoryInstance) {
            run(this.efHistoryInstance);
            return;
        }
        this.props.stateContext
            .getObject<ioBroker.SystemConfigObject>('system.config')
            .then(config => {
                this.efHistoryInstance = config?.common?.defaultHistory || null;
                if (this.efHistoryInstance) {
                    run(this.efHistoryInstance);
                }
            })
            .catch(() => undefined);
    }

    /** Subscribe to what the document reads, unsubscribe from what it no longer does */
    private efSyncSubscriptions(): void {
        // The referenced diagram is an object and is watched separately; these are the readings
        this.efWatchDiagram(this.efRef ?? null);
        const wanted = collectOids(this.efConfig);
        const context = this.props.stateContext;

        for (const id of this.efSubscribed) {
            if (!wanted.includes(id)) {
                context.removeState(id, this.efOnStateChange);
            }
        }
        const added = wanted.filter(id => !this.efSubscribed.includes(id));
        for (const id of added) {
            context.getState(id, this.efOnStateChange);
        }
        this.efSubscribed = wanted;

        // What the numbers are in comes from the objects; read once per state and page
        if (added.length) {
            loadUnits(added, id => context.getObject<ioBroker.Object>(id))
                .then(() => !this.efUnmounted && this.setState(previous => ({ efUnits: previous.efUnits + 1 })))
                .catch(() => undefined);
        }
    }

    /** The theme of the host, reduced to the handful of colours the renderer needs */
    private efTheme(): ReturnType<typeof createTheme> {
        return createTheme(this.props.stateContext.themeType === 'dark' ? 'dark' : 'light', {
            locale: this.props.stateContext.language,
        });
    }

    private efRuntime(): ReturnType<typeof computeRuntime> {
        return computeRuntime(this.efConfig, oid => this.state.efValues[oid] ?? null, this.efTheme(), {
            units: cachedUnit,
            maxima: cachedMax,
            times: oid => this.state.efTimes[oid],
            now: this.state.efNow,
            history: cachedHistory,
            raw: oid => this.state.efTimes[oid]?.raw,
            energy: cachedEnergyToday,
        });
    }

    // --- Overrides used by the host's default card chrome ---

    /** Any energy moving anywhere lights the card up */
    protected isTileActive(): boolean {
        return this.efRuntime().edges.some(edge => edge.active);
    }

    protected hasTileAction(): boolean {
        return true;
    }

    protected onTileClick(): void {
        this.setState({ efDialogOpen: true });
    }

    /**
     * The states the host may chart. Every node that displays a value is offered, in its own colour,
     * so the chart of a diagram reads like the diagram.
     */
    protected getHistoryIds(): { id: string; color: string; name?: string }[] {
        const result: { id: string; color: string; name?: string }[] = [];
        for (const node of this.efRuntime().nodes) {
            const source = node.node.value as { oid?: string } | undefined;
            if (source?.oid) {
                result.push({ id: source.oid, color: node.color, name: node.node.label || node.node.id });
            }
        }
        return result;
    }

    protected getChartUnit(): string | undefined {
        return this.efConfig.defaults?.unit;
    }

    // --- Rendering ---

    private efDiagram(hideLabels: boolean, short?: boolean): React.JSX.Element {
        const config = this.efConfig;
        const theme = this.efTheme();

        if (!config.nodes.length) {
            return (
                <Box
                    sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        p: 1,
                    }}
                >
                    <Typography
                        variant="caption"
                        color="text.secondary"
                    >
                        {t(short ? 'widget_not_configured_short' : 'widget_not_configured')}
                    </Typography>
                </Box>
            );
        }

        return (
            <FlowView
                runtime={this.efRuntime()}
                theme={theme}
                animate={this.state.efAnimate}
                hideLabels={hideLabels}
                onNodeClick={this.efOnNodeClick}
            />
        );
    }

    /**
     * The full diagram, big. A card of any size is too small for a five-node diagram with labels, so
     * the card is a summary and this is the thing itself.
     */
    /** The card only offers the detail view; switching and writing belong to the device's own controls */
    private efOnNodeClick = (node: FlowNode, event: React.MouseEvent): void => {
        if (node.action?.type === 'chart') {
            // The card around it opens the full view on a click; a node with an action of its own
            // has the last word
            event.stopPropagation();
            this.setState({ efDetail: node.id });
        }
    };

    /** The detail view of a node: its value over time, from the default history adapter */
    private efRenderDetail(): React.JSX.Element | null {
        const runtime = this.efRuntime();
        const node = this.state.efDetail ? runtime.nodeById[this.state.efDetail] : undefined;
        const target = node ? detailTarget(node.node, this.efConfig, cachedUnit) : null;
        const socket = (this.props.stateContext as unknown as { socket?: HistorySocket }).socket;
        if (!node || !target) {
            return null;
        }
        return (
            <HistoryDialog
                open
                onClose={() => this.setState({ efDetail: null })}
                title={node.node.label || node.node.id}
                color={node.color}
                theme={this.efTheme()}
                unit={target.unit}
                t={t}
                load={async (start, end, step) => {
                    if (this.efHistoryInstance === undefined) {
                        const config =
                            await this.props.stateContext.getObject<ioBroker.SystemConfigObject>('system.config');
                        this.efHistoryInstance = config?.common?.defaultHistory || null;
                    }
                    const instance = this.efHistoryInstance;
                    if (!instance || typeof socket?.getHistory !== 'function') {
                        throw new Error(t('insp_history_no_adapter'));
                    }
                    return readDetail(
                        (oid, options) =>
                            socket.getHistory(oid, { instance, aggregate: 'average', ignoreNull: true, ...options }),
                        target,
                        start,
                        end,
                        step,
                    );
                }}
            />
        );
    }

    private efRenderDialog(): React.JSX.Element | null {
        if (!this.state.efDialogOpen) {
            return null;
        }
        const full = this.state.efDialogFull;
        return (
            <Dialog
                open
                fullWidth
                maxWidth="lg"
                fullScreen={full}
                onClose={() => this.setState({ efDialogOpen: false })}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {this.props.settings?.name || this.state.name || t('set_label')}
                    <Box>
                        <IconButton
                            title={t(full ? 'dlg_restore' : 'dlg_maximize')}
                            onClick={() => this.setState({ efDialogFull: !full })}
                        >
                            {full ? <CloseFullscreen /> : <OpenInFull />}
                        </IconButton>
                        <IconButton onClick={() => this.setState({ efDialogOpen: false })}>
                            <Close />
                        </IconButton>
                    </Box>
                </DialogTitle>
                {/* Maximized, the diagram gets everything the dialog has; otherwise a fixed slice of
                    the window, because a `Dialog` grows with its content and would otherwise collapse */}
                {/* The diagram scales itself into whatever box it gets, so the box has to have a
                    height of its own: without one the content grows and the dialog scrolls instead
                    of showing the whole diagram. Maximized that height is the dialog's, otherwise a
                    slice of the window. */}
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                    <Box
                        sx={{
                            minHeight: 0,
                            // `flex: 1` sets `flex-basis: 0`, which beats a height -- maximized that
                            // is what fills the dialog, and in the small one it would let the diagram
                            // grow to its natural size instead, so there it gets a height and no flex
                            ...(full ? { flex: 1 } : { height: { xs: 320, sm: 420, md: '65vh' } }),
                        }}
                    >
                        {this.efDiagram(false)}
                    </Box>
                </DialogContent>
            </Dialog>
        );
    }

    /**
     * A square card: the diagram as a glyph, no labels, plus the name.
     *
     * The square is the *card*, not its content, and the settings button is laid over it. It comes
     * from the host as an element in the flow, so a card that lets it follow the content ends up
     * taller than every other tile in the grid -- 145 x 167 next to 145 x 145 -- and the button hangs
     * below the frame it belongs to.
     */
    renderCompact(): React.JSX.Element {
        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={theme => ({ ...WidgetGeneric.getStyleCompact(theme), aspectRatio: '1' })}
            >
                <Box
                    onClick={() => this.onTileClick()}
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        p: 1,
                        // Room for the settings button below
                        pb: 3,
                    }}
                >
                    <Box sx={{ flex: 1, minHeight: 0 }}>{this.efDiagram(true, true)}</Box>
                    <Typography
                        variant="caption"
                        sx={{
                            fontWeight: 600,
                            textAlign: 'center',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {this.props.settings?.name || this.state.name || t('set_label')}
                    </Typography>
                </Box>
                <Box
                    sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        justifyContent: 'center',
                    }}
                >
                    {this.renderSettingsButton()}
                </Box>
                {this.efRenderDialog()}
                {this.efRenderDetail()}
            </Box>
        );
    }

    /** A wide card: room for the labels, and a button that opens the full view */
    renderWide(): React.JSX.Element {
        return this.efRenderWideCard(false);
    }

    /** A wide and tall card: the diagram gets the whole card */
    renderWideTall(): React.JSX.Element {
        return this.efRenderWideCard(true);
    }

    /**
     * The 2x2 card: two columns wide and two rows tall, so the diagram gets a square of four tiles.
     *
     * The host's `WidgetGeneric` dispatches `size: '2x2'` here; the typings of `@iobroker/dm-widgets`
     * 2.0.1 do not declare the method yet, which is why it overrides nothing.
     */
    renderHuge(): React.JSX.Element {
        return this.efRenderWideCard(true, true);
    }

    private efRenderWideCard(tall: boolean, square?: boolean): React.JSX.Element {
        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={theme => ({
                    ...(tall ? WidgetGeneric.getStyleWideTall(theme) : WidgetGeneric.getStyleWide(theme)),
                    // Two columns wide and two rows tall is a square, and the card has to say so:
                    // nothing else gives it a height
                    ...(square ? { aspectRatio: '1' } : {}),
                })}
            >
                {/* The whole card opens the full view, not just the button in its corner */}
                <Box
                    onClick={() => this.onTileClick()}
                    sx={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        p: 1,
                        pb: 3,
                        overflow: 'hidden',
                        cursor: 'pointer',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 1,
                            mb: 0.5,
                        }}
                    >
                        <Typography
                            variant="body2"
                            sx={{ fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                        >
                            {this.props.settings?.name || this.state.name || t('set_label')}
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => this.onTileClick()}
                        >
                            <OpenInFull fontSize="small" />
                        </IconButton>
                    </Box>
                    {/* The header takes a fixed slice of the card; the diagram gets the rest */}
                    <Box sx={{ height: 'calc(100% - 28px)' }}>{this.efDiagram(!tall)}</Box>
                </Box>
                {/* Over the card, not under it -- see `renderCompact` */}
                <Box
                    sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        justifyContent: 'center',
                    }}
                >
                    {this.renderSettingsButton()}
                </Box>
                {this.efRenderDialog()}
                {this.efRenderDetail()}
            </Box>
        );
    }
}

export default FlowDm;
