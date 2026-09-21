/**
 * The vis-2 widget.
 *
 * It is deliberately thin: subscribe to the states the document names, hand the numbers to
 * `@energyflow/core`, render. Everything that decides what the diagram *looks* like is in the core, so
 * the device manager plugin can be just as thin.
 *
 * The one thing vis-2 cannot do for us is the subscription. State ids that appear in `visAttrs` as
 * `type: 'id'` are subscribed by the base class and land in `this.state.values`, but ours live inside a
 * JSON document, so `collectOids()` derives them and this class subscribes by hand. That is the price
 * of a diagram with an arbitrary number of nodes, and it is a few dozen lines.
 */
import React from 'react';

import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetProps, VisRxWidgetState } from '@iobroker/types-vis-2';

import {
    collectOids,
    computeRuntime,
    EnergyFlowView,
    normalizeConfig,
    themeFromMui,
    toNumber,
    type EnergyFlowConfig,
    type FlowNode,
} from '@energyflow/core';

import Generic from './Generic';

/**
 * The designer, including the parts of `@iobroker/gui-components` it needs, is one lazy chunk. It is
 * only ever rendered by the vis-2 attribute panel, so the runtime never fetches it.
 */
const LazyDiagramField = React.lazy(() => import('./DiagramField'));

interface EnergyFlowRxData {
    noCard: boolean;
    widgetTitle: string;
    diagram: EnergyFlowConfig | string;
    /** Turn the moving dots off for this widget, whatever the document says */
    noAnimation: boolean;
}

interface EnergyFlowState extends VisRxWidgetState {
    /** Current value per state id; `null` means the state has none yet */
    efValues: Record<string, number | null>;
    /** Whether the dots should move right now */
    efAnimate: boolean;
}

/** State changes are collected for this long before the widget re-renders */
const FLUSH_MS = 120;

export default class EnergyFlow extends Generic<EnergyFlowRxData, EnergyFlowState> {
    /** The ids currently subscribed, so a configuration change only diffs */
    private efSubscribed: string[] = [];
    private efPending: Record<string, number | null> = {};
    private efFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private efRoot = React.createRef<HTMLDivElement>();
    private efObserver: IntersectionObserver | null = null;
    private efVisible = true;
    private efOnScreen = true;
    private efReducedMotion = false;

