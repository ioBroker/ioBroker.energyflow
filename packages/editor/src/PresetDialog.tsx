/**
 * Picking what flows, and then a starting layout.
 *
 * The medium comes first because it decides the rest: the unit, the speed of the dots, the words in
 * the designer and which layouts are worth showing. It starts on the medium of the open diagram, so
 * the usual case is still one click on a card.
 *
 * Each card is a real render of the preset with no values bound, which is exactly what the user will
 * see after choosing it. There is no illustration to keep in sync with the code.
 */
import React from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Paper,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';

import {
    buildPreset,
    computeRuntime,
    emptyConfig,
    FlowView,
    MEDIA,
    MEDIUM_IDS,
    PRESETS,
    type FlowConfig,
    type FlowTheme,
    type MediumId,
} from '@flow/core';

import { MEDIUM_ICONS } from './optionIcons';
import type { EditorContext } from './types';
import { AutoFixHigh } from '@mui/icons-material';

export interface PresetDialogProps {
    open: boolean;
    onClose: () => void;
    onPick: (config: FlowConfig) => void;
    context: EditorContext;
    theme: FlowTheme;
    /** Warn that the current diagram will be replaced */
    hasContent: boolean;
    /** What the current diagram carries; the dialog opens on it */
    medium: MediumId;
    /** Open the assistant that builds a diagram from the installation's states */
    onWizard?: () => void;
}

/**
 * The contents, mounted only while the dialog is open: the chosen medium is state, and it has to
 * start at the diagram's own every time the dialog is opened, not once in the life of the editor.
 */
function PresetBody(props: PresetDialogProps): React.JSX.Element {
    const { onClose, onPick, context, theme, hasContent } = props;
    const [medium, setMedium] = React.useState<MediumId>(props.medium);

    /** The layouts of the chosen medium, and the empty one at the end, which belongs to all of them */
    const cards = React.useMemo(
        () =>
            PRESETS.filter(info => info.id === 'empty' || info.medium === medium).map(info => ({
                info,
                config: info.id === 'empty' ? emptyConfig(medium) : buildPreset(info.id, key => context.t(key)),
            })),
        [context, medium],
    );

    return (
        <>
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
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block' }}
                >
                    {context.t('insp_medium')}
                </Typography>
                <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={medium}
                    onChange={(_event, value: MediumId | null) => value && setMedium(value)}
                    sx={{ mb: 2 }}
                >
                    {MEDIUM_IDS.map(id => (
                        <ToggleButton
                            key={id}
                            value={id}
                            sx={{ gap: 0.75, '& .MuiSvgIcon-root': { fontSize: 18 } }}
                        >
                            {MEDIUM_ICONS[id]}
                            {context.t(MEDIA[id].label)}
                        </ToggleButton>
                    ))}
                </ToggleButtonGroup>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                        gap: 2,
                    }}
                >
                    {cards.map(({ info, config }) => (
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
                                    <FlowView
                                        runtime={computeRuntime(config, () => null, theme)}
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
        </>
    );
}

export function PresetDialog(props: PresetDialogProps): React.JSX.Element {
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            fullWidth
            maxWidth="lg"
        >
            {props.open ? <PresetBody {...props} /> : null}
        </Dialog>
    );
}

export default PresetDialog;
