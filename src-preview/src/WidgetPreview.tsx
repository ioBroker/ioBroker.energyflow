/**
 * A stored diagram the way the widget draws it: the same renderer, live values, and the diagram's own
 * state subscribed -- so a save on the "Admin tab" page, or in a real admin, shows up here at once.
 *
 * The width slider is there because the canvas is a coordinate system scaled into whatever box the
 * host gives it; font sizes and line widths only show their real effect at the sizes a view uses.
 */
import React from 'react';
import { Box, MenuItem, Slider, Stack, TextField, Typography, useTheme } from '@mui/material';

import {
    cachedMax,
    collectOids,
    computeRuntime,
    EnergyFlowView,
    detailTarget,
    emptyConfig,
    needsClock,
    parseStoredDiagram,
    readDetail,
    themeFromMui,
    type EnergyFlowConfig,
} from '@energyflow/core';
import {
    loadDiagram,
    useClock,
    HistoryDialog,
    useDefaultHistory,
    useEnergyToday,
    useHistory,
    useLiveStates,
    useObjectUnits,
    usePersistentState,
    useStoredDiagrams,
    type EditorContext,
} from '@energyflow/editor';

const EMPTY = emptyConfig();

export function WidgetPreview(props: { context: EditorContext; instance: number }): React.JSX.Element {
    const { context, instance } = props;
    const muiTheme = useTheme();
    const { diagrams } = useStoredDiagrams(context.socket, instance);
    const [view, setView] = usePersistentState('energyflow.preview.widget', { id: '', width: 900 });
    const [config, setConfig] = React.useState<{ id: string; config: EnergyFlowConfig | null } | null>(null);

    const selected = diagrams.some(entry => entry.id === view.id) ? view.id : (diagrams[0]?.id ?? '');

    React.useEffect(() => {
        if (!selected) {
            return undefined;
        }
        let cancelled = false;
        loadDiagram(context.socket, selected)
            .then(loaded => !cancelled && setConfig({ id: selected, config: loaded }))
            .catch(() => !cancelled && setConfig({ id: selected, config: null }));

        // Follow saves made elsewhere, as the widget does
        const onChange = (_id: string, state: ioBroker.State | null | undefined): void => {
            if (!cancelled && state) {
                setConfig({ id: selected, config: parseStoredDiagram(state.val) });
            }
        };
        void context.socket.subscribeState(selected, onChange);
        return () => {
            cancelled = true;
            context.socket.unsubscribeState(selected, onChange);
        };
    }, [selected, context.socket]);

    const current = config && config.id === selected ? config.config : null;
    const oids = React.useMemo(() => (current ? collectOids(current) : []), [current]);
    const { values, times, raw } = useLiveStates(context.socket, oids);
    const now = useClock(!!current && needsClock(current));
    const historyInstance = useDefaultHistory(context.socket);
    const history = useHistory(context.socket, current ?? EMPTY, historyInstance);
    const energy = useEnergyToday(context.socket, current ?? EMPTY, historyInstance);
    const [detail, setDetail] = React.useState<{ nodeId: string } | null>(null);
    const units = useObjectUnits(context.socket, oids);
    const flowTheme = React.useMemo(() => themeFromMui(muiTheme, context.lang), [muiTheme, context.lang]);
    const runtime = React.useMemo(
        () =>
            current
                ? computeRuntime(current, values, flowTheme, {
                      units,
                      maxima: cachedMax,
                      times,
                      now,
                      history,
                      raw,
                      energy,
                  })
                : null,
        [current, values, flowTheme, units, times, now, history, raw, energy],
    );

    return (
        <Stack sx={{ height: '100%' }}>
            <Stack
                direction="row"
                spacing={3}
                sx={{ alignItems: 'center', px: 2, py: 1 }}
            >
                <TextField
                    select
                    variant="standard"
                    label="Diagram"
                    value={selected}
                    onChange={event => setView(previous => ({ ...previous, id: event.target.value }))}
                    sx={{ minWidth: 240 }}
                >
                    {diagrams.map(entry => (
                        <MenuItem
                            key={entry.id}
                            value={entry.id}
                        >
                            {entry.name}
                        </MenuItem>
                    ))}
                </TextField>
                <Typography variant="caption">Width {view.width}px</Typography>
                <Slider
                    size="small"
                    min={200}
                    max={1800}
                    step={10}
                    value={view.width}
                    onChange={(_event, width) => setView(previous => ({ ...previous, width }))}
                    sx={{ maxWidth: 320 }}
                />
            </Stack>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
                {runtime ? (
                    <Box
                        sx={{
                            width: view.width,
                            // The widget's box in a view: fixed width, height from the aspect ratio
                            aspectRatio: `${runtime.config.canvas.w} / ${runtime.config.canvas.h}`,
                            display: 'flex',
                            outline: theme => `1px dashed ${theme.palette.divider}`,
                        }}
                    >
                        <EnergyFlowView
                            runtime={runtime}
                            theme={flowTheme}
                            animate
                            // The click actions a widget offers; the preview does the detail view
                            onNodeClick={node => node.action?.type === 'chart' && setDetail({ nodeId: node.id })}
                        />
                    </Box>
                ) : (
                    <Typography color="text.secondary">
                        {diagrams.length ? '…' : 'No stored diagram yet -- create one on the "Admin tab" page.'}
                    </Typography>
                )}
            </Box>
            {(() => {
                const node = detail && current ? current.nodes.find(item => item.id === detail.nodeId) : undefined;
                const target = node && current ? detailTarget(node, current, units) : null;
                return (
                    <HistoryDialog
                        open={!!target}
                        onClose={() => setDetail(null)}
                        title={node?.label || node?.id || ''}
                        color={runtime?.nodeById[node?.id ?? '']?.color ?? flowTheme.text}
                        theme={flowTheme}
                        unit={target?.unit}
                        t={context.t}
                        load={(start, end, step) =>
                            target && historyInstance
                                ? readDetail(
                                      (oid, options) =>
                                          context.socket.getHistory(oid, {
                                              instance: historyInstance,
                                              aggregate: 'average',
                                              ignoreNull: true,
                                              ...options,
                                          }),
                                      target,
                                      start,
                                      end,
                                      step,
                                  )
                                : Promise.resolve([])
                        }
                    />
                );
            })()}
        </Stack>
    );
}
