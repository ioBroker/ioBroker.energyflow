/**
 * The device manager plugin.
 *
 * Same job as the vis-2 widget, other host: subscribe to the states the document names, hand the
 * numbers to `@energyflow/core`, render. The diagram, the colours, the directions and the animation
 * are identical because they come from the same module -- the only thing this file decides is how a
 * diagram fits into a card that may be as small as one tile.
 *
 * Sizes: a 1x1 card gets the diagram without labels (the text would be a smudge at that scale) and
 * opens the full view on a tap; the wider cards get the labels too.
 */
import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import { Close, OpenInFull } from '@mui/icons-material';
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
    collectOids,
    computeRuntime,
    EnergyFlowView,
    normalizeConfig,
    toNumber,
    createTheme,
    type EnergyFlowConfig,
} from '@energyflow/core';
import { I18N_PREFIX } from '@energyflow/i18n';

/** Where the designer is loaded from when the settings dialog renders the `custom` item */
const DESIGNER_URL = './adapter/energyflow/dm-widgets/customDevices.js';

/**
 * `<remote alias>/<exposed module>/<exported name>`.
 *
 * The alias is `energyflow` on purpose: that is the name `pluginLoader.ts` of ioBroker.devices already
 * registers this same remote entry under, so `registerRemotes` in `ConfigCustom` finds it registered
 * and reuses it instead of creating a second container for the same file.
 */
const DESIGNER_COMPONENT = 'energyflow/Config/Designer';

export interface WidgetEnergyFlowSettings extends CustomWidgetBase {
    /** The diagram, same document as the vis-2 widget stores */
    diagram?: EnergyFlowConfig | string;
    noAnimation?: boolean;
}

interface EnergyFlowDmState extends WidgetGenericState {
    efValues: Record<string, number | null>;
    efDialogOpen: boolean;
    efAnimate: boolean;
}

/** State changes are collected for this long before the card re-renders */
const FLUSH_MS = 120;

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

export class EnergyFlowDm extends WidgetGeneric<EnergyFlowDmState, WidgetEnergyFlowSettings> {
    private efSubscribed: string[] = [];
    private efPending: Record<string, number | null> = {};
    private efFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private efReducedMotion = false;

