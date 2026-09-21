/**
 * The designer, as a `jsonConfig` custom component.
 *
 * This is how the diagram editor gets into the device manager -- and into **any adapter's admin
 * configuration**, because both are the same form renderer: `@iobroker/json-config`. A host can only
 * put foreign UI into that form through an item of `type: 'custom'`, which resolves the `url`,
 * registers it as a federation remote, loads the module named in `name` and renders the export it
 * points at. `EnergyFlowDm.getConfigSchema()` holds the device-manager half of that contract; the
 * README documents the snippet for an adapter's own `jsonConfig.json`.
 *
 * The props are whatever `ConfigGeneric` passes down, plus the flattened `socket` / `theme` /
 * `themeType` that `ConfigCustom` adds. The two that matter:
 *
 * - `data` is the surrounding object (a widget's settings, or an adapter's `native`) and `attr` the
 *   key of this item
 * - `onChange(attr, value)` writes the value back and marks the form dirty, which is what makes the
 *   host's save button light up
 */
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Dashboard } from '@mui/icons-material';
import { I18n, type Connection, type IobTheme, type ThemeType } from '@iobroker/gui-components';
import type { ConfigGenericProps } from '@iobroker/json-config';

import { computeRuntime, normalizeConfig, themeFromMui, type EnergyFlowConfig } from '@energyflow/core';
import { EnergyFlowEditor, type EditorContext } from '@energyflow/editor';
import translations, { I18N_PREFIX } from '@energyflow/i18n';

/** What `ConfigCustom` adds on top of the generic item props */
interface DesignerProps extends ConfigGenericProps {
    socket: Connection;
    theme: IobTheme;
    themeType: ThemeType;
}

/**
 * Register this adapter's dictionary, once.
 *
 * In the device manager the plugin loader has already done it -- it loads `./translations` before it
 * loads the widget. In an adapter's admin configuration **nothing does**, and without this the whole
 * designer renders raw keys like `energyflow_insp_node`. So the component brings its own words and
 * does not depend on how the host got here.
 *
 * `extendTranslations` rewrites the object it is handed (it consumes `prefix` and prefixes every key),
 * so it gets a copy: the dictionary is a shared module, and the vis-2 side registers the same one.
 */
let dictionaryRegistered = false;

function ensureTranslations(): void {
    if (dictionaryRegistered) {
        return;
    }
    dictionaryRegistered = true;
    try {
        const copy: Record<string, unknown> = {};
        for (const [language, words] of Object.entries(translations)) {
            copy[language] = typeof words === 'string' ? words : { ...(words as Record<string, string>) };
        }
        I18n.extendTranslations(copy);
    } catch (error) {
        console.warn(`energyflow: cannot register translations: ${String(error)}`);
    }
}

ensureTranslations();

function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

export function Designer(props: DesignerProps): React.JSX.Element {
    const { data, attr, onChange, socket, theme, themeType } = props;
    const [open, setOpen] = React.useState(false);

    // `attr` is the key of this item in the schema; falling back to 'diagram' keeps the component
    // usable if it is ever embedded under a different name
    const key = attr || 'diagram';
    const stored = (data as Record<string, unknown> | undefined)?.[key];

    const config = React.useMemo(() => normalizeConfig(stored), [stored]);

    /** A count, so the dialog says whether there is a diagram at all while the designer is closed */
    const summary = React.useMemo(() => {
        const runtime = computeRuntime(config, () => null, themeFromMui(theme));
        return { nodes: runtime.nodes.length, edges: runtime.edges.length };
    }, [config, theme]);

    const editorContext: EditorContext = React.useMemo(
        () => ({
            socket,
            theme,
            themeType,
            lang: I18n.getLanguage(),
            t,
        }),
        [socket, theme, themeType],
    );

    const save = (next: EnergyFlowConfig): void => {
        void onChange(key, next);
    };

    return (
        <Box sx={{ width: '100%' }}>
            <Button
                fullWidth
                variant="contained"
                startIcon={<Dashboard />}
                onClick={() => setOpen(true)}
            >
                {t('field_open_designer')}
            </Button>
            <Stack
                sx={{ mt: 1 }}
                spacing={0.25}
            >
                <Typography
                    variant="caption"
                    color="text.secondary"
                >
                    {t('insp_counts', summary.nodes, summary.edges)}
                </Typography>
            </Stack>

            {open ? (
                <EnergyFlowEditor
                    open={open}
                    value={stored}
                    onClose={() => setOpen(false)}
                    onSave={save}
                    context={editorContext}
                    title={t('editor_title')}
                />
            ) : null}
        </Box>
    );
}

// No default export on purpose: `ConfigCustom` picks the component out of the module namespace by the
// name from the schema (`.../Config/Designer`), and a default export that is a plain object of
// components would break any loader that unwraps `.default` first.
