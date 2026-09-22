/**
 * The document as text.
 *
 * Import and export in one dialog, because they are the same thing seen from two sides: it opens with
 * the current diagram in it, and applying whatever is in the box replaces the diagram. That is how a
 * ready-made example gets in, how a diagram gets copied to a second widget, and how somebody fixes by
 * hand the one thing the inspector has no field for.
 *
 * It also accepts a configuration of `iobroker.energiefluss-erweitert` -- paste the content of that
 * adapter's `configuration` state and it is recognised and converted, with a summary of what could not
 * be carried over. There is no separate import dialog because there is no separate question to ask:
 * whatever is in the box, this turns it into a diagram or explains why it cannot.
 *
 * Nothing is applied that does not parse: the error appears under the box while typing, and the apply
 * button stays disabled until it is gone.
 */
import React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { ContentCopy, Download, FolderOpen } from '@mui/icons-material';

import { readImport, type EnergyFlowConfig, type ImportItem } from '@energyflow/core';

import { downloadText, pickFiles } from './fileTransfer';
import { importErrorText } from './importMessages';
import type { EditorContext } from './types';

export interface JsonDialogProps {
    open: boolean;
    config: EnergyFlowConfig;
    onClose: () => void;
    onApply: (config: EnergyFlowConfig) => void;
    context: EditorContext;
    /** Suggested name of the downloaded file; the diagram's name makes a better one than a constant */
    fileName?: string;
}

/** What the text in the box turned out to be */
type Parsed = { kind: 'item'; item: ImportItem } | { kind: 'error'; message: string };

/**
 * Read the box with the same reader the admin tab uses for files, so a text that imports in one place
 * imports in the other. Only a single diagram fits here -- the box replaces the diagram being edited --
 * so a set of several is sent to the admin tab, where each becomes a diagram of its own.
 */
function parseText(text: string, t: EditorContext['t']): Parsed {
    const result = readImport(text, '');
    if ('error' in result) {
        return { kind: 'error', message: importErrorText(result.error, result.detail, t) };
    }
    if (result.items.length > 1) {
        return { kind: 'error', message: t('json_bundle_many', result.items.length) };
    }
    return { kind: 'item', item: result.items[0] };
}

/** The dialog body, mounted fresh each time so the text starts from the current diagram */
function JsonDialogBody(props: Omit<JsonDialogProps, 'open'>): React.JSX.Element {
    const { config, onClose, onApply, context, fileName } = props;
    const [text, setText] = React.useState(() => JSON.stringify(config, null, 4));
    const [copied, setCopied] = React.useState(false);

    /** The parse result, recomputed on every keystroke */
    const parsed = React.useMemo(() => parseText(text, context.t), [text, context]);

    const error = parsed.kind === 'error' ? parsed.message : null;

    const copy = (): void => {
        // `navigator.clipboard` needs a secure context; a plain http ioBroker is not one, so the
        // failure has to be survivable -- the text is on screen and can be selected either way
        navigator.clipboard
            ?.writeText(text)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => setCopied(false));
    };

    const download = (): void => downloadText(fileName || 'energyflow.json', text);

    /** Put a file's content into the box; applying it is still a separate, deliberate step */
    const openFile = (): void => {
        pickFiles()
            .then(files => {
                if (files[0]) {
                    setText(files[0].text);
                }
            })
            .catch((caught: unknown) => console.warn(`energyflow: cannot read the file: ${String(caught)}`));
    };

    const apply = (): void => {
        if (parsed.kind === 'item') {
            onApply(parsed.item.config);
            onClose();
        }
    };

    const fromEnergiefluss = parsed.kind === 'item' && parsed.item.source === 'energiefluss';

    return (
        <>
            <DialogTitle>{context.t('json_title')}</DialogTitle>
            <DialogContent>
                <Stack
                    direction="row"
                    spacing={1}
                    sx={{ mb: 1, alignItems: 'center' }}
                >
                    <Tooltip title={context.t(copied ? 'json_copied' : 'json_copy')}>
                        <IconButton
                            size="small"
                            onClick={copy}
                            color={copied ? 'success' : 'default'}
                        >
                            <ContentCopy fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={context.t('json_download')}>
                        <IconButton
                            size="small"
                            onClick={download}
                        >
                            <Download fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={context.t('json_open_file')}>
                        <IconButton
                            size="small"
                            onClick={openFile}
                        >
                            <FolderOpen fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>

                <TextField
                    fullWidth
                    multiline
                    minRows={14}
                    maxRows={22}
                    value={text}
                    error={!!error}
                    onChange={event => setText(event.target.value)}
                    slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 12 }, spellCheck: false } }}
                />

                {error ? (
                    <Alert
                        severity="error"
                        sx={{ mt: 1 }}
                    >
                        {error}
                    </Alert>
                ) : parsed.kind === 'item' && fromEnergiefluss ? (
                    <ImportSummary
                        item={parsed.item}
                        context={context}
                    />
                ) : (
                    <Alert
                        severity="info"
                        sx={{ mt: 1 }}
                    >
                        {context.t('json_hint')}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{context.t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!!error}
                    onClick={apply}
                >
                    {fromEnergiefluss ? context.t('json_ef_apply') : context.t('json_apply')}
                </Button>
            </DialogActions>
        </>
    );
}

/**
 * What the conversion produced and what it had to leave behind.
 *
 * The warnings are grouped by kind rather than listed one by one: a diagram with twenty elements
 * produces twenty near-identical lines otherwise, and the thing worth reading is *which* kinds of
 * thing did not survive, with an example of each.
 */
export function ImportSummary(props: { item: ImportItem; context: EditorContext }): React.JSX.Element {
    const { item, context } = props;
    const { warnings } = item;
    const stats = item.stats ?? {
        nodes: item.config.nodes.length,
        edges: item.config.edges.length,
        merged: 0,
        bindings: 0,
    };

    const grouped = React.useMemo(() => {
        const byCode = new Map<string, { count: number; first: string }>();
        for (const warning of warnings) {
            const entry = byCode.get(warning.code);
            if (entry) {
                entry.count++;
            } else {
                // `icon-unmapped` becomes `json_ef_warn_icon_unmapped`; every code has a sentence in
                // the English dictionary, which is what a language without one falls back to
                const key = `json_ef_warn_${warning.code.replace(/-/g, '_')}`;
                byCode.set(warning.code, { count: 1, first: context.t(key, ...warning.args) });
            }
        }
        return [...byCode.entries()];
    }, [warnings, context]);

    return (
        <Alert
            severity={warnings.length ? 'warning' : 'success'}
            sx={{ mt: 1 }}
        >
            <AlertTitle>{context.t('json_ef_detected')}</AlertTitle>
            <Typography variant="body2">
                {context.t('json_ef_stats', stats.nodes, stats.edges, stats.merged, stats.bindings)}
            </Typography>
            {grouped.length ? (
                <Box
                    component="ul"
                    sx={{ pl: 2, mt: 1, mb: 0 }}
                >
                    {grouped.map(([code, entry]) => (
                        <Typography
                            component="li"
                            variant="caption"
                            key={code}
                        >
                            {entry.count > 1 ? `${entry.count}x ` : ''}
                            {entry.first}
                        </Typography>
                    ))}
                </Box>
            ) : null}
        </Alert>
    );
}

export function JsonDialog(props: JsonDialogProps): React.JSX.Element {
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            fullWidth
            maxWidth="md"
        >
            {props.open ? <JsonDialogBody {...props} /> : null}
        </Dialog>
    );
}

export default JsonDialog;