    constructor(props: VisRxWidgetProps) {
        super(props);
        this.state = {
            ...this.state,
            efValues: {},
            efAnimate: true,
        };
    }

    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: 'tplEnergyflowDiagram',
            visSet: 'energyflow',
            visSetLabel: 'set_label',
            visSetIcon: 'widgets/energyflow/img/energyflow.svg',
            visSetColor: '#E0901A',
            visName: 'EnergyFlow',
            visWidgetLabel: 'widget_label',
            visHelp: 'widget_help',
            visAttrs: [
                {
                    name: 'common',
                    fields: [
                        {
                            // One attribute for the whole diagram. The designer behind it is what makes
                            // an arbitrary number of producers and consumers possible at all
                            name: 'diagram',
                            type: 'custom',
                            label: '',
                            noBinding: true,
                            component: (field, data, onDataChange, props) => (
                                <React.Suspense fallback={<div style={{ height: 36 }} />}>
                                    <LazyDiagramField
                                        name={field.name || 'diagram'}
                                        data={data}
                                        setData={onDataChange}
                                        visContext={props.context}
                                    />
                                </React.Suspense>
                            ),
                        },
                        { name: 'noCard', type: 'checkbox', label: 'no_card' },
                        { name: 'widgetTitle', type: 'text', label: 'name', hidden: 'data.noCard === true' },
                        { name: 'noAnimation', type: 'checkbox', label: 'no_animation' },
                    ],
                },
            ],
            visDefaultStyle: { width: '100%', height: 340 },
            visPrev: 'widgets/energyflow/img/prev_energyflow.svg',
        };
    }

    // Do not delete this method: vis-2 reads the widget configuration through the instance as well
    getWidgetInfo(): RxWidgetInfo {
        return EnergyFlow.getWidgetInfo();
    }

    componentDidMount(): void {
        super.componentDidMount();
        this.efSyncSubscriptions();

        document.addEventListener('visibilitychange', this.efOnVisibilityChange);

        // A diagram scrolled out of view or in a hidden browser tab must not keep the compositor busy.
        // The predecessor offers a manual "low performance" switch for the same problem; this needs no
        // switch because the browser already knows the answer.
        if (typeof IntersectionObserver !== 'undefined' && this.efRoot.current) {
            this.efObserver = new IntersectionObserver(entries => {
                const onScreen = entries.some(entry => entry.isIntersecting);
                if (onScreen !== this.efOnScreen) {
                    this.efOnScreen = onScreen;
                    this.efUpdateAnimate();
                }
            });
            this.efObserver.observe(this.efRoot.current);
        }

        if (typeof window.matchMedia === 'function') {
            const query = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.efReducedMotion = query.matches;
            // `addEventListener` on a MediaQueryList is not available on older Safari, and there is
            // nothing to fall back to -- the initial value is still correct
            query.addEventListener?.('change', this.efOnReducedMotionChange);
            this.efMotionQuery = query;
        }

        this.efUpdateAnimate();
    }

    componentWillUnmount(): void {
        super.componentWillUnmount();
        document.removeEventListener('visibilitychange', this.efOnVisibilityChange);
        this.efMotionQuery?.removeEventListener?.('change', this.efOnReducedMotionChange);
        this.efObserver?.disconnect();
        if (this.efFlushTimer) {
            clearTimeout(this.efFlushTimer);
            this.efFlushTimer = null;
        }
        for (const id of this.efSubscribed) {
            this.props.context.socket.unsubscribeState(id, this.efOnStateChange);
        }
        this.efSubscribed = [];
    }

    private efMotionQuery: MediaQueryList | null = null;

    onRxDataChanged(): void {
        this.efSyncSubscriptions();
        this.efUpdateAnimate();
    }

    private efOnVisibilityChange = (): void => {
        this.efVisible = !document.hidden;
        this.efUpdateAnimate();
    };

    private efOnReducedMotionChange = (event: MediaQueryListEvent): void => {
        this.efReducedMotion = event.matches;
        this.efUpdateAnimate();
    };

    private efUpdateAnimate(): void {
        const animate = this.efVisible && this.efOnScreen && !this.efReducedMotion && !this.state.rxData.noAnimation;
        if (animate !== this.state.efAnimate) {
            this.setState({ efAnimate: animate });
        }
    }

    /** The document as configured, tolerant of whatever is actually stored */
    private get efConfig(): EnergyFlowConfig {
        return normalizeConfig(this.state.rxData.diagram);
    }

    private efOnStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        this.efPending[id] = state ? toNumber(state.val) : null;
        if (this.efFlushTimer) {
            return;
        }
        // A PV setup at midday updates a dozen states per second; one re-render per burst is plenty
        this.efFlushTimer = setTimeout(() => {
            this.efFlushTimer = null;
            const batch = this.efPending;
            this.efPending = {};
            this.setState(previous => ({ efValues: { ...previous.efValues, ...batch } }));
        }, FLUSH_MS);
    };

    /**
     * Subscribe to what the document reads, unsubscribe from what it no longer does.
     *
     * Diffing rather than re-subscribing wholesale matters in the vis-2 editor: every keystroke in the
     * designer changes the document, and dropping all subscriptions in between would make the preview
     * flash back to "--".
     */
    private efSyncSubscriptions(): void {
        const wanted = collectOids(this.efConfig);
        const socket = this.props.context.socket;

        const added = wanted.filter(id => !this.efSubscribed.includes(id));
        const removed = this.efSubscribed.filter(id => !wanted.includes(id));

        for (const id of removed) {
            socket.unsubscribeState(id, this.efOnStateChange);
        }
        if (added.length) {
            socket
                .subscribeState(added, this.efOnStateChange)
                .catch((error: unknown) => console.warn(`energyflow: cannot subscribe: ${String(error)}`));
        }

        this.efSubscribed = wanted;

        if (removed.length) {
            // Drop the values of states nobody reads any more, so a re-bound node does not briefly
            // show the number of the state it used to point at
            this.setState(previous => {
                const values = { ...previous.efValues };
                for (const id of removed) {
                    delete values[id];
                }
                return { efValues: values };
            });
        }
    }

    private efOnNodeClick = (node: FlowNode): void => {
        const action = node.action;
        if (!action || action.type === 'none') {
            return;
        }
        const context = this.props.context;

        switch (action.type) {
            case 'toggle':
                if (action.oid) {
                    // Read first: a toggle has to know what it is toggling, and the value may belong to
                    // a state the diagram does not otherwise display
                    context.socket
                        .getState(action.oid)
                        .then(state => context.setValue(action.oid!, !state?.val))
                        .catch((error: unknown) => console.warn(`energyflow: cannot toggle: ${String(error)}`));
                }
                break;

            case 'setValue':
                if (action.oid) {
                    context.setValue(action.oid, action.value ?? null);
                }
                break;

            case 'url':
                if (action.url) {
                    if (action.newTab) {
                        window.open(action.url, '_blank', 'noopener,noreferrer');
                    } else {
                        window.location.href = action.url;
                    }
                }
                break;

            case 'view':
                if (action.view) {
                    context.changeView(action.view);
                }
                break;

            default:
                break;
        }
    };

    renderWidgetBody(props: RxRenderWidgetProps): React.JSX.Element {
        super.renderWidgetBody(props);

        const config = this.efConfig;
        const theme = themeFromMui(this.props.context.theme, this.props.context.lang);
        const runtime = computeRuntime(config, oid => this.state.efValues[oid] ?? null, theme);

        const content = (
            <div
                ref={this.efRoot}
                style={{ width: '100%', height: '100%', minHeight: 60, display: 'flex' }}
            >
                {config.nodes.length ? (
                    <EnergyFlowView
                        runtime={runtime}
                        theme={theme}
                        animate={this.state.efAnimate}
                        onNodeClick={this.efOnNodeClick}
                    />
                ) : (
                    <div
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: theme.textSecondary,
                            fontSize: 14,
                            textAlign: 'center',
                            padding: 12,
                        }}
                    >
                        {EnergyFlow.t('widget_not_configured')}
                    </div>
                )}
            </div>
        );

        return this.wrapContent(content, null, { padding: 4 }) as React.JSX.Element;
    }
}
