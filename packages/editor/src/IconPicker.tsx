/**
 * Choosing the picture in a node.
 *
 * Offers the built-in set grouped by what the icons mean, plus a free field for a URL or a data URI,
 * because no set of twenty icons covers everybody's heat pump.
 */
import React from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';

import { BUILTIN_ICONS, ICON_CATEGORIES, renderBuiltinIcon } from '@flow/core';

import type { EditorContext } from './types';

export interface IconPickerDialogProps {
    open: boolean;
    value: string | undefined;
    onClose: () => void;
    onChange: (icon: string | undefined) => void;
    context: EditorContext;
    /** Colour the previews are drawn in, so the choice is made in the colour it will have */
    color: string;
}

/** One icon in its own little SVG, so the grid can lay them out as ordinary boxes */
function IconPreview(props: { name: string; color: string; size?: number }): React.JSX.Element {
    const size = props.size || 30;
    return (
        <svg
            viewBox="0 0 40 40"
            width={size}
            height={size}
            style={{ display: 'block' }}
        >
            {renderBuiltinIcon(props.name, { x: 20, y: 20, size: 34, color: props.color })}
        </svg>
    );
}

/**
 * The contents of the dialog.
 *
 * Split off so that the free-text field can simply be initialised from the current icon: the parent
 * mounts this with a `key` that changes whenever the dialog opens on another value, and React gives
 * the field its initial state again. The alternative -- keeping the state in the parent and syncing it
 * from an effect -- is a render, a paint and then a second render with the real value.
 */
function IconPickerBody(props: Omit<IconPickerDialogProps, 'open'>): React.JSX.Element {
    const { value, onClose, onChange, context, color } = props;
    // A value that is not one of the built-in names is a URL, and belongs in the free field
    const [custom, setCustom] = React.useState(value && !BUILTIN_ICONS[value] ? value : '');

    return (
        <>
            <DialogTitle>{context.t('icon_pick')}</DialogTitle>
            <DialogContent>
                {ICON_CATEGORIES.map(category => {
                    const names = Object.keys(BUILTIN_ICONS).filter(
                        name => BUILTIN_ICONS[name].category === category.id,
                    );
                    if (!names.length) {
                        return null;
                    }
                    return (
                        <Box
                            key={category.id}
                            sx={{ mb: 2 }}
                        >
                            <Typography
                                variant="overline"
                                color="text.secondary"
                            >
                                {context.t(category.label)}
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                                {names.map(name => (
                                    <Tooltip
                                        key={name}
                                        title={context.t(BUILTIN_ICONS[name].label)}
                                    >
                                        <Button
                                            onClick={() => {
                                                onChange(name);
                                                onClose();
                                            }}
                                            sx={{
                                                minWidth: 52,
                                                height: 52,
                                                border: theme =>
                                                    `2px solid ${value === name ? theme.palette.primary.main : theme.palette.divider}`,
                                            }}
                                        >
                                            <IconPreview
                                                name={name}
                                                color={color}
                                            />
                                        </Button>
                                    </Tooltip>
                                ))}
                            </Box>
                        </Box>
                    );
                })}

                <Divider sx={{ my: 2 }} />

                <TextField
                    fullWidth
                    variant="standard"
                    size="small"
                    label={context.t('icon_custom')}
                    helperText={context.t('icon_custom_hint')}
                    value={custom}
                    onChange={event => setCustom(event.target.value)}
                />
            </DialogContent>
            <DialogActions>
                <Button
                    color="inherit"
                    onClick={() => {
                        // An empty string, not undefined: undefined would hand the node back the icon
                        // its kind implies, which is the opposite of what this button says
                        onChange('');
                        onClose();
                    }}
                >
                    {context.t('icon_none')}
                </Button>
                <Button onClick={onClose}>{context.t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!custom.trim()}
                    onClick={() => {
                        onChange(custom.trim());
                        onClose();
                    }}
                >
                    {context.t('apply')}
                </Button>
            </DialogActions>
        </>
    );
}

export function IconPickerDialog(props: IconPickerDialogProps): React.JSX.Element {
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            fullWidth
            maxWidth="sm"
        >
            {props.open ? (
                <IconPickerBody
                    key={props.value ?? ''}
                    {...props}
                />
            ) : null}
        </Dialog>
    );
}

export { IconPreview };
export default IconPickerDialog;
