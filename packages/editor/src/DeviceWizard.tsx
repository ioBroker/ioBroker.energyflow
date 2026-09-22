/**
 * "Build it from my devices": every state that reports power, with a guess what it is, and a diagram
 * from what the user keeps. See `assistant.ts` in the core for the guessing and the layout.
 */
import React from 'react';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItem,
    TextField,
    Typography,
} from '@mui/material';

import {
    buildFromDevices,
    guessDevice,
    PRESELECT_LIMITS,
    isPowerState,
    isSocState,
    objectName,
    type DeviceKind,
    type EnergyFlowConfig,
} from '@energyflow/core';

import { SelectRow } from './fields';
import { KIND_ICONS } from './optionIcons';
import { RANGE_END } from './storedDiagrams';
import type { EditorContext } from './types';

export interface DeviceWizardProps {
    open: boolean;
    onClose: () => void;
    onPick: (config: EnergyFlowConfig) => void;
    context: EditorContext;
}

interface Candidate {
    oid: string;
    name: string;
    unit: string;
    kind: DeviceKind;
    checked: boolean;
    /** How sure the guess is, see `guessDevice` */
    confidence: number;
}

const KINDS: DeviceKind[] = ['source', 'grid', 'storage', 'sink'];
const ORDER: Record<DeviceKind, number> = { source: 0, grid: 1, storage: 2, sink: 3 };

/** More than this and the list is filtered before it is shown -- nobody scrolls through 3000 Shelly plugs */
const SHOWN = 300;

function WizardBody(props: DeviceWizardProps): React.JSX.Element {
    const { onClose, onPick, context } = props;
    const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
    const [socs, setSocs] = React.useState<{ oid: string; name: string }[]>([]);
    const [soc, setSoc] = React.useState('');
    const [filter, setFilter] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        context.socket
            .getObjectView('', RANGE_END, 'state')
            .then(objects => {
                if (cancelled) {
                    return;
                }
                const found: Candidate[] = [];
                const charges: { oid: string; name: string }[] = [];
                for (const [oid, object] of Object.entries(objects || {})) {
                    // The system's own states report memory and CPU, never energy
                    if (!object || oid.startsWith('system.')) {
                        continue;
                    }
                    const common = object.common as { unit?: unknown; role?: unknown; type?: unknown; name?: unknown };
                    const name = objectName(common?.name, context.lang);
                    if (isPowerState(common)) {
                        const guess = guessDevice(oid, name);
                        found.push({
                            oid,
                            name,
                            unit: typeof common.unit === 'string' ? common.unit : '',
                            kind: guess.kind ?? 'sink',
                            checked: false,
                            confidence: guess.confidence,
                        });
                    } else if (isSocState(oid, name, common)) {
                        charges.push({ oid, name });
                    }
                }
                found.sort(
                    (a, b) =>
                        b.confidence - a.confidence || ORDER[a.kind] - ORDER[b.kind] || a.oid.localeCompare(b.oid),
                );
                // Tick only sure guesses, and only as many as make a readable diagram; everything else is
                // listed for the user to tick
                const ticked: Record<DeviceKind, number> = { source: 0, grid: 0, storage: 0, sink: 0 };
                for (const item of found) {
                    if (item.confidence >= 2 && ticked[item.kind] < PRESELECT_LIMITS[item.kind]) {
                        item.checked = true;
                        ticked[item.kind]++;
                    }
                }
                setCandidates(found);
                setSocs(charges);
                setSoc(charges[0]?.oid ?? '');
            })
            .catch((caught: unknown) => !cancelled && setError(String(caught)));
        return () => {
            cancelled = true;
        };
    }, [context.socket, context.lang]);

    const update = (oid: string, patch: Partial<Candidate>): void =>
        setCandidates(previous => previous && previous.map(item => (item.oid === oid ? { ...item, ...patch } : item)));

    const needle = filter.trim().toLowerCase();
    const visible = (candidates || []).filter(
        item => !needle || item.oid.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
    );
    const chosen = (candidates || []).filter(item => item.checked);

    const create = (): void => {
        onPick(
            buildFromDevices(
                chosen.map(item => ({
                    oid: item.oid,
                    kind: item.kind,
                    label: item.name || item.oid.split('.').pop() || item.oid,
                })),
                {
                    home: context.t('wizard_home'),
                    soc: chosen.some(item => item.kind === 'storage') ? soc || undefined : undefined,
                },
            ),
        );
        onClose();
    };

    return (
        <>
            <DialogTitle>{context.t('wizard_title')}</DialogTitle>
            <DialogContent>
                {error ? <Alert severity="error">{error}</Alert> : null}
                {!candidates && !error ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4, justifyContent: 'center' }}>
                        <CircularProgress size={24} />
                        <Typography color="text.secondary">{context.t('wizard_scanning')}</Typography>
                    </Box>
                ) : null}
                {candidates ? (
                    <>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 1 }}
                        >
                            {context.t('wizard_intro', candidates.length)}
                        </Typography>
                        <TextField
                            variant="standard"
                            size="small"
                            fullWidth
                            label={context.t('wizard_filter')}
                            value={filter}
                            onChange={event => setFilter(event.target.value)}
                        />
                        <List
                            dense
                            sx={{ maxHeight: 380, overflowY: 'auto' }}
                        >
                            {visible.slice(0, SHOWN).map(item => (
                                <ListItem
                                    key={item.oid}
                                    disableGutters
                                    sx={{ gap: 1, alignItems: 'center' }}
                                >
                                    <Checkbox
                                        size="small"
                                        checked={item.checked}
                                        onChange={event => update(item.oid, { checked: event.target.checked })}
                                    />
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography
                                            variant="body2"
                                            noWrap
                                        >
                                            {item.name || item.oid}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            noWrap
                                            component="div"
                                        >
                                            {item.oid}
                                            {item.unit ? ` (${item.unit})` : ''}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ width: 170, flexShrink: 0 }}>
                                        <SelectRow
                                            label=""
                                            value={item.kind}
                                            options={KINDS.map(kind => ({
                                                value: kind,
                                                label: context.t(`kind_${kind}`),
                                                icon: KIND_ICONS[kind],
                                            }))}
                                            onChange={kind => update(item.oid, { kind, checked: true })}
                                        />
                                    </Box>
                                </ListItem>
                            ))}
                        </List>
                        {visible.length > SHOWN ? (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                            >
                                {context.t('wizard_more', visible.length - SHOWN)}
                            </Typography>
                        ) : null}
                        {chosen.some(item => item.kind === 'storage') ? (
                            <Box sx={{ mt: 2 }}>
                                <SelectRow
                                    label={context.t('wizard_soc')}
                                    value={soc}
                                    emptyLabel={context.t('wizard_no_soc')}
                                    options={socs.map(item => ({ value: item.oid, label: item.name || item.oid }))}
                                    onChange={value => setSoc(value)}
                                />
                            </Box>
                        ) : null}
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 2 }}
                        >
                            {context.t('wizard_sign_hint')}
                        </Typography>
                    </>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{context.t('cancel')}</Button>
                <Button
                    variant="contained"
                    disabled={!chosen.length}
                    onClick={create}
                >
                    {context.t('wizard_create', chosen.length)}
                </Button>
            </DialogActions>
        </>
    );
}

export function DeviceWizard(props: DeviceWizardProps): React.JSX.Element {
    return (
        <Dialog
            open={props.open}
            onClose={props.onClose}
            fullWidth
            maxWidth="md"
        >
            {props.open ? <WizardBody {...props} /> : null}
        </Dialog>
    );
}

export default DeviceWizard;
