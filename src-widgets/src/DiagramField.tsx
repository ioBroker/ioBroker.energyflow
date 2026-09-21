/**
 * The single widget attribute that holds the whole diagram.
 *
 * vis-2 renders one custom React component for a `type: 'custom'` field, and this is it: a button that
 * opens the designer, plus a one-line summary so the attribute panel says something useful while the
 * designer is closed.
 *
 * **This module is loaded lazily** (see `EnergyFlow.tsx`), and that is not an optimisation to be
 * undone: everything the designer needs hangs off it, including the state picker and the colour
 * picker of `@iobroker/gui-components`. vis-2 does not share that package, so it is bundled -- 620 kB
 * of it. A view that only *displays* diagrams must never download that, and it only stays out of the
 * runtime chunk as long as nothing in the eager path imports this file or `@iobroker/gui-components`.
 *
 * The alternative -- one attribute per property, the way `Distribution` in `vis-2-widgets-energy` does
 * it -- is what caps that widget at a fixed number of node slots and gives it 80 flat fields. Here the
 * whole document is one value, and the number of nodes is whatever the user drew.
 */
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Dashboard } from '@mui/icons-material';
import { I18n } from '@iobroker/gui-components';

import { computeRuntime, normalizeConfig, themeFromMui, type EnergyFlowConfig } from '@energyflow/core';
import { EnergyFlowEditor, type EditorContext } from '@energyflow/editor';
import type { RxWidgetInfoCustomComponentProperties, WidgetData } from '@iobroker/types-vis-2';

import { I18N_PREFIX } from './Generic';

export interface DiagramFieldProps {
    /** Name of the attribute inside the widget data */
    name: string;
    data: WidgetData;
    setData: (data: WidgetData) => void;
    /** What vis-2 hands to a custom attribute component */
    visContext: RxWidgetInfoCustomComponentProperties['context'];
}

/** Translate a key of this widget set. vis-2 stores them prefixed, see `translations.ts`. */
function translate(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

export function DiagramField(props: DiagramFieldProps): React.JSX.Element {
    const { name, data, setData, visContext } = props;
    const [open, setOpen] = React.useState(false);

    const config = React.useMemo(() => normalizeConfig(data[name]), [data, name]);

    /**
     * A summary of what is configured, drawn with the same renderer as the widget. It is cheap (no
     * subscriptions, every value unknown) and it answers the question the attribute panel otherwise
     * leaves open: is there a diagram in this widget at all?
     */
    const summary = React.useMemo(() => {
        const theme = themeFromMui(visContext.theme);
        const runtime = computeRuntime(config, () => null, theme);
        const unbound = runtime.edges.filter(edge => {
            const source = edge.edge.value as { oid?: string };
            return !source?.oid && !('expr' in (edge.edge.value || {})) && !('const' in (edge.edge.value || {}));
        }).length;
        return { nodes: runtime.nodes.length, edges: runtime.edges.length, unbound };
    }, [config, visContext.theme]);

    const editorContext: EditorContext = React.useMemo(
        () => ({
            socket: visContext.socket,
            theme: visContext.theme,
            themeType: visContext.theme?.palette?.mode === 'dark' ? 'dark' : 'light',
            lang: I18n.getLanguage(),
            t: translate,
        }),
        [visContext.socket, visContext.theme],
    );

    const save = (next: EnergyFlowConfig): void => setData({ ...data, [name]: next });

    return (
        <Box sx={{ width: '100%' }}>
            <Button
                fullWidth
                variant="contained"
                startIcon={<Dashboard />}
                onClick={() => setOpen(true)}
            >
                {translate('field_open_designer')}
            </Button>

            <Stack
                sx={{ mt: 1 }}
                spacing={0.25}
            >
                <Typography
                    variant="caption"
                    color="text.secondary"
                >
                    {translate('insp_counts', summary.nodes, summary.edges)}
                </Typography>
                {summary.unbound ? (
                    <Typography
                        variant="caption"
                        color="warning.main"
                    >
                        {translate('field_unbound_edges', summary.unbound)}
                    </Typography>
                ) : null}
            </Stack>

            {open ? (
                <EnergyFlowEditor
                    open={open}
                    value={data[name]}
                    onClose={() => setOpen(false)}
                    onSave={save}
                    context={editorContext}
                    title={translate('editor_title')}
                />
            ) : null}
        </Box>
    );
}

export default DiagramField;
