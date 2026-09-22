/**
 * Picking a starting layout.
 *
 * Each card is a real render of the preset with no values bound, which is exactly what the user will
 * see after choosing it. There is no illustration to keep in sync with the code.
 */
import React from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Typography } from '@mui/material';

import {
    buildPreset,
    computeRuntime,
    EnergyFlowView,
    PRESETS,
    type EnergyFlowConfig,
    type EnergyFlowTheme,
} from '@energyflow/core';

import type { EditorContext } from './types';
import { AutoFixHigh } from '@mui/icons-material';

export interface PresetDialogProps {
    open: boolean;
    onClose: () => void;
    onPick: (config: EnergyFlowConfig) => void;
    context: EditorContext;
    theme: EnergyFlowTheme;
    /** Warn that the current diagram will be replaced */
    hasContent: boolean;
    /** Open the assistant that builds a diagram from the installation's states */
    onWizard?: () => void;
}

export function PresetDialog(props: PresetDialogProps): React.JSX.Element {
    const { open, onClose, onPick, context, theme, hasContent } = props;

    const previews = React.useMemo(
        () =>
            PRESETS.map(info => {
                const config = buildPreset(info.id, key => context.t(key));
                return { info, config, runtime: computeRuntime(config, () => null, theme) };
            }),
        [context, theme],
    );

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="lg"
        >
            <DialogTitle>{context.t('preset_title')}</DialogTitle>
            <DialogContent>
                {hasContent ? (
                    <Typography
                        variant="body2"
                        color="warning.main"
                        sx={{ mb: 2 }}
                    >
                        {context.t('preset_replace_warning')}
                    </Typography>
                ) : null}
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                        gap: 2,
                    }}
                >
                    {previews.map(({ info, config, runtime }) => (
                        <Paper
                            key={info.id}
                            variant="outlined"
                            sx={{
                                p: 1.5,
                                cursor: 'pointer',
                                transition: 'border-color 120ms',
                                '&:hover': { borderColor: 'primary.main' },
                            }}
                            onClick={() => {
                                onPick(config);
                                onClose();
                            }}
                        >
                            <Box sx={{ height: 150, mb: 1 }}>
                                {config.nodes.length ? (
                                    <EnergyFlowView
                                        runtime={runtime}
                                        theme={theme}
                                        animate={false}
                                    />
                                ) : (
                                    <Box
                                        sx={{
                                            height: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'text.disabled',
                                            border: theme2 => `1px dashed ${theme2.palette.divider}`,
                                        }}
                                    >
                                        {context.t('preset_empty_preview')}
                                    </Box>
                                )}
                            </Box>
                            <Typography variant="subtitle2">{context.t(info.label)}</Typography>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                            >
                                {context.t(info.description)}
                            </Typography>
                        </Paper>
                    ))}
                </Box>
            </DialogContent>
            <DialogActions>
                {props.onWizard ? (
                    <Button
                        startIcon={<AutoFixHigh />}
                        onClick={props.onWizard}
                        sx={{ mr: 'auto' }}
                    >
                        {context.t('wizard_open')}
                    </Button>
                ) : null}
                <Button onClick={onClose}>{context.t('cancel')}</Button>
            </DialogActions>
        </Dialog>
    );
}

export default PresetDialog;
