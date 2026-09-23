/**
 * The properties panel.
 *
 * Four panels behind one component: the selected node, several selected nodes, the selected edge, or
 * the diagram itself when nothing is selected. Everything a user can configure is reachable from here, and everything that is
 * not* configured shows the default it inherits as a placeholder -- so the panel also explains what
 * the diagram is currently doing, not only what has been overridden.
 */
import React from 'react';
import { Box, Button, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Delete, HorizontalRule, Image as ImageIcon, ShowChart, SwapHoriz } from '@mui/icons-material';

import {
    DEFAULT_ANIMATION,
    DIAGRAM_STYLE_IDS,
    DEFAULT_FONT_SIZE,
    DEFAULT_LINE_WIDTH,
    DEFAULT_THRESHOLD,
    iconPlacement,
    MEDIA,
    MEDIUM_IDS,
    nodeRect,
    nodeShape,
    pageLabelSize,
    removeEdge,
    removeNode,
    removeNodes,
    renameNode,
    cachedMax,
    sourceMax,
    sourceUnit,
    srcOids,
    updateEdge,
    updateNode,
    type EdgeCurve,
    type EdgeMode,
    type FlowConfig,
    type FlowEdge,
    type FlowNode,
    type NodeKind,
    type NodeShape,
    type Side,
    type TimestampFormat,
    type UnitGetter,
} from '@flow/core';

import { CheckRow, ColorRow, NumberField, Row, Section, SelectRow, TextFieldRow } from './fields';
import { kindLabel } from './labels';
import { StateIdRow, SourceField } from './SourceField';
import { IconPickerDialog, IconPreview } from './IconPicker';
import { IS_MAC } from './selection';
import { useIsRecorded } from './useHistory';
import { ColorScaleSection, RulesSection, ValueDisplayFields } from './InspectorExtras';
import {
    ACTION_ICONS,
    CURVE_ICONS,
    KIND_ICONS,
    MODE_ICONS,
    SHAPE_ICONS,
    SIDE_ICONS,
    TIMESTAMP_FORMAT_ICONS,
    TIMESTAMP_ICONS,
} from './optionIcons';
import type { EditorContext, EditorSelection } from './types';

export interface InspectorProps {
    config: FlowConfig;
    selection: EditorSelection;
    onChange: (config: FlowConfig) => void;
    onSelect: (selection: EditorSelection) => void;
    context: EditorContext;
    /** Accent colour the selected node would have without an override, for the previews */
    defaultNodeColor: (kind: NodeKind) => string;
    /** Units of the bound states, so an empty unit field can show what it inherits from them */
    units?: UnitGetter;
    /** The default history adapter; null when the installation has none */
    historyInstance?: string | null;
}

const NODE_KINDS: NodeKind[] = ['source', 'sink', 'storage', 'grid', 'bus', 'label', 'image'];
const NODE_SHAPES: NodeShape[] = ['circle', 'rounded', 'square', 'none'];
const EDGE_MODES: EdgeMode[] = ['signed', 'positive', 'split'];
const EDGE_CURVES: EdgeCurve[] = ['bezier', 'orthogonal', 'straight'];
const SIDES: Side[] = ['auto', 'top', 'right', 'bottom', 'left'];
const ACTION_TYPES = ['none', 'toggle', 'setValue', 'url', 'view', 'chart'] as const;
const TIMESTAMPS = ['none', 'lc', 'ts'] as const;
const TIMESTAMP_FORMATS: TimestampFormat[] = ['relative', 'time', 'datetime'];
const HISTORY_OPTIONS = ['none', '15m', '30m', '1h', '3h', '6h', '12h', '24h'] as const;

/** Why a chart may stay empty: no history adapter, a formula as the value, or a state not recorded */
function HistoryHint(props: {
    node: FlowNode;
    instance: string | null | undefined;
    context: EditorContext;
}): React.JSX.Element | null {
    const { node, instance, context } = props;
    const oid = node.value && 'oid' in node.value ? node.value.oid : undefined;
    const recorded = useIsRecorded(context.socket, node.history ? oid : undefined, instance);
    let text: string | null = null;
    if (instance === null) {
        text = context.t('insp_history_no_adapter');
    } else if (!oid) {
        text = context.t('insp_history_state_only');
    } else if (node.history && recorded === false) {
        text = context.t('insp_history_not_recorded', instance || '');
    }
    return text ? (
        <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
        >
            {text}
        </Typography>
    ) : null;
}

/** How to select several nodes and what the keyboard does with them, in the words of this platform */
function ShortcutHint(props: { context: EditorContext }): React.JSX.Element {
    const modifier = IS_MAC ? '⌘' : props.context.t('key_ctrl');
    return (
        <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1 }}
        >
            {props.context.t('insp_shortcuts_hint', modifier, modifier, modifier)}
        </Typography>
    );
}

