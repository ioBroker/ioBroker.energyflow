/**
 * The one control a host shows for "which diagram does this widget display".
 *
 * Both hosts need the same thing -- vis-2 in its attribute panel, the device manager in its settings
 * dialog -- so it lives here once and they only wrap it. The value it edits is either a diagram
 * (inline, stored in the widget) or a reference to a diagram stored in the adapter's namespace; see
 * `storage.ts` in the core for why both exist.
 *
 * In the stored mode, the designer opened from here writes to the stored diagram itself: an edit made
 * from a widget and an edit made in the admin tab are the same edit, and every widget that refers to
 * the diagram sees it.
 */
import React from 'react';
import {
    Alert,
    Box,
    Button,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { CloudUpload, Dashboard } from '@mui/icons-material';

import {
    computeRuntime,
    diagramShortId,
    emptyConfig,
    readDiagramAttribute,
    themeFromMui,
    type FlowConfig,
    type FlowConfigRef,
} from '@flow/core';

import { FlowEditor } from './FlowEditor';
import { createDiagram, loadDiagram, saveDiagram, useStoredDiagrams } from './storedDiagrams';
import type { EditorContext } from './types';

export interface DiagramAttributeProps {
    /** What the host stored: a diagram, a reference, a JSON string of either, or nothing */
    value: unknown;
    onChange: (value: FlowConfig | FlowConfigRef) => void;
    context: EditorContext;
    /** Adapter instance whose diagrams are offered; the adapter is a singleton */
    instance?: number;
}

type Mode = 'inline' | 'stored';

export function DiagramAttribute(props: DiagramAttributeProps): React.JSX.Element {
    const { value, onChange, context, instance = 0 } = props;
    const attribute = React.useMemo(() => readDiagramAttribute(value), [value]);
    const ref = 'ref' in attribute ? attribute.ref : null;

    // The mode follows the value, except while the user has switched to "stored" and not picked yet
    const [pendingStored, setPendingStored] = React.useState(false);
    const mode: Mode = ref || pendingStored ? 'stored' : 'inline';

    const [designerOpen, setDesignerOpen] = React.useState(false);
    const [storeName, setStoreName] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const { diagrams, loading, reload } = useStoredDiagrams(context.socket, instance);

    /** The content of the referenced diagram, for the summary and for the designer */
    const [stored, setStored] = React.useState<{ id: string; config: FlowConfig | null } | null>(null);
    React.useEffect(() => {
        if (!ref) {
            return undefined;
        }
        let cancelled = false;
        loadDiagram(context.socket, ref)
            .then(config => {
                if (!cancelled) {
                    setStored({ id: ref, config });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setStored({ id: ref, config: null });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [ref, context.socket]);

    const storedConfig = stored && stored.id === ref ? stored.config : null;
    const shown: FlowConfig | null = 'config' in attribute ? attribute.config : storedConfig;

    const summary = React.useMemo(() => {
        if (!shown) {
            return null;
        }
        const runtime = computeRuntime(shown, () => null, themeFromMui(context.theme));
        return { nodes: runtime.nodes.length, edges: runtime.edges.length };
    }, [shown, context.theme]);

    const refMissing = !!ref && !loading && !diagrams.some(entry => entry.id === ref);

    const switchMode = (next: Mode | null): void => {
        if (!next || next === mode) {
            return;
        }
        if (next === 'stored') {
            setPendingStored(true);
            return;
        }
        setPendingStored(false);
        // Leaving the stored mode keeps what was shown: the referenced diagram becomes an inline copy,
        // rather than the widget suddenly showing nothing
        if (ref) {
            onChange(storedConfig ?? emptyConfig());
        }
    };

    /** Move the inline diagram into the adapter's namespace and point the widget at it */
    const storeCentrally = async (): Promise<void> => {
        if (!('config' in attribute) || !storeName?.trim()) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const id = await createDiagram(context.socket, storeName.trim(), attribute.config, instance);
            reload();
            setStoreName(null);
            onChange({ $ref: id });
        } catch (caught) {
            setError(String(caught));
        } finally {
            setBusy(false);
        }
    };

    const saveFromDesigner = (config: FlowConfig): void => {
        if (!ref) {
            onChange(config);
            return;
        }
        saveDiagram(context.socket, ref, config)
            .then(() => setStored({ id: ref, config }))
            .catch((caught: unknown) => setError(String(caught)));
    };

    return (
        <Box sx={{ width: '100%' }}>
            <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={mode}
                onChange={(_event, next: Mode | null) => switchMode(next)}
                sx={{ mb: 1 }}
            >
                <ToggleButton value="inline">{context.t('attr_mode_inline')}</ToggleButton>
                <ToggleButton value="stored">{context.t('attr_mode_stored')}</ToggleButton>
            </ToggleButtonGroup>

            {mode === 'stored' ? (
                <>
                    {!loading && !diagrams.length ? (
                        <Alert
                            severity="info"
                            sx={{ mb: 1 }}
                        >
                            {context.t('attr_none_stored')}
                        </Alert>
                    ) : (
                        <FormControl
                            fullWidth
                            size="small"
                            variant="standard"
                            sx={{ mb: 1 }}
                        >
                            <InputLabel>{context.t('attr_pick')}</InputLabel>
                            <Select
                                value={ref && !refMissing ? ref : ''}
                                onChange={event => {
                                    const id = String(event.target.value);
                                    if (id) {
                                        setPendingStored(false);
                                        onChange({ $ref: id });
                                    }
                                }}
                            >
                                {diagrams.map(entry => (
                                    <MenuItem
                                        key={entry.id}
                                        value={entry.id}
                                    >
                                        {entry.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    {refMissing ? (
                        <Alert
                            severity="warning"
                            sx={{ mb: 1 }}
                        >
                            {context.t('attr_missing', diagramShortId(ref))}
                        </Alert>
                    ) : null}
                </>
            ) : null}

            <Button
                fullWidth
                variant="contained"
                startIcon={<Dashboard />}
                disabled={mode === 'stored' && (!ref || refMissing)}
                onClick={() => setDesignerOpen(true)}
            >
                {context.t('field_open_designer')}
            </Button>

            <Stack
                sx={{ mt: 1 }}
                spacing={0.5}
            >
                {summary ? (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                    >
                        {context.t('insp_counts', summary.nodes, summary.edges)}
                    </Typography>
                ) : null}

                {mode === 'stored' && ref && !refMissing ? (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                    >
                        {context.t('attr_admin_hint')}
                    </Typography>
                ) : null}

                {mode === 'inline' && summary && summary.nodes > 0 ? (
                    storeName === null ? (
                        <Button
                            size="small"
                            startIcon={<CloudUpload />}
                            onClick={() => setStoreName('')}
                        >
                            {context.t('attr_store')}
                        </Button>
                    ) : (
                        <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'flex-end' }}
                        >
                            <TextField
                                autoFocus
                                fullWidth
                                size="small"
                                variant="standard"
                                label={context.t('attr_store_name')}
                                value={storeName}
                                onChange={event => setStoreName(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                        void storeCentrally();
                                    }
                                }}
                            />
                            <Button
                                size="small"
                                variant="contained"
                                disabled={busy || !storeName.trim()}
                                onClick={() => void storeCentrally()}
                            >
                                {context.t('attr_store_ok')}
                            </Button>
                        </Stack>
                    )
                ) : null}

                {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>

            {designerOpen ? (
                <FlowEditor
                    open
                    value={mode === 'stored' ? storedConfig : 'config' in attribute ? attribute.config : undefined}
                    onClose={() => setDesignerOpen(false)}
                    onSave={saveFromDesigner}
                    context={context}
                    title={
                        mode === 'stored' && ref
                            ? (diagrams.find(entry => entry.id === ref)?.name ?? diagramShortId(ref))
                            : context.t('editor_title')
                    }
                />
            ) : null}
        </Box>
    );
}

export default DiagramAttribute;
