/**
 * The control that binds a number in the diagram to something in ioBroker.
 *
 * This is where most of the configuring happens, so it has to be short for the normal case -- pick a
 * state, done -- while still reaching the cases that made people give up on the predecessor: a value
 * that has to be scaled, two inverters that must be added up, a battery power that is only correct
 * once the sign is flipped. The three modes are one row apart, and the rescaling knobs stay folded
 * away until somebody needs them.
 */
import React from 'react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { Add, Clear, DragHandle, ExpandMore, Functions, List as ListIcon, Numbers } from '@mui/icons-material';
import { DialogSelectID } from '@iobroker/gui-components';

import {
    compileExpr,
    exprVariables,
    isSrcConst,
    isSrcExpr,
    isSrcSame,
    isSrcState,
    type Src,
    type SrcScaling,
    type SrcState,
} from '@energyflow/core';

import type { EditorContext } from './types';

type SrcMode = 'state' | 'expr' | 'const' | 'same';

function modeOf(src: Src | undefined): SrcMode {
    if (!src) {
        return 'state';
    }
    if (isSrcExpr(src)) {
        return 'expr';
    }
    if (isSrcConst(src)) {
        return 'const';
    }
    if (isSrcSame(src)) {
        return 'same';
    }
    return 'state';
}

/** The numeric rescaling of a state source, one field per knob */
const SCALING_FIELDS: { key: 'factor' | 'offset' | 'deadband' | 'min' | 'max'; label: string; tooltip: string }[] = [
    { key: 'factor', label: 'src_factor', tooltip: 'src_factor_tooltip' },
    { key: 'offset', label: 'src_offset', tooltip: 'src_offset_tooltip' },
    { key: 'deadband', label: 'src_deadband', tooltip: 'src_deadband_tooltip' },
    { key: 'min', label: 'src_min', tooltip: 'src_min_tooltip' },
    { key: 'max', label: 'src_max', tooltip: 'src_max_tooltip' },
];

/** The rescaling knobs behind a fold, for any source that has them */
export function ScalingFields<T extends SrcScaling>(props: {
    value: T;
    onChange: (value: T) => void;
    context: EditorContext;
    /** Open from the start -- where the rescaling is the whole point of the source */
    defaultExpanded?: boolean;
}): React.JSX.Element {
    const { value, onChange, context } = props;

    const hasScaling =
        value.factor !== undefined ||
        value.offset !== undefined ||
        value.invert ||
        value.deadband !== undefined ||
        value.min !== undefined ||
        value.max !== undefined;

    const setNumber = (key: 'factor' | 'offset' | 'deadband' | 'min' | 'max', raw: string): void => {
        const next = { ...value };
        if (raw === '') {
            delete next[key];
        } else {
            const parsed = Number(raw.replace(',', '.'));
            if (Number.isNaN(parsed)) {
                return;
            }
            next[key] = parsed;
        }
        onChange(next);
    };

    return (
        <Accordion
            disableGutters
            elevation={0}
            defaultExpanded={props.defaultExpanded}
            sx={{ background: 'transparent', '&::before': { display: 'none' } }}
        >
            {/* Padded on both sides: the admin theme draws the accordion as an outlined box,
                and text flush with that outline reads as a rendering error */}
            <AccordionSummary
                expandIcon={<ExpandMore />}
                sx={{ px: 1.5, minHeight: 36 }}
            >
                <Typography
                    variant="caption"
                    color={hasScaling ? 'primary' : 'text.secondary'}
                >
                    {context.t('src_scaling')}
                    {hasScaling ? ' •' : ''}
                </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.5 }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                        gap: 1,
                    }}
                >
                    {SCALING_FIELDS.map(field => (
                        <Tooltip
                            key={field.key}
                            title={context.t(field.tooltip)}
                        >
                            <TextField
                                variant="standard"
                                size="small"
                                label={context.t(field.label)}
                                value={value[field.key] ?? ''}
                                onChange={event => setNumber(field.key, event.target.value)}
                                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                            />
                        </Tooltip>
                    ))}
                </Box>
                <Tooltip title={context.t('src_invert_tooltip')}>
                    <Button
                        size="small"
                        sx={{ mt: 1 }}
                        variant={value.invert ? 'contained' : 'outlined'}
                        onClick={() => onChange({ ...value, invert: !value.invert })}
                    >
                        {context.t('src_invert')}
                    </Button>
                </Tooltip>
            </AccordionDetails>
        </Accordion>
    );
}

