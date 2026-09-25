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
    ButtonBase,
    Checkbox,
    FormControl,
    FormControlLabel,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import { ArrowDropDown, ArrowDropUp } from '@mui/icons-material';
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
    /** What one click on the arrows, or one Up/Down key press, adds or takes away. Default 1. */
    step?: number;
    /**
     * The field counts something: whole numbers only. Without it the arrows follow the number and go
     * in tenths below two, which is right for a threshold and nonsense for a number of decimal places.
     */
    integer?: boolean;
    /**
     * Where the arrows start while the field is empty. Defaults to a numeric placeholder -- but a width
     * whose placeholder says "auto" is still some number of units wide, and that is what the host passes.
     */
    stepFrom?: number;
}

/** Decimal places of a number as written, so 0.18 + 0.1 stays 0.28 and does not turn into 0.28000000000000003 */
function decimalsOf(value: number): number {
    const text = `${value}`;
    const dot = text.indexOf('.');
    return dot < 0 ? 0 : text.length - dot - 1;
}

/** How long a held arrow waits before repeating, and how fast it repeats then */
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 70;

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
        props.onChange(props.integer ? Math.round(clamped) : clamped);
    };

    /**
     * How far one press of an arrow goes. Without a step of its own it follows the number: a limit of
     * 0.1 is reached in tenths, a power of 3000 in whole watts -- an arrow that only ever steps by one
     * cannot reach a tenth at all, and that is what the fields for a price or a threshold are for.
     */
    const stepFor = (from: number): number => props.step ?? (props.integer || Math.abs(from) >= 2 ? 1 : 0.1);

    /** One step from `from`, clamped to the limits */
    const stepped = (from: number, direction: 1 | -1, factor = 1): number => {
        const step = stepFor(from);
        const decimals = Math.max(decimalsOf(step), decimalsOf(from));
        let next = Number((from + direction * step * factor).toFixed(decimals));
        if (props.min !== undefined && next < props.min) {
            next = props.min;
        }
        if (props.max !== undefined && next > props.max) {
            next = props.max;
        }
        return next;
    };

    /** The number the arrows start from: the value, else what the empty field stands for */
    const startValue = (): number => {
        if (draft !== null && draft.trim() !== '' && !Number.isNaN(Number(draft.replace(',', '.')))) {
            return Number(draft.replace(',', '.'));
        }
        if (props.value !== undefined) {
            return props.value;
        }
        if (props.stepFrom !== undefined) {
            return props.stepFrom;
        }
        const placeholder = Number(props.placeholder);
        return props.placeholder !== undefined && Number.isFinite(placeholder) ? placeholder : (props.min ?? 0);
    };

    const apply = (next: number): void => {
        props.onChange(next);
        // While the field is being edited its text is the draft; keep it in step with the arrows
        if (draft !== null) {
            setDraft(`${next}`);
        }
    };

    /** A held arrow repeats; the running value is kept here, not read back from props that lag behind */
    const repeat = React.useRef<{ timer: ReturnType<typeof setTimeout> | null; value: number }>({
        timer: null,
        value: 0,
    });
    const stopRepeat = (): void => {
        if (repeat.current.timer) {
            clearTimeout(repeat.current.timer);
            repeat.current.timer = null;
        }
    };
    React.useEffect(() => stopRepeat, []);

    const startRepeat = (direction: 1 | -1): void => {
        stopRepeat();
        repeat.current.value = stepped(startValue(), direction);
        apply(repeat.current.value);
        const tick = (): void => {
            repeat.current.value = stepped(repeat.current.value, direction);
            apply(repeat.current.value);
            repeat.current.timer = setTimeout(tick, REPEAT_EVERY_MS);
        };
        repeat.current.timer = setTimeout(tick, REPEAT_DELAY_MS);
    };

    const arrow = (direction: 1 | -1): React.JSX.Element => (
        <ButtonBase
            // Not a tab stop: the keyboard already has Up and Down in the field itself
            tabIndex={-1}
            disabled={props.disabled}
            aria-label={direction > 0 ? '+' : '-'}
            // Keeps the focus -- and the text being typed -- in the input
            onMouseDown={event => event.preventDefault()}
            onPointerDown={event => {
                if (event.button === 0) {
                    startRepeat(direction);
                }
            }}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
            onPointerCancel={stopRepeat}
            sx={{
                display: 'flex',
                height: 13,
                width: 18,
                borderRadius: 0.5,
                color: 'text.secondary',
                '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
        >
            {direction > 0 ? <ArrowDropUp sx={{ fontSize: 20 }} /> : <ArrowDropDown sx={{ fontSize: 20 }} />}
        </ButtonBase>
    );

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
            onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                }
                // Shift for bigger steps, as in every number field of a design tool
                event.preventDefault();
                apply(stepped(startValue(), event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1));
            }}
            slotProps={{
                htmlInput: { inputMode: 'decimal' },
                inputLabel: { shrink: true },
                input: {
                    endAdornment: (
                        <InputAdornment
                            position="end"
                            sx={{ flexDirection: 'column', height: 'auto', maxHeight: 'none', ml: 0.5 }}
                        >
                            {arrow(1)}
                            {arrow(-1)}
                        </InputAdornment>
                    ),
                },
            }}
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
    options: { value: T; label: string; icon?: React.ReactNode }[];
    onChange: (value: T) => void;
    /** Label of an extra entry that reports `undefined` */
    emptyLabel?: string;
    /** Icon of that entry */
    emptyIcon?: React.ReactNode;
    disabled?: boolean;
}

/** An option's icon and text on one line, the same in the open list and in the closed field */
function OptionContent(props: { icon?: React.ReactNode; label: string }): React.JSX.Element {
    return (
        <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}
        >
            {props.icon ? (
                <Box
                    component="span"
                    sx={{ display: 'inline-flex', flexShrink: 0, color: 'text.secondary', '& svg': { fontSize: 18 } }}
                >
                    {props.icon}
                </Box>
            ) : null}
            <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
                {props.label}
            </Box>
        </Box>
    );
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
                renderValue={value => {
                    const option = props.options.find(item => item.value === value);
                    return option ? (
                        <OptionContent
                            icon={option.icon}
                            label={option.label}
                        />
                    ) : (
                        <OptionContent
                            icon={props.emptyIcon}
                            label={props.emptyLabel ?? ''}
                        />
                    );
                }}
            >
                {props.emptyLabel !== undefined ? (
                    <MenuItem value="">
                        <OptionContent
                            icon={props.emptyIcon}
                            label={props.emptyLabel}
                        />
                    </MenuItem>
                ) : null}
                {props.options.map(option => (
                    <MenuItem
                        key={option.value}
                        value={option.value}
                    >
                        <OptionContent
                            icon={option.icon}
                            label={option.label}
                        />
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
    // Aligned at the top: a helper text under one field ("from the state") must not push its
    // neighbour down out of line
    return <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>{props.children}</Box>;
}