function NodePanel(props: InspectorProps & { node: FlowNode }): React.JSX.Element {
    const { config, node, onChange, onSelect, context, defaultNodeColor } = props;
    const [iconOpen, setIconOpen] = React.useState(false);
    const [idDraft, setIdDraft] = React.useState<string | null>(null);

    const patch = (values: Partial<FlowNode>): void => onChange(updateNode(config, node.id, values));
    const color = node.color || defaultNodeColor(node.kind);
    const stateUnit = sourceUnit(node.value, props.units);
    // What the state object declares as its maximum: the fill level falls back to it
    const stateMax = sourceMax(node.value, cachedMax);
    // Position and size step by the grid, so the arrows land where dragging would
    const gridStep = config.canvas.grid && config.canvas.grid > 0 ? config.canvas.grid : 1;
    const isDecoration = node.kind === 'label' || node.kind === 'image' || node.kind === 'bus';

    const idTaken =
        idDraft !== null &&
        idDraft !== node.id &&
        (config.nodes.some(other => other.id === idDraft) || config.edges.some(edge => edge.id === idDraft));

    return (
        <>
            <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
                <Typography variant="subtitle2">{context.t('insp_node')}</Typography>
                <Tooltip title={context.t('insp_delete_node')}>
                    <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                            onChange(removeNode(config, node.id));
                            onSelect({ kind: 'canvas' });
                        }}
                    >
                        <Delete fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>

            <Section title={context.t('insp_basics')}>
                <SelectRow
                    label={context.t('insp_kind')}
                    value={node.kind}
                    options={NODE_KINDS.map(kind => ({
                        value: kind,
                        label: kindLabel(kind, config, context.t),
                        icon: KIND_ICONS[kind],
                    }))}
                    onChange={kind => patch({ kind })}
                />
                <TextFieldRow
                    label={context.t('insp_label')}
                    value={node.label}
                    onChange={label => patch({ label })}
                />
                <NumberField
                    label={context.t('insp_label_scale')}
                    // Stored as a factor, shown as a percentage -- nobody thinks of text as "1.25 times"
                    value={node.labelScale === undefined ? undefined : Math.round(node.labelScale * 100)}
                    placeholder={100}
                    min={10}
                    max={1000}
                    step={10}
                    helperText={context.t('insp_label_scale_hint', pageLabelSize(config))}
                    onChange={percent => patch({ labelScale: percent === undefined ? undefined : percent / 100 })}
                />
                <TextFieldRow
                    label={context.t('insp_id')}
                    value={idDraft ?? node.id}
                    error={idTaken}
                    helperText={idTaken ? context.t('insp_id_taken') : context.t('insp_id_hint')}
                    onChange={value => {
                        const next = value ?? '';
                        setIdDraft(next);
                        // Renaming rewrites every edge that points at this node, so it only happens
                        // once the new name is actually free
                        if (next && next !== node.id) {
                            const renamed = renameNode(config, node.id, next);
                            if (renamed !== config) {
                                onChange(renamed);
                                onSelect({ kind: 'node', id: next });
                                setIdDraft(null);
                            }
                        }
                    }}
                />
            </Section>

            {node.kind === 'label' ? (
                <Section title={context.t('insp_text')}>
                    <TextFieldRow
                        label={context.t('insp_text')}
                        value={node.text}
                        onChange={text => patch({ text })}
                    />
                    <NumberField
                        label={context.t('insp_font_size')}
                        value={node.fontSize}
                        placeholder={config.defaults?.fontSize ?? DEFAULT_FONT_SIZE}
                        min={4}
                        onChange={fontSize => patch({ fontSize })}
                    />
                </Section>
            ) : null}

            {node.kind !== 'label' ? (
                <Section title={context.t('insp_appearance')}>
                    <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', mb: 1 }}
                    >
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={
                                node.icon ? (
                                    <IconPreview
                                        name={node.icon}
                                        color={color}
                                        size={20}
                                    />
                                ) : (
                                    <ImageIcon />
                                )
                            }
                            onClick={() => setIconOpen(true)}
                        >
                            {context.t('insp_icon')}
                        </Button>
                        {node.icon ? (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                            >
                                {node.icon.length > 28 ? `${node.icon.slice(0, 28)}...` : node.icon}
                            </Typography>
                        ) : null}
                    </Stack>
                    {node.kind !== 'bus' && node.kind !== 'image' ? (
                        <SelectRow
                            label={context.t('insp_icon_position')}
                            value={node.iconPosition}
                            emptyLabel={context.t(
                                'insp_default_option',
                                context.t(`icon_position_${iconPlacement({ ...node, iconPosition: undefined })}`),
                            )}
                            emptyIcon={SIDE_ICONS.auto}
                            options={(['top', 'left'] as const).map(value => ({
                                value,
                                label: context.t(`icon_position_${value}`),
                                icon: SIDE_ICONS[value],
                            }))}
                            onChange={iconPosition => patch({ iconPosition: iconPosition || undefined })}
                        />
                    ) : null}
                    <ColorRow
                        id={`ef-node-color-${node.id}`}
                        label={context.t('insp_color')}
                        value={node.color}
                        fallback={defaultNodeColor(node.kind)}
                        onChange={value => patch({ color: value })}
                    />
                    {node.kind !== 'bus' && node.kind !== 'image' ? (
                        <SelectRow
                            label={context.t('insp_shape')}
                            value={node.shape}
                            // Named as the default, or the list shows the kind's shape twice
                            emptyLabel={context.t(
                                'insp_default_option',
                                context.t(`shape_${nodeShape({ ...node, shape: undefined })}`),
                            )}
                            emptyIcon={SHAPE_ICONS[nodeShape({ ...node, shape: undefined })]}
                            options={NODE_SHAPES.map(shape => ({
                                value: shape,
                                label: context.t(`shape_${shape}`),
                                icon: SHAPE_ICONS[shape],
                            }))}
                            onChange={shape => patch({ shape: shape || undefined })}
                        />
                    ) : null}
                    <Row>
                        <NumberField
                            label={context.t('insp_width')}
                            value={node.w}
                            placeholder={context.t('insp_auto')}
                            min={4}
                            step={gridStep}
                            stepFrom={nodeRect(node).w}
                            onChange={w => patch({ w })}
                        />
                        <NumberField
                            label={context.t('insp_height')}
                            value={node.h}
                            placeholder={context.t('insp_auto')}
                            min={4}
                            step={gridStep}
                            stepFrom={nodeRect(node).h}
                            onChange={h => patch({ h })}
                        />
                    </Row>
                    <Row>
                        <NumberField
                            label="X"
                            value={node.x}
                            step={gridStep}
                            onChange={x => patch({ x: x ?? 0 })}
                        />
                        <NumberField
                            label="Y"
                            value={node.y}
                            step={gridStep}
                            onChange={y => patch({ y: y ?? 0 })}
                        />
                    </Row>
                </Section>
            ) : null}

            {!isDecoration ? (
                <>
                    <Section title={context.t('insp_value')}>
                        <SourceField
                            label={context.t('insp_source')}
                            value={node.value}
                            onChange={value => patch({ value })}
                            context={context}
                            clearable
                        />
                        <Row>
                            <TextFieldRow
                                label={context.t('insp_unit')}
                                value={node.unit}
                                placeholder={stateUnit || config.defaults?.unit || '-'}
                                helperText={stateUnit && !node.unit ? context.t('insp_unit_from_state') : undefined}
                                onChange={unit => patch({ unit })}
                            />
                            <NumberField
                                label={context.t('insp_decimals')}
                                value={node.decimals}
                                placeholder={context.t('insp_auto')}
                                min={0}
                                max={6}
                                onChange={decimals => patch({ decimals })}
                            />
                        </Row>
                        <NumberField
                            label={context.t('insp_font_size')}
                            value={node.fontSize}
                            placeholder={config.defaults?.fontSize ?? DEFAULT_FONT_SIZE}
                            min={4}
                            onChange={fontSize => patch({ fontSize })}
                        />
                        {node.kind !== 'storage' ? (
                            <NumberField
                                label={context.t('insp_level_max')}
                                value={node.levelMax}
                                placeholder={
                                    stateMax === undefined ? '-' : `${stateMax}${stateUnit ? ` ${stateUnit}` : ''}`
                                }
                                min={0}
                                step={100}
                                helperText={
                                    stateMax === undefined
                                        ? context.t(
                                              'insp_level_max_hint',
                                              node.unit || stateUnit || config.defaults?.unit || '',
                                          )
                                        : context.t('insp_level_max_from_state')
                                }
                                onChange={levelMax => patch({ levelMax: levelMax || undefined })}
                            />
                        ) : null}
                        <CheckRow
                            label={context.t('insp_hide_when_zero')}
                            value={node.hideWhenZero}
                            onChange={hideWhenZero => patch({ hideWhenZero })}
                        />
                        <Row>
                            <SelectRow
                                label={context.t('insp_timestamp')}
                                value={node.timestamp ?? 'none'}
                                // A time needs a state to take it from; a constant or a derived value has none
                                disabled={!srcOids(node.value).length && !node.timestamp}
                                options={TIMESTAMPS.map(value => ({
                                    value,
                                    label: context.t(`timestamp_${value}`),
                                    icon: TIMESTAMP_ICONS[value],
                                }))}
                                onChange={value => patch({ timestamp: value === 'none' ? undefined : value })}
                            />
                            {node.timestamp ? (
                                <SelectRow
                                    label={context.t('insp_timestamp_format')}
                                    value={node.timestampFormat ?? 'relative'}
                                    options={TIMESTAMP_FORMATS.map(value => ({
                                        value,
                                        label: context.t(`timestamp_format_${value}`),
                                        icon: TIMESTAMP_FORMAT_ICONS[value],
                                    }))}
                                    onChange={value =>
                                        patch({ timestampFormat: value === 'relative' ? undefined : value })
                                    }
                                />
                            ) : null}
                        </Row>
                        <SelectRow
                            label={context.t('insp_history')}
                            value={node.history ?? 'none'}
                            // A chart needs a history adapter and a plain state to read from it
                            disabled={
                                !node.history &&
                                (!props.historyInstance || !node.value || !('oid' in node.value) || !node.value.oid)
                            }
                            options={HISTORY_OPTIONS.map(value => ({
                                value,
                                label: value === 'none' ? context.t('insp_history_none') : value,
                                icon: value === 'none' ? <HorizontalRule /> : <ShowChart />,
                            }))}
                            onChange={value => patch({ history: value === 'none' ? undefined : value })}
                        />
                        <HistoryHint
                            node={node}
                            instance={props.historyInstance}
                            context={context}
                        />
                        <ValueDisplayFields
                            config={config}
                            node={node}
                            patch={patch}
                            context={context}
                            color={color}
                        />
                    </Section>

                    <RulesSection
                        config={config}
                        node={node}
                        patch={patch}
                        context={context}
                        color={color}
                    />

                    <ColorScaleSection
                        config={config}
                        node={node}
                        patch={patch}
                        context={context}
                        color={color}
                    />

                    {node.kind === 'storage' ? (
                        <Section title={context.t('insp_soc')}>
                            <SourceField
                                label={context.t('insp_soc_source')}
                                value={node.soc}
                                sameAsValue
                                onChange={soc => patch({ soc })}
                                context={context}
                                clearable
                            />
                        </Section>
                    ) : null}

                    <Section title={context.t('insp_badges')}>
                        {(node.badges || []).map((badge, index) => (
                            <Box
                                key={index}
                                sx={{ mb: 1, pl: 1, borderLeft: theme => `2px solid ${theme.palette.divider}` }}
                            >
                                <Stack
                                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                                    direction="row"
                                >
                                    <Typography variant="caption">
                                        {context.t('insp_badge')} {index + 1}
                                    </Typography>
                                    <IconButton
                                        size="small"
                                        onClick={() =>
                                            patch({ badges: (node.badges || []).filter((_item, i) => i !== index) })
                                        }
                                    >
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </Stack>
                                <TextFieldRow
                                    label={context.t('insp_badge_label')}
                                    value={badge.label}
                                    onChange={label =>
                                        patch({
                                            badges: (node.badges || []).map((item, i) =>
                                                i === index ? { ...item, label } : item,
                                            ),
                                        })
                                    }
                                />
                                <SourceField
                                    label={context.t('insp_source')}
                                    value={badge.src}
                                    sameAsValue
                                    onChange={src =>
                                        patch({
                                            badges: (node.badges || []).map((item, i) =>
                                                i === index ? { ...item, src: src || { oid: '' } } : item,
                                            ),
                                        })
                                    }
                                    context={context}
                                />
                                <Row>
                                    <TextFieldRow
                                        label={context.t('insp_unit')}
                                        value={badge.unit}
                                        placeholder={sourceUnit(badge.src, props.units) || config.defaults?.unit || '-'}
                                        onChange={unit =>
                                            patch({
                                                badges: (node.badges || []).map((item, i) =>
                                                    i === index ? { ...item, unit } : item,
                                                ),
                                            })
                                        }
                                    />
                                    <NumberField
                                        label={context.t('insp_decimals')}
                                        value={badge.decimals}
                                        min={0}
                                        max={6}
                                        onChange={decimals =>
                                            patch({
                                                badges: (node.badges || []).map((item, i) =>
                                                    i === index ? { ...item, decimals } : item,
                                                ),
                                            })
                                        }
                                    />
                                </Row>
                            </Box>
                        ))}
                        <Button
                            size="small"
                            onClick={() => patch({ badges: [...(node.badges || []), { src: { oid: '' } }] })}
                        >
                            {context.t('insp_add_badge')}
                        </Button>
                    </Section>

                    <Section title={context.t('insp_action')}>
                        <SelectRow
                            label={context.t('insp_action_type')}
                            value={node.action?.type || 'none'}
                            options={ACTION_TYPES.map(type => ({
                                value: type,
                                label: context.t(`action_${type}`),
                                icon: ACTION_ICONS[type],
                            }))}
                            onChange={type => patch({ action: type === 'none' ? undefined : { ...node.action, type } })}
                        />
                        {node.action &&
                        (node.action.type === 'toggle' ||
                            node.action.type === 'setValue' ||
                            node.action.type === 'chart') ? (
                            <StateIdRow
                                label={context.t('insp_action_oid')}
                                value={node.action.oid}
                                context={context}
                                // The detail view needs no state of its own: it shows the value's
                                placeholder={
                                    node.action.type === 'chart' ? context.t('insp_action_oid_value') : undefined
                                }
                                helperText={
                                    node.action.type === 'chart' ? context.t('insp_action_chart_hint') : undefined
                                }
                                onChange={oid => patch({ action: { ...node.action!, oid } })}
                            />
                        ) : null}
                        {node.action?.type === 'setValue' ? (
                            <TextFieldRow
                                label={context.t('insp_action_value')}
                                value={node.action.value === undefined ? undefined : `${node.action.value}`}
                                onChange={value => patch({ action: { ...node.action!, value } })}
                            />
                        ) : null}
                        {node.action?.type === 'url' ? (
                            <>
                                <TextFieldRow
                                    label={context.t('insp_action_url')}
                                    value={node.action.url}
                                    onChange={url => patch({ action: { ...node.action!, url } })}
                                />
                                <CheckRow
                                    label={context.t('insp_action_new_tab')}
                                    value={node.action.newTab}
                                    onChange={newTab => patch({ action: { ...node.action!, newTab } })}
                                />
                            </>
                        ) : null}
                        {node.action?.type === 'view' ? (
                            <TextFieldRow
                                label={context.t('insp_action_view')}
                                value={node.action.view}
                                helperText={context.t('insp_action_view_hint')}
                                onChange={view => patch({ action: { ...node.action!, view } })}
                            />
                        ) : null}
                    </Section>
                </>
            ) : null}

            <IconPickerDialog
                open={iconOpen}
                value={node.icon}
                color={color}
                context={context}
                onClose={() => setIconOpen(false)}
                onChange={icon => patch({ icon })}
            />
        </>
    );
}

