/**
 * The properties panel.
 *
 * Three panels behind one component: the selected node, the selected edge, or the diagram itself when
 * nothing is selected. Everything a user can configure is reachable from here, and everything that is
 * not* configured shows the default it inherits as a placeholder -- so the panel also explains what
 * the diagram is currently doing, not only what has been overridden.
 */
import React from 'react';
import { Box, Button, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Delete, Image as ImageIcon, SwapHoriz } from '@mui/icons-material';

import {
    DEFAULT_ANIMATION,
    DEFAULT_FONT_SIZE,
    DEFAULT_LINE_WIDTH,
    DEFAULT_THRESHOLD,
    nodeShape,
    removeEdge,
    removeNode,
    renameNode,
    updateEdge,
    updateNode,
    type EdgeCurve,
    type EdgeMode,
    type EnergyFlowConfig,
    type FlowEdge,
    type FlowNode,
    type NodeKind,
    type NodeShape,
    type Side,
} from '@energyflow/core';

import { CheckRow, ColorRow, NumberField, Row, Section, SelectRow, TextFieldRow } from './fields';
import { SourceField } from './SourceField';
import { IconPickerDialog, IconPreview } from './IconPicker';
import type { EditorContext, EditorSelection } from './types';

export interface InspectorProps {
    config: EnergyFlowConfig;
    selection: EditorSelection;
    onChange: (config: EnergyFlowConfig) => void;
    onSelect: (selection: EditorSelection) => void;
    context: EditorContext;
    /** Accent colour the selected node would have without an override, for the previews */
    defaultNodeColor: (kind: NodeKind) => string;
}

const NODE_KINDS: NodeKind[] = ['source', 'sink', 'storage', 'grid', 'bus', 'label', 'image'];
const NODE_SHAPES: NodeShape[] = ['circle', 'rounded', 'square'];
const EDGE_MODES: EdgeMode[] = ['signed', 'positive', 'split'];
const EDGE_CURVES: EdgeCurve[] = ['bezier', 'orthogonal', 'straight'];
const SIDES: Side[] = ['auto', 'top', 'right', 'bottom', 'left'];
const ACTION_TYPES = ['none', 'toggle', 'setValue', 'url', 'view', 'chart'] as const;

function NodePanel(props: InspectorProps & { node: FlowNode }): React.JSX.Element {
    const { config, node, onChange, onSelect, context, defaultNodeColor } = props;
    const [iconOpen, setIconOpen] = React.useState(false);
    const [idDraft, setIdDraft] = React.useState<string | null>(null);

    const patch = (values: Partial<FlowNode>): void => onChange(updateNode(config, node.id, values));
    const color = node.color || defaultNodeColor(node.kind);
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
                    options={NODE_KINDS.map(kind => ({ value: kind, label: context.t(`kind_${kind}`) }))}
                    onChange={kind => patch({ kind })}
                />
                <TextFieldRow
                    label={context.t('insp_label')}
                    value={node.label}
                    onChange={label => patch({ label })}
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
                            emptyLabel={context.t(`shape_${nodeShape({ ...node, shape: undefined })}`)}
                            options={NODE_SHAPES.map(shape => ({ value: shape, label: context.t(`shape_${shape}`) }))}
                            onChange={shape => patch({ shape: shape || undefined })}
                        />
                    ) : null}
                    <Row>
                        <NumberField
                            label={context.t('insp_width')}
                            value={node.w}
                            placeholder={context.t('insp_auto')}
                            min={4}
                            onChange={w => patch({ w })}
                        />
                        <NumberField
                            label={context.t('insp_height')}
                            value={node.h}
                            placeholder={context.t('insp_auto')}
                            min={4}
                            onChange={h => patch({ h })}
                        />
                    </Row>
                    <Row>
                        <NumberField
                            label="X"
                            value={node.x}
                            onChange={x => patch({ x: x ?? 0 })}
                        />
                        <NumberField
                            label="Y"
                            value={node.y}
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
                                placeholder={config.defaults?.unit || '-'}
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
                        <CheckRow
                            label={context.t('insp_hide_when_zero')}
                            value={node.hideWhenZero}
                            onChange={hideWhenZero => patch({ hideWhenZero })}
                        />
                    </Section>

                    {node.kind === 'storage' ? (
                        <Section title={context.t('insp_soc')}>
                            <SourceField
                                label={context.t('insp_soc_source')}
                                value={node.soc}
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
                            options={ACTION_TYPES.map(type => ({ value: type, label: context.t(`action_${type}`) }))}
                            onChange={type => patch({ action: type === 'none' ? undefined : { ...node.action, type } })}
                        />
                        {node.action &&
                        (node.action.type === 'toggle' ||
                            node.action.type === 'setValue' ||
                            node.action.type === 'chart') ? (
                            <TextFieldRow
                                label={context.t('insp_action_oid')}
                                value={node.action.oid}
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
    const patch = (values: Partial<FlowEdge>): void => onChange(updateEdge(config, edge.id, values));
    const nodeOptions = config.nodes.map(node => ({ value: node.id, label: node.label || node.id }));
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
                    options={EDGE_MODES.map(value => ({ value, label: context.t(`mode_${value}`) }))}
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
                        placeholder={config.defaults?.unit || '-'}
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
                    onChange={width => patch({ width })}
                />
            </Section>

            <Section title={context.t('insp_routing')}>
                <SelectRow
                    label={context.t('insp_curve')}
                    value={edge.curve || 'bezier'}
                    options={EDGE_CURVES.map(value => ({ value, label: context.t(`curve_${value}`) }))}
                    onChange={curve => patch({ curve })}
                />
                <Row>
                    <SelectRow
                        label={context.t('insp_from_side')}
                        value={edge.fromSide || 'auto'}
                        options={SIDES.map(value => ({ value, label: context.t(`side_${value}`) }))}
                        onChange={fromSide => patch({ fromSide })}
                    />
                    <SelectRow
                        label={context.t('insp_to_side')}
                        value={edge.toSide || 'auto'}
                        options={SIDES.map(value => ({ value, label: context.t(`side_${value}`) }))}
                        onChange={toSide => patch({ toSide })}
                    />
                </Row>
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

    const patchCanvas = (values: Partial<EnergyFlowConfig['canvas']>): void =>
        onChange({ ...config, canvas: { ...config.canvas, ...values } });

    const patchDefaults = (values: Partial<NonNullable<EnergyFlowConfig['defaults']>>): void =>
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

            <Section title={context.t('insp_canvas')}>
                <Row>
                    <NumberField
                        label={context.t('insp_width')}
                        value={config.canvas.w}
                        min={100}
                        onChange={w => patchCanvas({ w: w ?? 900 })}
                    />
                    <NumberField
                        label={context.t('insp_height')}
                        value={config.canvas.h}
                        min={100}
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
                    onChange={refPower => patchAnimation({ refPower })}
                />
                <Row>
                    <NumberField
                        label={context.t('insp_anim_min')}
                        value={config.defaults?.animation?.minDuration}
                        placeholder={DEFAULT_ANIMATION.minDuration}
                        min={0.05}
                        onChange={minDuration => patchAnimation({ minDuration })}
                    />
                    <NumberField
                        label={context.t('insp_anim_max')}
                        value={config.defaults?.animation?.maxDuration}
                        placeholder={DEFAULT_ANIMATION.maxDuration}
                        min={0.1}
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