export interface StateSourceRowProps {
    value: SrcState;
    onChange: (src: SrcState) => void;
    context: EditorContext;
    label: string;
    /** Hide the rescaling section -- used for the variables of a formula, which stay compact */
    compact?: boolean;
}

/** State id plus, behind a fold, the rescaling */
export function StateSourceRow(props: StateSourceRowProps): React.JSX.Element {
    const { value, onChange, context, label, compact } = props;
    const [pickerOpen, setPickerOpen] = React.useState(false);

    return (
        <>
            <Stack
                sx={{ alignItems: 'flex-end' }}
                direction="row"
                spacing={1}
            >
                <TextField
                    fullWidth
                    variant="standard"
                    size="small"
                    label={label}
                    value={value.oid || ''}
                    onChange={event => onChange({ ...value, oid: event.target.value })}
                />
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ListIcon />}
                    onClick={() => setPickerOpen(true)}
                    sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                    {context.t('src_browse')}
                </Button>
            </Stack>

            {compact ? null : (
                <ScalingFields
                    value={value}
                    onChange={onChange}
                    context={context}
                />
            )}

            {pickerOpen ? (
                <DialogSelectID
                    socket={context.socket}
                    theme={context.theme}
                    themeType={context.themeType}
                    lang={context.lang}
                    selected={value.oid || ''}
                    types={['state']}
                    onClose={() => setPickerOpen(false)}
                    onOk={selected => {
                        const id = Array.isArray(selected) ? selected[0] : selected;
                        if (id) {
                            onChange({ ...value, oid: id });
                        }
                        setPickerOpen(false);
                    }}
                />
            ) : null}
        </>
    );
}

export interface SourceFieldProps {
    label: string;
    value?: Src;
    onChange: (src: Src | undefined) => void;
    context: EditorContext;
    /** Show a button that removes the binding altogether */
    clearable?: boolean;
    /** Offer "same as the value" -- for the charge level and the extra values of a node */
    sameAsValue?: boolean;
}