function EdgePanel(props: InspectorProps & { edge: FlowEdge }): React.JSX.Element {
    const { config, edge, onChange, onSelect, context } = props;
    const edgeStateUnit = sourceUnit(edge.value, props.units) ?? sourceUnit(edge.reverse, props.units);
    const patch = (values: Partial<FlowEdge>): void => onChange(updateEdge(config, edge.id, values));
    const nodeOptions = config.nodes.map(node => ({
        value: node.id,
        label: node.label || node.id,
        icon: KIND_ICONS[node.kind],
    }));
    const mode = edge.mode || 'signed';

    return (
        <>
            <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
                <Typography variant="subtitle2">{context.t('insp_edge')}</Typography>
                <Stack direction="row">
                    <Tooltip title={context.t('insp_swap')}>
                        <IconButton
                            size="small"
                            onClick={() => patch({ from: edge.to, to: edge.from })}
                        >
                            <SwapHoriz fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={context.t('insp_delete_edge')}>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                                onChange(removeEdge(config, edge.id));
                                onSelect({ kind: 'canvas' });
                            }}
                        >
                            <Delete fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>

            <Section title={context.t('insp_connection')}>
                <SelectRow
                    label={context.t('insp_from')}
                    value={edge.from}
                    options={nodeOptions}
                    onChange={from => patch({ from })}
                />
                <SelectRow
                    label={context.t('insp_to')}
                    value={edge.to}
                    options={nodeOptions}
                    onChange={to => patch({ to })}
                />
            </Section>

            <Section title={context.t('insp_value')}>
                <SelectRow
                    label={context.t('insp_mode')}
                    value={mode}
                    options={EDGE_MODES.map(value => ({
                        value,
                        label: context.t(`mode_${value}`),
                        icon: MODE_ICONS[value],
                    }))}
                    onChange={value => patch({ mode: value })}
                />
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1 }}
                >
                    {context.t(`mode_${mode}_hint`)}
                </Typography>
                <SourceField
                    label={context.t(mode === 'split' ? 'insp_source_forward' : 'insp_source')}
                    value={edge.value}
                    onChange={value => patch({ value: value || { oid: '' } })}
                    context={context}
                />
                {mode === 'split' ? (
                    <SourceField
                        label={context.t('insp_source_reverse')}
                        value={edge.reverse}
                        onChange={reverse => patch({ reverse })}
                        context={context}
                        clearable
                    />
                ) : null}
                <Row>
                    <TextFieldRow
                        label={context.t('insp_unit')}
                        value={edge.unit}
                        placeholder={edgeStateUnit || config.defaults?.unit || '-'}
                        helperText={edgeStateUnit && !edge.unit ? context.t('insp_unit_from_state') : undefined}
                        onChange={unit => patch({ unit })}
                    />
                    <NumberField
                        label={context.t('insp_decimals')}
                        value={edge.decimals}
                        placeholder={context.t('insp_auto')}
                        min={0}
                        max={6}
                        onChange={decimals => patch({ decimals })}
                    />
                </Row>
                <NumberField
                    label={context.t('insp_threshold')}
                    value={edge.threshold}
                    placeholder={DEFAULT_THRESHOLD}
                    helperText={context.t('insp_threshold_hint')}
                    min={0}
                    onChange={threshold => patch({ threshold })}
                />
                <CheckRow
                    label={context.t('insp_show_value')}
                    value={edge.showValue}
                    onChange={showValue => patch({ showValue })}
                />
                <CheckRow
                    label={context.t('insp_hide_when_idle')}
                    value={edge.hideWhenIdle}
                    onChange={hideWhenIdle => patch({ hideWhenIdle })}
                />
            </Section>

            <Section title={context.t('insp_appearance')}>
                <ColorRow
                    id={`ef-edge-color-${edge.id}`}
                    label={context.t('insp_color_forward')}
                    value={edge.color}
                    onChange={color => patch({ color })}
                />
                {mode !== 'positive' ? (
                    <ColorRow
                        id={`ef-edge-color-rev-${edge.id}`}
                        label={context.t('insp_color_reverse')}
                        value={edge.colorReverse}
                        onChange={colorReverse => patch({ colorReverse })}
                    />
                ) : null}
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1 }}
                >
                    {context.t('insp_color_hint')}
                </Typography>
                <NumberField
                    label={context.t('insp_line_width')}
                    value={edge.width}
                    placeholder={config.defaults?.lineWidth ?? DEFAULT_LINE_WIDTH}
                    min={0.5}
                    step={0.5}
                    onChange={width => patch({ width })}
                />
            </Section>

            <Section title={context.t('insp_routing')}>
                <SelectRow
                    label={context.t('insp_curve')}
                    value={edge.curve || 'bezier'}
                    options={EDGE_CURVES.map(value => ({
                        value,
                        label: context.t(`curve_${value}`),
                        icon: CURVE_ICONS[value],
                    }))}
                    onChange={curve => patch({ curve })}
                />
                <Row>
                    <SelectRow
                        label={context.t('insp_from_side')}
                        value={edge.fromSide || 'auto'}
                        options={SIDES.map(value => ({
                            value,
                            label: context.t(`side_${value}`),
                            icon: SIDE_ICONS[value],
                        }))}
                        onChange={fromSide => patch({ fromSide })}
                    />
                    <SelectRow
                        label={context.t('insp_to_side')}
                        value={edge.toSide || 'auto'}
                        options={SIDES.map(value => ({
                            value,
                            label: context.t(`side_${value}`),
                            icon: SIDE_ICONS[value],
                        }))}
                        onChange={toSide => patch({ toSide })}
                    />
                </Row>
                {edge.curve === 'orthogonal' && !edge.waypoints?.length ? (
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 1 }}
                    >
                        {context.t('insp_bend_hint')}
                    </Typography>
                ) : null}
                {edge.bend !== undefined && edge.curve === 'orthogonal' ? (
                    <Button
                        size="small"
                        sx={{ mt: 1 }}
                        onClick={() => patch({ bend: undefined })}
                    >
                        {context.t('insp_reset_bend')}
                    </Button>
                ) : null}
                {edge.waypoints?.length ? (
                    <Button
                        size="small"
                        sx={{ mt: 1 }}
                        onClick={() => patch({ waypoints: undefined })}
                    >
                        {context.t('insp_clear_waypoints', edge.waypoints.length)}
                    </Button>
                ) : null}
            </Section>
        </>
    );
}

