/**
 * The parts of the node inspector that go beyond "which state, which unit": how the value is shown,
 * rules that change the node with it, and a colour scale.
 */
import React from 'react';
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Add, Clear, Image as ImageIcon } from '@mui/icons-material';

import type { FlowConfig, FlowNode, NodeRule } from '@flow/core';

import { CheckRow, ColorRow, NumberField, Row, Section, SelectRow, TextFieldRow } from './fields';
import { IconPickerDialog, IconPreview } from './IconPicker';
import { SourceField } from './SourceField';
import type { EditorContext } from './types';

interface ExtrasProps {
    config: FlowConfig;
    node: FlowNode;
    patch: (values: Partial<FlowNode>) => void;
    context: EditorContext;
    /** The node's colour, for previews */
    color: string;
}

const OPERATORS: NodeRule['op'][] = ['<', '<=', '>', '>=', '==', '!='];
const KPIS = ['none', 'autarky', 'selfConsumption'] as const;

/** Number or text, the key figure, today's energy, and when the value counts as stale */
export function ValueDisplayFields(props: ExtrasProps): React.JSX.Element {
    const { config, node, patch, context } = props;
    const map = Object.entries(node.textMap || {});

    const setMap = (entries: [string, string][]): void =>
        patch({ textMap: entries.length ? Object.fromEntries(entries) : undefined });

    return (
        <>
            <Row>
                <SelectRow
                    label={context.t('insp_display')}
                    value={node.display ?? 'number'}
                    options={(['number', 'text'] as const).map(value => ({
                        value,
                        label: context.t(`display_${value}`),
                    }))}
                    onChange={display => patch({ display: display === 'number' ? undefined : display })}
                />
                <SelectRow
                    label={context.t('insp_kpi')}
                    value={node.kpi ?? 'none'}
                    options={KPIS.map(value => ({ value, label: context.t(`kpi_${value}`) }))}
                    onChange={kpi => patch({ kpi: kpi === 'none' ? undefined : kpi })}
                />
            </Row>
            {node.kpi ? (
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5 }}
                >
                    {context.t('insp_kpi_hint')}
                </Typography>
            ) : null}

            {node.display === 'text' ? (
                <Box sx={{ mt: 1 }}>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                    >
                        {context.t('insp_text_map')}
                    </Typography>
                    {map.map(([raw, text], index) => (
                        <Stack
                            key={index}
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'flex-end' }}
                        >
                            <TextField
                                variant="standard"
                                size="small"
                                label={context.t('insp_text_map_raw')}
                                value={raw}
                                onChange={event =>
                                    setMap(
                                        map.map((entry, i) => (i === index ? [event.target.value, entry[1]] : entry)),
                                    )
                                }
                                sx={{ width: 90 }}
                            />
                            <TextField
                                variant="standard"
                                size="small"
                                fullWidth
                                label={context.t('insp_text_map_text')}
                                value={text}
                                onChange={event =>
                                    setMap(
                                        map.map((entry, i) => (i === index ? [entry[0], event.target.value] : entry)),
                                    )
                                }
                            />
                            <IconButton
                                size="small"
                                onClick={() => setMap(map.filter((_entry, i) => i !== index))}
                            >
                                <Clear fontSize="small" />
                            </IconButton>
                        </Stack>
                    ))}
                    <Button
                        size="small"
                        startIcon={<Add />}
                        onClick={() => setMap([...map, [`${map.length}`, '']])}
                    >
                        {context.t('insp_text_map_add')}
                    </Button>
                </Box>
            ) : null}

            <CheckRow
                label={context.t('insp_energy_today')}
                value={!!node.energyToday}
                onChange={checked =>
                    patch({ energyToday: checked ? { label: context.t('insp_energy_today_label') } : undefined })
                }
            />
            {node.energyToday ? (
                <>
                    <TextFieldRow
                        label={context.t('insp_energy_today_prefix')}
                        value={node.energyToday.label}
                        onChange={label => patch({ energyToday: { ...node.energyToday, label: label ?? '' } })}
                    />
                    <SourceField
                        label={context.t('insp_energy_today_src')}
                        value={node.energyToday.src}
                        clearable
                        context={context}
                        onChange={src => patch({ energyToday: { ...node.energyToday, src } })}
                    />
                    <Typography
                        variant="caption"
                        color="text.secondary"
                    >
                        {context.t(node.energyToday.src ? 'insp_energy_today_src_hint' : 'insp_energy_today_hint')}
                    </Typography>
                </>
            ) : null}

            <NumberField
                label={context.t('insp_stale_after')}
                value={node.staleAfter}
                placeholder={config.defaults?.staleAfter ?? '-'}
                min={0}
                helperText={context.t('insp_stale_after_hint')}
                onChange={staleAfter => patch({ staleAfter })}
            />
        </>
    );
}

