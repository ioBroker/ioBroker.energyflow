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
import { ContentCopy, Download } from '@mui/icons-material';

import {
    importEnergiefluss,
    isEnergiefluss,
    normalizeConfig,
    type EnergyFlowConfig,
    type ImportResult,
} from '@energyflow/core';

import type { EditorContext } from './types';

export interface JsonDialogProps {
    open: boolean;
    config: EnergyFlowConfig;
    onClose: () => void;
    onApply: (config: EnergyFlowConfig) => void;
    context: EditorContext;
}

/** What the text in the box turned out to be */
type Parsed =
    | { kind: 'own'; config: EnergyFlowConfig }
    | { kind: 'energiefluss'; result: ImportResult }
    | { kind: 'error'; message: string };

function parseText(text: string, t: EditorContext['t']): Parsed {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }

    if (!value || typeof value !== 'object') {
        return { kind: 'error', message: t('json_not_an_object') };
    }

    // Checked before the own format, because an energiefluss document has none of our keys and would
    // otherwise normalise into an empty diagram without anybody noticing
    if (isEnergiefluss(value)) {
        const result = importEnergiefluss(value);
        if (!result.config.nodes.length) {
            return { kind: 'error', message: t('json_ef_nothing') };
        }
        return { kind: 'energiefluss', result };
    }

    const config = normalizeConfig(value);
    if (!config.nodes.length && (value as EnergyFlowConfig).nodes?.length) {
        // Everything was dropped, which means none of the nodes had an id
        return { kind: 'error', message: t('json_no_valid_nodes') };
    }
    return { kind: 'own', config };
}

/** The dialog body, mounted fresh each time so the text starts from the current diagram */
function JsonDialogBody(props: Omit<JsonDialogProps, 'open'>): React.JSX.Element {
    const { config, onClose, onApply, context } = props;
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

    const download = (): void => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'energyflow.json';
        link.click();
        URL.revokeObjectURL(url);
    };

    const apply = (): void => {
        if (parsed.kind === 'own') {
            onApply(parsed.config);
            onClose();
        } else if (parsed.kind === 'energiefluss') {
            onApply(parsed.result.config);
            onClose();
        }
    };

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
                ) : parsed.kind === 'energiefluss' ? (
                    <ImportSummary
                        result={parsed.result}
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
                    {parsed.kind === 'energiefluss' ? context.t('json_ef_apply') : context.t('json_apply')}
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
function ImportSummary(props: { result: ImportResult; context: EditorContext }): React.JSX.Element {
    const { result, context } = props;
    const { stats, warnings } = result;

    const grouped = React.useMemo(() => {
        const byCode = new Map<string, { count: number; first: string }>();
        for (const warning of warnings) {
            const entry = byCode.get(warning.code);
            if (entry) {
                entry.count++;
            } else {
                byCode.set(warning.code, { count: 1, first: warning.detail });
            }
        }
        return [...byCode.entries()];
    }, [warnings]);

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