export function SourceField(props: SourceFieldProps): React.JSX.Element {
    const { label, value, onChange, context, clearable, sameAsValue } = props;
    const mode = modeOf(value);

    /**
     * The formula's error, recomputed on every keystroke. Showing it while typing is the point: the
     * user is writing a tiny program and needs to know *before* saving whether it parses.
     */
    const exprError = React.useMemo(() => {
        if (!value || !isSrcExpr(value) || !value.expr.trim()) {
            return null;
        }
        try {
            compileExpr(value.expr);
            return null;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }, [value]);

    /** Variables the formula reads but has no source for -- the most common mistake by far */
    const unboundVariables = React.useMemo(() => {
        if (!value || !isSrcExpr(value)) {
            return [];
        }
        return exprVariables(value.expr).filter(name => !value.vars?.[name]);
    }, [value]);

    const switchMode = (next: SrcMode): void => {
        if (next === mode) {
            return;
        }
        if (next === 'state') {
            onChange({ oid: '' });
        } else if (next === 'same') {
            onChange({ same: 'value' });
        } else if (next === 'const') {
            onChange({ const: 0 });
        } else {
            // Carry a state that was already picked over into the formula, so switching to a formula
            // to "add a second inverter" does not throw the first one away
            const vars = value && isSrcState(value) && value.oid ? { a: value } : { a: { oid: '' } };
            onChange({ expr: 'a', vars });
        }
    };

    const setVar = (name: string, src: SrcState | undefined): void => {
        if (!value || !isSrcExpr(value)) {
            return;
        }
        const vars = { ...value.vars };
        if (src) {
            vars[name] = src;
        } else {
            delete vars[name];
        }
        onChange({ ...value, vars });
    };

    const addVar = (): void => {
        if (!value || !isSrcExpr(value)) {
            return;
        }
        // Name the next variable after the first free single letter, which is what the formulas in
        // the documentation look like
        const taken = new Set(Object.keys(value.vars || {}));
        let name = 'a';
        for (let code = 97; code <= 122; code++) {
            if (!taken.has(String.fromCharCode(code))) {
                name = String.fromCharCode(code);
                break;
            }
        }
        onChange({ ...value, vars: { ...value.vars, [name]: { oid: '' } } });
    };

    return (
        <Box sx={{ mb: 1.5 }}>
            <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mb: 0.5 }}
            >
                <FormControl
                    variant="standard"
                    size="small"
                    sx={{ minWidth: 118 }}
                >
                    <InputLabel>{label}</InputLabel>
                    <Select
                        value={mode}
                        onChange={event => switchMode(event.target.value)}
                    >
                        <MenuItem value="state">
                            <Stack
                                sx={{ alignItems: 'center' }}
                                direction="row"
                                spacing={0.75}
                            >
                                <ListIcon fontSize="small" />
                                <span>{context.t('src_mode_state')}</span>
                            </Stack>
                        </MenuItem>
                        <MenuItem value="expr">
                            <Stack
                                sx={{ alignItems: 'center' }}
                                direction="row"
                                spacing={0.75}
                            >
                                <Functions fontSize="small" />
                                <span>{context.t('src_mode_expr')}</span>
                            </Stack>
                        </MenuItem>
                        <MenuItem value="const">
                            <Stack
                                sx={{ alignItems: 'center' }}
                                direction="row"
                                spacing={0.75}
                            >
                                <Numbers fontSize="small" />
                                <span>{context.t('src_mode_const')}</span>
                            </Stack>
                        </MenuItem>
                        {sameAsValue || mode === 'same' ? (
                            <MenuItem value="same">
                                <Stack
                                    sx={{ alignItems: 'center' }}
                                    direction="row"
                                    spacing={0.75}
                                >
                                    <DragHandle fontSize="small" />
                                    <span>{context.t('src_mode_same')}</span>
                                </Stack>
                            </MenuItem>
                        ) : null}
                    </Select>
                </FormControl>
                {clearable && value ? (
                    <Tooltip title={context.t('src_clear')}>
                        <IconButton
                            size="small"
                            onClick={() => onChange(undefined)}
                        >
                            <Clear fontSize="small" />
                        </IconButton>
                    </Tooltip>
                ) : null}
            </Stack>

            {mode === 'state' ? (
                <StateSourceRow
                    value={(value as SrcState) || { oid: '' }}
                    onChange={next => onChange(next)}
                    context={context}
                    label={context.t('src_state')}
                />
            ) : null}

            {mode === 'same' && value && isSrcSame(value) ? (
                <>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mb: 0.5 }}
                    >
                        {context.t('src_same_hint')}
                    </Typography>
                    <ScalingFields
                        value={value}
                        onChange={next => onChange(next)}
                        context={context}
                        defaultExpanded
                    />
                </>
            ) : null}

            {mode === 'const' ? (
                <TextField
                    fullWidth
                    variant="standard"
                    size="small"
                    label={context.t('src_mode_const')}
                    value={value && isSrcConst(value) ? value.const : 0}
                    onChange={event => {
                        const parsed = Number(event.target.value.replace(',', '.'));
                        onChange({ const: Number.isNaN(parsed) ? 0 : parsed });
                    }}
                    slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                />
            ) : null}

            {mode === 'expr' && value && isSrcExpr(value) ? (
                <>
                    <TextField
                        fullWidth
                        variant="standard"
                        size="small"
                        label={context.t('src_formula')}
                        value={value.expr}
                        error={!!exprError}
                        helperText={
                            exprError ||
                            (unboundVariables.length
                                ? context.t('src_unbound', unboundVariables.join(', '))
                                : context.t('src_formula_hint'))
                        }
                        onChange={event => onChange({ ...value, expr: event.target.value })}
                    />

                    <Box sx={{ mt: 1, pl: 1, borderLeft: theme => `2px solid ${theme.palette.divider}` }}>
                        {Object.entries(value.vars || {}).map(([name, src]) => (
                            <Stack
                                key={name}
                                direction="row"
                                spacing={1}
                                sx={{ alignItems: 'flex-end', mb: 0.5 }}
                            >
                                <Typography sx={{ minWidth: 22, fontFamily: 'monospace', pb: 0.5 }}>{name}</Typography>
                                <Box sx={{ flex: 1 }}>
                                    <StateSourceRow
                                        value={isSrcState(src) ? src : { oid: '' }}
                                        onChange={next => setVar(name, next)}
                                        context={context}
                                        label={context.t('src_state')}
                                        compact
                                    />
                                </Box>
                                <IconButton
                                    size="small"
                                    onClick={() => setVar(name, undefined)}
                                >
                                    <Clear fontSize="small" />
                                </IconButton>
                            </Stack>
                        ))}
                        <Button
                            size="small"
                            startIcon={<Add />}
                            onClick={addVar}
                        >
                            {context.t('src_add_var')}
                        </Button>
                    </Box>
                </>
            ) : null}
        </Box>
    );
}

export default SourceField;