/** One rule: condition, and what changes while it holds */
function RuleRow(props: {
    rule: NodeRule;
    index: number;
    onChange: (rule: NodeRule) => void;
    onRemove: () => void;
    context: EditorContext;
    color: string;
}): React.JSX.Element {
    const { rule, index, onChange, onRemove, context, color } = props;
    const [iconOpen, setIconOpen] = React.useState(false);

    return (
        <Box
            sx={{
                p: 1,
                mb: 1,
                borderRadius: 1,
                border: theme => `1px solid ${theme.palette.divider}`,
            }}
        >
            <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'flex-end' }}
            >
                <Typography
                    variant="caption"
                    sx={{ pb: 0.75, minWidth: 40 }}
                >
                    {context.t('insp_rule_when')}
                </Typography>
                <Box sx={{ width: 70 }}>
                    <SelectRow
                        label=""
                        value={rule.op}
                        options={OPERATORS.map(op => ({ value: op, label: op }))}
                        onChange={op => onChange({ ...rule, op })}
                    />
                </Box>
                <TextField
                    variant="standard"
                    size="small"
                    fullWidth
                    label={context.t('insp_rule_value')}
                    value={rule.value}
                    onChange={event => {
                        const text = event.target.value;
                        const number = Number(text.replace(',', '.'));
                        // Numbers stay numbers, so "< 20" compares numerically; anything else is a text
                        onChange({ ...rule, value: text.trim() !== '' && Number.isFinite(number) ? number : text });
                    }}
                />
                <IconButton
                    size="small"
                    onClick={onRemove}
                >
                    <Clear fontSize="small" />
                </IconButton>
            </Stack>
            <ColorRow
                id={`ef-rule-color-${index}`}
                label={context.t('insp_rule_color')}
                value={rule.color}
                fallback={color}
                onChange={value => onChange({ ...rule, color: value })}
            />
            <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', mt: 1 }}
            >
                <Tooltip title={context.t('insp_rule_icon')}>
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setIconOpen(true)}
                        startIcon={
                            rule.icon ? (
                                <IconPreview
                                    name={rule.icon}
                                    color={rule.color || color}
                                    size={18}
                                />
                            ) : (
                                <ImageIcon />
                            )
                        }
                    >
                        {rule.icon ? context.t('insp_rule_icon') : context.t('insp_rule_no_icon')}
                    </Button>
                </Tooltip>
                {rule.icon ? (
                    <IconButton
                        size="small"
                        onClick={() => onChange({ ...rule, icon: undefined })}
                    >
                        <Clear fontSize="small" />
                    </IconButton>
                ) : null}
                <Box sx={{ flex: 1 }} />
                <CheckRow
                    label={context.t('insp_rule_blink')}
                    value={rule.blink}
                    onChange={blink => onChange({ ...rule, blink: blink || undefined })}
                />
            </Stack>
            <IconPickerDialog
                open={iconOpen}
                value={rule.icon}
                color={rule.color || color}
                context={context}
                onClose={() => setIconOpen(false)}
                onChange={icon => onChange({ ...rule, icon })}
            />
        </Box>
    );
}

/** The node's rules, first match wins */
export function RulesSection(props: ExtrasProps): React.JSX.Element {
    const { node, patch, context, color } = props;
    const rules = node.rules || [];
    const setRules = (next: NodeRule[]): void => patch({ rules: next.length ? next : undefined });

    return (
        <Section title={context.t('insp_rules')}>
            {rules.map((rule, index) => (
                <RuleRow
                    key={index}
                    rule={rule}
                    index={index}
                    color={color}
                    context={context}
                    onChange={next => setRules(rules.map((item, i) => (i === index ? next : item)))}
                    onRemove={() => setRules(rules.filter((_item, i) => i !== index))}
                />
            ))}
            <Button
                size="small"
                startIcon={<Add />}
                onClick={() => setRules([...rules, { op: '<', value: 0 }])}
            >
                {context.t('insp_rule_add')}
            </Button>
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
            >
                {context.t('insp_rules_hint')}
            </Typography>
        </Section>
    );
}

/** Colour the node green to red by a value -- a price, a load */
export function ColorScaleSection(props: ExtrasProps): React.JSX.Element {
    const { node, patch, context } = props;
    const scale = node.colorScale;

    return (
        <Section title={context.t('insp_color_scale')}>
            <SourceField
                label={context.t('insp_color_scale_source')}
                value={scale?.src}
                sameAsValue
                clearable
                context={context}
                onChange={src =>
                    patch({ colorScale: src ? { min: scale?.min ?? 0, max: scale?.max ?? 1, src } : undefined })
                }
            />
            {scale ? (
                <Row>
                    <NumberField
                        label={context.t('insp_color_scale_min')}
                        value={scale.min}
                        onChange={min => patch({ colorScale: { ...scale, min: min ?? 0 } })}
                    />
                    <NumberField
                        label={context.t('insp_color_scale_max')}
                        value={scale.max}
                        onChange={max => patch({ colorScale: { ...scale, max: max ?? 1 } })}
                    />
                </Row>
            ) : null}
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
            >
                {context.t('insp_color_scale_hint')}
            </Typography>
        </Section>
    );
}