function CanvasPanel(props: InspectorProps): React.JSX.Element {
    const { config, onChange, context } = props;
    const animation = { ...DEFAULT_ANIMATION, ...(config.defaults?.animation || {}) };

    const patchCanvas = (values: Partial<FlowConfig['canvas']>): void =>
        onChange({ ...config, canvas: { ...config.canvas, ...values } });

    const patchDefaults = (values: Partial<NonNullable<FlowConfig['defaults']>>): void =>
        onChange({ ...config, defaults: { ...config.defaults, ...values } });

    const patchAnimation = (values: Partial<typeof animation>): void =>
        patchDefaults({ animation: { ...config.defaults?.animation, ...values } });

    return (
        <>
            <Typography
                variant="subtitle2"
                sx={{ mb: 1 }}
            >
                {context.t('insp_diagram')}
            </Typography>

            <Section title={context.t('insp_style')}>
                <SelectRow
                    label={context.t('insp_style')}
                    value={config.defaults?.style ?? 'normal'}
                    options={DIAGRAM_STYLE_IDS.map(value => ({ value, label: context.t(`style_${value}`) }))}
                    onChange={value => patchDefaults({ style: value === 'normal' ? undefined : value })}
                />
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5 }}
                >
                    {context.t('insp_style_hint')}
                </Typography>
            </Section>

            <Section title={context.t('insp_canvas')}>
                <Row>
                    <NumberField
                        label={context.t('insp_width')}
                        value={config.canvas.w}
                        min={100}
                        step={10}
                        onChange={w => patchCanvas({ w: w ?? 900 })}
                    />
                    <NumberField
                        label={context.t('insp_height')}
                        value={config.canvas.h}
                        min={100}
                        step={10}
                        onChange={h => patchCanvas({ h: h ?? 560 })}
                    />
                </Row>
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5 }}
                >
                    {context.t('insp_canvas_hint')}
                </Typography>
                <ColorRow
                    id="ef-canvas-bg"
                    label={context.t('insp_background')}
                    value={config.canvas.background}
                    onChange={background => patchCanvas({ background })}
                />
                <NumberField
                    label={context.t('insp_grid')}
                    value={config.canvas.grid}
                    min={0}
                    onChange={grid => patchCanvas({ grid })}
                />
            </Section>

            <Section title={context.t('insp_defaults')}>
                <SelectRow
                    label={context.t('insp_medium')}
                    value={config.defaults?.medium || 'energy'}
                    options={MEDIUM_IDS.map(id => ({ value: id, label: context.t(MEDIA[id].label) }))}
                    // Picking a medium is picking its unit and its dot speed -- the two numbers a
                    // user would otherwise have to know. Both stay editable right below.
                    onChange={id =>
                        patchDefaults({
                            medium: id === 'energy' ? undefined : id,
                            unit: MEDIA[id].unit,
                            animation: {
                                ...config.defaults?.animation,
                                refPower: MEDIA[id].refValue,
                            },
                        })
                    }
                />
                <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1 }}
                >
                    {context.t('insp_medium_hint')}
                </Typography>
                <Row>
                    <TextFieldRow
                        label={context.t('insp_unit')}
                        value={config.defaults?.unit}
                        placeholder="W"
                        helperText={context.t('insp_unit_hint')}
                        onChange={unit => patchDefaults({ unit })}
                    />
                    <NumberField
                        label={context.t('insp_decimals')}
                        value={config.defaults?.decimals}
                        placeholder={context.t('insp_auto')}
                        min={0}
                        max={6}
                        onChange={decimals => patchDefaults({ decimals })}
                    />
                </Row>
                <Row>
                    <NumberField
                        label={context.t('insp_line_width')}
                        value={config.defaults?.lineWidth}
                        placeholder={DEFAULT_LINE_WIDTH}
                        min={0.5}
                        step={0.5}
                        onChange={lineWidth => patchDefaults({ lineWidth })}
                    />
                    <NumberField
                        label={context.t('insp_font_size')}
                        value={config.defaults?.fontSize}
                        placeholder={DEFAULT_FONT_SIZE}
                        min={4}
                        onChange={fontSize => patchDefaults({ fontSize })}
                    />
                </Row>
                <SelectRow
                    label={context.t('insp_edge_label')}
                    value={config.defaults?.edgeLabel || 'beside'}
                    options={(['beside', 'chip'] as const).map(value => ({
                        value,
                        label: context.t(`edge_label_${value}`),
                    }))}
                    onChange={edgeLabel => patchDefaults({ edgeLabel: edgeLabel === 'chip' ? 'chip' : undefined })}
                />
                <NumberField
                    label={context.t('insp_label_size')}
                    value={config.defaults?.labelSize}
                    // Without a value it follows the font size; the placeholder shows what that gives
                    placeholder={pageLabelSize({ ...config, defaults: { ...config.defaults, labelSize: undefined } })}
                    min={4}
                    helperText={context.t('insp_label_size_hint')}
                    onChange={labelSize => patchDefaults({ labelSize })}
                />
                <NumberField
                    label={context.t('insp_stale_after')}
                    value={config.defaults?.staleAfter}
                    placeholder="-"
                    min={0}
                    helperText={context.t('insp_stale_after_default_hint')}
                    onChange={staleAfter => patchDefaults({ staleAfter })}
                />
            </Section>

            <Section title={context.t('insp_animation')}>
                <CheckRow
                    label={context.t('insp_anim_enabled')}
                    value={animation.enabled}
                    onChange={enabled => patchAnimation({ enabled })}
                />
                <Row>
                    <NumberField
                        label={context.t('insp_anim_gap')}
                        value={config.defaults?.animation?.gap}
                        placeholder={DEFAULT_ANIMATION.gap}
                        min={4}
                        onChange={gap => patchAnimation({ gap })}
                    />
                    <NumberField
                        label={context.t('insp_anim_dot')}
                        value={config.defaults?.animation?.dotSize}
                        placeholder={DEFAULT_ANIMATION.dotSize}
                        min={1}
                        onChange={dotSize => patchAnimation({ dotSize })}
                    />
                </Row>
                <NumberField
                    label={context.t('insp_anim_ref_power')}
                    value={config.defaults?.animation?.refPower}
                    placeholder={DEFAULT_ANIMATION.refPower}
                    helperText={context.t('insp_anim_ref_power_hint')}
                    min={1}
                    step={100}
                    onChange={refPower => patchAnimation({ refPower })}
                />
                <Row>
                    <NumberField
                        label={context.t('insp_anim_min')}
                        value={config.defaults?.animation?.minDuration}
                        placeholder={DEFAULT_ANIMATION.minDuration}
                        min={0.05}
                        step={0.1}
                        onChange={minDuration => patchAnimation({ minDuration })}
                    />
                    <NumberField
                        label={context.t('insp_anim_max')}
                        value={config.defaults?.animation?.maxDuration}
                        placeholder={DEFAULT_ANIMATION.maxDuration}
                        min={0.1}
                        step={0.1}
                        onChange={maxDuration => patchAnimation({ maxDuration })}
                    />
                </Row>
            </Section>

            <Divider sx={{ my: 2 }} />
            <Typography
                variant="caption"
                color="text.secondary"
            >
                {context.t('insp_counts', config.nodes.length, config.edges.length)}
            </Typography>
            <ShortcutHint context={context} />
        </>
    );
}

