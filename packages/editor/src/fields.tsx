/**
 * The small form controls the inspector is built from.
 *
 * They exist for one reason: a numeric field in a diagram editor must be able to be *empty*. An
 * empty width means "use the default for this shape", and a field that turns that into 0 the moment
 * it is focused would silently collapse the node. So every number here reports `undefined` for an
 * empty input and keeps what the user typed while they are typing it.
 */
import React from 'react';
import {
    Box,
    Checkbox,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { ColorPicker } from '@iobroker/gui-components';

export interface NumberFieldProps {
    label: string;
    value: number | undefined;
    onChange: (value: number | undefined) => void;
    /** Shown in grey while the field is empty, to say what the default is */
    placeholder?: string | number;
    min?: number;
    max?: number;
    disabled?: boolean;
    helperText?: string;
}

export function NumberField(props: NumberFieldProps): React.JSX.Element {
    /**
     * While the field has focus the text is owned by the input, not by the document. Without that,
     * typing "-" or "0." is impossible: neither is a number, so the document would not change, and
     * the controlled value would immediately overwrite the character.
     */
    const [draft, setDraft] = React.useState<string | null>(null);

    const commit = (raw: string): void => {
        if (raw.trim() === '') {
            props.onChange(undefined);
            return;
        }
        const parsed = Number(raw.replace(',', '.'));
        if (Number.isNaN(parsed)) {
            return;
        }
        let clamped = parsed;
        if (props.min !== undefined && clamped < props.min) {
            clamped = props.min;
        }
        if (props.max !== undefined && clamped > props.max) {
            clamped = props.max;
        }
        props.onChange(clamped);
    };

    return (
        <TextField
            variant="standard"
            size="small"
            fullWidth
            disabled={props.disabled}
            label={props.label}
            helperText={props.helperText}
            placeholder={props.placeholder === undefined ? undefined : `${props.placeholder}`}
            value={draft ?? props.value ?? ''}
            onFocus={() => setDraft(props.value === undefined ? '' : `${props.value}`)}
            onChange={event => {
                setDraft(event.target.value);
                commit(event.target.value);
            }}
            onBlur={() => setDraft(null)}
            slotProps={{ htmlInput: { inputMode: 'decimal' }, inputLabel: { shrink: true } }}
        />
    );
}

export interface TextFieldRowProps {
    label: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    placeholder?: string;
    helperText?: string;
    error?: boolean;
}

export function TextFieldRow(props: TextFieldRowProps): React.JSX.Element {
    return (
        <TextField
            variant="standard"
            size="small"
            fullWidth
            label={props.label}
            value={props.value ?? ''}
            placeholder={props.placeholder}
            helperText={props.helperText}
            error={props.error}
            onChange={event => props.onChange(event.target.value === '' ? undefined : event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
        />
    );
}

export interface SelectRowProps<T extends string> {
    label: string;
    value: T | undefined;
    options: { value: T; label: string }[];
    onChange: (value: T) => void;
    /** Label of an extra entry that reports `undefined` */
    emptyLabel?: string;
    disabled?: boolean;
}

export function SelectRow<T extends string>(props: SelectRowProps<T>): React.JSX.Element {
    return (
        <FormControl
            variant="standard"
            size="small"
            fullWidth
            disabled={props.disabled}
        >
            <InputLabel shrink>{props.label}</InputLabel>
            <Select
                displayEmpty
                value={props.value ?? ''}
                onChange={event => props.onChange(event.target.value as T)}
            >
                {props.emptyLabel !== undefined ? <MenuItem value="">{props.emptyLabel}</MenuItem> : null}
                {props.options.map(option => (
                    <MenuItem
                        key={option.value}
                        value={option.value}
                    >
                        {option.label}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
}

export interface CheckRowProps {
    label: string;
    value: boolean | undefined;
    onChange: (value: boolean) => void;
}

export function CheckRow(props: CheckRowProps): React.JSX.Element {
    return (
        <FormControlLabel
            sx={{ ml: 0 }}
            control={
                <Checkbox
                    size="small"
                    checked={!!props.value}
                    onChange={event => props.onChange(event.target.checked)}
                />
            }
            label={<Typography variant="body2">{props.label}</Typography>}
        />
    );
}

export interface ColorRowProps {
    /** Must be unique on the page -- `ColorPicker` uses it as the id of its text field */
    id: string;
    label: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    /** Shown as the swatch while nothing is set */
    fallback?: string;
}

export function ColorRow(props: ColorRowProps): React.JSX.Element {
    return (
        <Box sx={{ mt: 1 }}>
            <ColorPicker
                id={props.id}
                label={props.label}
                value={props.value ?? ''}
                // Hex only: the renderer derives the tint and the idle colour from the accent, and it
                // can only do that arithmetic on a notation it can parse
                format="hex"
                noAlpha
                customPalette={props.fallback ? [props.fallback] : undefined}
                onChange={value => props.onChange(value || undefined)}
            />
        </Box>
    );
}

/** A labelled group inside the inspector */
export function Section(props: { title: string; children: React.ReactNode }): React.JSX.Element {
    return (
        <Box sx={{ mb: 2 }}>
            <Typography
                variant="overline"
                sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.6, mb: 0.5 }}
            >
                {props.title}
            </Typography>
            {props.children}
        </Box>
    );
}

/** Two controls next to each other, which is how most of the numeric pairs are laid out */
export function Row(props: { children: React.ReactNode }): React.JSX.Element {
    return <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>{props.children}</Box>;
}