    /**
     * The settings dialog of the host.
     *
     * The whole diagram is one `custom` item, which is how the designer gets into a dialog that
     * otherwise only knows text fields and checkboxes. `i18n: false` because the dictionary of this
     * adapter is already registered: `pluginLoader.ts` loads `./translations` before it loads this
     * widget, so letting `ConfigCustom` fetch the JSON files again would only duplicate the work.
     */
    static getConfigSchema(): { name: string; schema: ConfigItemPanel } {
        return {
            name: `${I18N_PREFIX}widget_label`,
            schema: {
                type: 'panel',
                items: {
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

    constructor(props: WidgetGenericProps<WidgetEnergyFlowSettings>) {
        super(props);
        this.state = {
            ...this.state,
            efValues: {},
            efDialogOpen: false,
            efAnimate: true,
        };
    }

    componentDidMount(): void {
        // Optional call: the compile-time mirror of WidgetGeneric inherits the lifecycle methods from
        // React.Component, where they are optional. The real class the host provides at runtime has them.
        super.componentDidMount?.();
        this.efSyncSubscriptions();

        if (typeof window.matchMedia === 'function') {
            this.efReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }
        this.setState({ efAnimate: !this.efReducedMotion && !this.props.settings?.noAnimation });
    }

    componentDidUpdate(previous: WidgetGenericProps<WidgetEnergyFlowSettings>): void {
        if (previous.settings?.diagram !== this.props.settings?.diagram) {
            this.efSyncSubscriptions();
        }
        if (previous.settings?.noAnimation !== this.props.settings?.noAnimation) {
            this.setState({ efAnimate: !this.efReducedMotion && !this.props.settings?.noAnimation });
        }
    }

    componentWillUnmount(): void {
        super.componentWillUnmount?.();
        if (this.efFlushTimer) {
            clearTimeout(this.efFlushTimer);
            this.efFlushTimer = null;
        }
        for (const id of this.efSubscribed) {
            this.props.stateContext.removeState(id, this.efOnStateChange);
        }
        this.efSubscribed = [];
    }

    private get efConfig(): EnergyFlowConfig {
        return normalizeConfig(this.props.settings?.diagram);
    }

    private efOnStateChange: StateChangeListener = (id, state) => {
        this.efPending[id] = state ? toNumber(state.val) : null;
        if (this.efFlushTimer) {
            return;
        }
        this.efFlushTimer = setTimeout(() => {
            this.efFlushTimer = null;
            const batch = this.efPending;
            this.efPending = {};
            this.setState(previous => ({ efValues: { ...previous.efValues, ...batch } }));
        }, FLUSH_MS);
    };

    /** Subscribe to what the document reads, unsubscribe from what it no longer does */
    private efSyncSubscriptions(): void {
        const wanted = collectOids(this.efConfig);
        const context = this.props.stateContext;

        for (const id of this.efSubscribed) {
            if (!wanted.includes(id)) {
                context.removeState(id, this.efOnStateChange);
            }
        }
        for (const id of wanted) {
            if (!this.efSubscribed.includes(id)) {
                context.getState(id, this.efOnStateChange);
            }
        }
        this.efSubscribed = wanted;
    }

    /** The theme of the host, reduced to the handful of colours the renderer needs */
    private efTheme(): ReturnType<typeof createTheme> {
        return createTheme(this.props.stateContext.themeType === 'dark' ? 'dark' : 'light', {
            locale: this.props.stateContext.language,
        });
    }

    private efRuntime(): ReturnType<typeof computeRuntime> {
        return computeRuntime(this.efConfig, oid => this.state.efValues[oid] ?? null, this.efTheme());
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

    private efDiagram(hideLabels: boolean): React.JSX.Element {
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
                        {t('widget_not_configured')}
                    </Typography>
                </Box>
            );
        }

        return (
            <EnergyFlowView
                runtime={this.efRuntime()}
                theme={theme}
                animate={this.state.efAnimate}
                hideLabels={hideLabels}
            />
        );
    }

    /**
     * The full diagram, big. A card of any size is too small for a five-node diagram with labels, so
     * the card is a summary and this is the thing itself.
     */
    private efRenderDialog(): React.JSX.Element | null {
        if (!this.state.efDialogOpen) {
            return null;
        }
        return (
            <Dialog
                open
                fullWidth
                maxWidth="lg"
                onClose={() => this.setState({ efDialogOpen: false })}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {this.props.settings?.name || this.state.name || t('set_label')}
                    <IconButton onClick={() => this.setState({ efDialogOpen: false })}>
                        <Close />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ height: { xs: 320, sm: 420, md: 520 } }}>{this.efDiagram(false)}</Box>
                </DialogContent>
            </Dialog>
        );
    }

    /** A square card: the diagram as a glyph, no labels, plus the name */
    renderCompact(): React.JSX.Element {
        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={theme => WidgetGeneric.getStyleCompact(theme)}
            >
                <Box
                    onClick={() => this.onTileClick()}
                    sx={{
                        width: '100%',
                        aspectRatio: '1',
                        display: 'flex',
                        flexDirection: 'column',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        p: 1,
                    }}
                >
                    <Box sx={{ flex: 1, minHeight: 0 }}>{this.efDiagram(true)}</Box>
                    <Typography
                        variant="caption"
                        sx={{ fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                    >
                        {this.props.settings?.name || this.state.name || t('set_label')}
                    </Typography>
                </Box>
                {this.renderSettingsButton()}
                {this.efRenderDialog()}
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

    private efRenderWideCard(tall: boolean): React.JSX.Element {
        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={theme => (tall ? WidgetGeneric.getStyleWideTall(theme) : WidgetGeneric.getStyleWide(theme))}
            >
                <Box sx={{ position: 'relative', width: '100%', height: '100%', p: 1, overflow: 'hidden' }}>
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
                {this.renderSettingsButton()}
                {this.efRenderDialog()}
            </Box>
        );
    }
}

export default EnergyFlowDm;