/** Several nodes: what they are, and what can be done with all of them at once */
function MultiPanel(props: InspectorProps & { ids: string[] }): React.JSX.Element {
    const { config, ids, onChange, onSelect, context } = props;
    const nodes = config.nodes.filter(node => ids.includes(node.id));

    return (
        <>
            <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
            >
                <Typography variant="subtitle2">{context.t('insp_nodes_selected', nodes.length)}</Typography>
                <Tooltip title={context.t('insp_delete_nodes')}>
                    <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                            onChange(removeNodes(config, ids));
                            onSelect({ kind: 'canvas' });
                        }}
                    >
                        <Delete fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Stack>
            <Stack
                direction="row"
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
            >
                {nodes.map(node => (
                    <Button
                        key={node.id}
                        size="small"
                        variant="outlined"
                        // One click narrows the selection to this node, to edit it
                        onClick={() => onSelect({ kind: 'node', id: node.id })}
                        sx={{ textTransform: 'none' }}
                    >
                        {node.label || node.id}
                    </Button>
                ))}
            </Stack>
            <ShortcutHint context={context} />
        </>
    );
}

export function Inspector(props: InspectorProps): React.JSX.Element {
    const { config, selection } = props;

    if (selection.kind === 'node') {
        const node = config.nodes.find(item => item.id === selection.id);
        if (node) {
            return (
                <NodePanel
                    {...props}
                    node={node}
                />
            );
        }
    }

    if (selection.kind === 'nodes') {
        // Undo can take nodes away under a selection; what is left decides which panel fits
        const ids = selection.ids.filter(id => config.nodes.some(node => node.id === id));
        if (ids.length > 1) {
            return (
                <MultiPanel
                    {...props}
                    ids={ids}
                />
            );
        }
        const node = config.nodes.find(item => item.id === ids[0]);
        if (node) {
            return (
                <NodePanel
                    {...props}
                    node={node}
                />
            );
        }
    }

    if (selection.kind === 'edge') {
        const edge = config.edges.find(item => item.id === selection.id);
        if (edge) {
            return (
                <EdgePanel
                    {...props}
                    edge={edge}
                />
            );
        }
    }

    return <CanvasPanel {...props} />;
}

export default Inspector;
