/**
 * The page of the admin tab: the stored diagrams on the left, the designer on the right.
 *
 * The designer is the same component a widget opens as a dialog, here in its `inline` variant: it
 * fills the page, stays open after saving, and its cancel button becomes "discard changes". What it
 * saves goes into the diagram's state, and every vis-2 widget and device-manager card that refers to
 * the diagram picks the change up from there -- without vis being opened at all.
 */
import React from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Menu,
    MenuItem,
    Snackbar,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Add,
    ContentCopy,
    Delete,
    Download,
    DriveFileRenameOutline,
    FileUpload,
    Menu as MenuIcon,
    MenuOpen,
    MoreVert,
} from '@mui/icons-material';

import { I18n, type AdminConnection, type IobTheme, type ThemeType } from '@iobroker/gui-components';

import {
    createBundle,
    diagramFileName,
    diagramShortId,
    emptyConfig,
    nameFromFileName,
    readImport,
    slugify,
    type EnergyFlowConfig,
    type ImportItem,
} from '@energyflow/core';
import {
    createDiagram,
    deleteDiagram,
    downloadText,
    EnergyFlowEditor,
    ImportSummary,
    importErrorText,
    pickFiles,
    loadDiagram,
    ResizeHandle,
    usePersistentState,
    renameDiagram,
    saveDiagram,
    useStoredDiagrams,
    type EditorContext,
} from '@energyflow/editor';
import { I18N_PREFIX } from '@energyflow/i18n';

export interface DiagramManagerProps {
    socket: AdminConnection;
    theme: IobTheme;
    themeType: ThemeType;
    instance: number;
}

function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

/** Limits of the diagram list, in pixels */
const LIST_DEFAULT = 260;
const LIST_MIN = 180;
const LIST_MAX = 520;

/** The small dialogs of this page. One at a time, so one piece of state describes which. */
type Prompt =
    | { kind: 'none' }
    | { kind: 'create' }
    | { kind: 'rename'; id: string; name: string }
    | { kind: 'delete'; id: string; name: string }
    /**
     * About to leave a diagram with unsaved changes. `then` is what the user was about to do --
     * select another diagram, create or duplicate one -- and runs once they agree to discard.
     */
    | { kind: 'unsaved'; then: () => void }
    /**
     * What a set of picked files turned out to contain, shown before anything is created: which
     * diagrams will appear, what a conversion had to leave out, and which files could not be read.
     */
    | {
          kind: 'import';
          items: { item: ImportItem; fileName: string }[];
          failures: { fileName: string; message: string }[];
      };

export function DiagramManager(props: DiagramManagerProps): React.JSX.Element {
    const { socket, theme, themeType, instance } = props;

    const context: EditorContext = React.useMemo(
        () => ({
            // AdminConnection extends Connection; the designer needs nothing admin-specific
            socket: socket,
            theme,
            themeType,
            lang: I18n.getLanguage(),
            t,
        }),
        [socket, theme, themeType],
    );

    const { diagrams, loading, reload } = useStoredDiagrams(context.socket, instance);

    const [selected, setSelected] = React.useState<string | null>(null);
    /** The loaded content of the selected diagram; `undefined` while it is being fetched */
    const [content, setContent] = React.useState<{ id: string; config: EnergyFlowConfig } | undefined>();
    /** Bumped to remount the designer, which is how "discard changes" restores the stored version */
    const [generation, setGeneration] = React.useState(0);
    const [dirty, setDirty] = React.useState(false);
    const [prompt, setPrompt] = React.useState<Prompt>({ kind: 'none' });
    const [nameDraft, setNameDraft] = React.useState('');
    const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
    const [toast, setToast] = React.useState<string | null>(null);
    /** Width and visibility of the diagram list, remembered per browser */
    const [list, setList] = usePersistentState('energyflow.tab.list', { width: LIST_DEFAULT, open: true });

    // Open the first diagram once the list has arrived, so the page is not empty for no reason
    const firstId = diagrams[0]?.id;
    const effectiveSelected = selected && diagrams.some(entry => entry.id === selected) ? selected : (firstId ?? null);

    React.useEffect(() => {
        if (!effectiveSelected) {
            return undefined;
        }
        let cancelled = false;
        loadDiagram(context.socket, effectiveSelected)
            .then(config => {
                if (!cancelled) {
                    setContent({ id: effectiveSelected, config: config ?? emptyConfig() });
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setToast(String(error));
                    setContent({ id: effectiveSelected, config: emptyConfig() });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [effectiveSelected, generation, context.socket]);

    const current = diagrams.find(entry => entry.id === effectiveSelected);
    const loaded = content && content.id === effectiveSelected ? content.config : undefined;

    /**
     * Run something that leaves the current diagram, asking first if it has unsaved changes. Every way
     * of leaving goes through here -- selecting another one, creating one, duplicating one -- so none
     * of them can throw an edit away silently.
     */
    const guard = (action: () => void): void => {
        if (dirty) {
            setPrompt({ kind: 'unsaved', then: action });
            return;
        }
        action();
    };

    const requestSelect = (id: string | null): void => {
        if (id === effectiveSelected) {
            return;
        }
        guard(() => {
            setSelected(id);
            setDirty(false);
        });
    };

    const onSave = (config: EnergyFlowConfig): void => {
        if (!effectiveSelected) {
            return;
        }
        saveDiagram(context.socket, effectiveSelected, config)
            .then(() => {
                // Keep the loaded copy in step, so a later "discard" returns to what was saved now
                setContent({ id: effectiveSelected, config });
                setToast(t('tab_saved'));
            })
            .catch((error: unknown) => setToast(String(error)));
    };

    const create = async (name: string, config: EnergyFlowConfig): Promise<void> => {
        try {
            const id = await createDiagram(context.socket, name, config, instance);
            reload();
            setSelected(id);
            setDirty(false);
        } catch (error) {
            setToast(String(error));
        }
    };

    const closePrompt = (): void => setPrompt({ kind: 'none' });

    /**
     * Pick files and show what they contain. Every file is read with the same reader the designer's
     * paste box uses: a single diagram, a set exported by "export all", or an energiefluss-erweitert
     * configuration. Nothing is created until the user confirms the preview.
     */
    const startImport = async (): Promise<void> => {
        let files;
        try {
            files = await pickFiles({ multiple: true });
        } catch (error) {
            setToast(String(error));
            return;
        }
        if (!files.length) {
            return;
        }
        const items: { item: ImportItem; fileName: string }[] = [];
        const failures: { fileName: string; message: string }[] = [];
        for (const file of files) {
            const result = readImport(file.text, nameFromFileName(file.name));
            if ('error' in result) {
                failures.push({ fileName: file.name, message: importErrorText(result.error, result.detail, t) });
            } else {
                for (const item of result.items) {
                    items.push({ item, fileName: file.name });
                }
            }
        }
        setPrompt({ kind: 'import', items, failures });
    };

    /** Create one stored diagram per imported item. Existing diagrams are never overwritten. */
    const runImport = async (items: ImportItem[]): Promise<void> => {
        let first: string | null = null;
        let created = 0;
        let failure: string | null = null;
        try {
            // One after the other: each creation lists the existing ids to find a free one, and two
            // imports of "PV" running in parallel would both pick `pv`
            for (const item of items) {
                const id = await createDiagram(context.socket, item.name, item.config, instance);
                first ??= id;
                created++;
            }
        } catch (error) {
            // What was created before the failure stays; the message says why the rest is missing
            failure = String(error);
        }
        reload();
        setToast(failure ?? t('tab_imported', created));
        // Show what was imported -- unless that would throw away unsaved edits of the open diagram
        if (first && !dirty) {
            setSelected(first);
        }
    };

    /** The stored diagrams as one file: the backup, or the set to move to another installation */
    const exportAll = async (): Promise<void> => {
        try {
            const entries: { name: string; config: EnergyFlowConfig }[] = [];
            for (const entry of diagrams) {
                const config = await loadDiagram(context.socket, entry.id);
                if (config) {
                    entries.push({ name: entry.name, config });
                }
            }
            const day = new Date().toISOString().slice(0, 10);
            downloadText(`energyflow-diagrams-${day}.json`, JSON.stringify(createBundle(entries), null, 4));
            if (dirty) {
                setToast(t('tab_export_unsaved'));
            }
        } catch (error) {
            setToast(String(error));
        }
    };

    /** One diagram as one file, in exactly the form a widget stores -- so it can be pasted anywhere */
    const exportCurrent = (): void => {
        if (!current || !loaded) {
            return;
        }
        downloadText(diagramFileName(slugify(current.name)), JSON.stringify(loaded, null, 4));
        if (dirty) {
            // What is exported is what is stored; say so, instead of letting the file look complete
            setToast(t('tab_export_unsaved'));
        }
    };

    const confirmPrompt = async (): Promise<void> => {
        const name = nameDraft.trim();
        try {
            if (prompt.kind === 'create' && name) {
                await create(name, emptyConfig());
            } else if (prompt.kind === 'rename' && name) {
                await renameDiagram(context.socket, prompt.id, name);
                reload();
            } else if (prompt.kind === 'delete') {
                await deleteDiagram(context.socket, prompt.id);
                setSelected(null);
                setDirty(false);
                reload();
            } else if (prompt.kind === 'import') {
                const items = prompt.items.map(entry => entry.item);
                closePrompt();
                await runImport(items);
                return;
            } else if (prompt.kind === 'unsaved') {
                // Close first: the continuation may open a prompt of its own (the name of a new
                // diagram), and the later of two state updates in one batch is the one that stays
                closePrompt();
                setDirty(false);
                prompt.then();
                return;
            }
        } catch (error) {
            setToast(String(error));
        }
        closePrompt();
    };

    const openNamePrompt = (next: Prompt, initial: string): void => {
        setNameDraft(initial);
        setPrompt(next);
    };

    const menu = current ? (
        <>
            <Tooltip title={t('tab_more')}>
                <IconButton
                    size="small"
                    onClick={event => setMenuAnchor(event.currentTarget)}
                    sx={{ mr: 1 }}
                >
                    <MoreVert />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={menuAnchor}
                open={!!menuAnchor}
                onClose={() => setMenuAnchor(null)}
            >
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        openNamePrompt({ kind: 'rename', id: current.id, name: current.name }, current.name);
                    }}
                >
                    <DriveFileRenameOutline
                        fontSize="small"
                        sx={{ mr: 1 }}
                    />
                    {t('tab_rename')}
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        // Duplicate what is stored, not unsaved edits: a copy of a half-finished
                        // edit would be surprising. The copy is then selected, which leaves the
                        // original -- so this goes through the unsaved-changes guard as well
                        const name = `${current.name} (${t('tab_copy_suffix')})`;
                        const config = loaded ?? emptyConfig();
                        guard(() => void create(name, config));
                    }}
                >
                    <ContentCopy
                        fontSize="small"
                        sx={{ mr: 1 }}
                    />
                    {t('tab_duplicate')}
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        exportCurrent();
                    }}
                >
                    <Download
                        fontSize="small"
                        sx={{ mr: 1 }}
                    />
                    {t('tab_export')}
                </MenuItem>
                <Divider />
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        setPrompt({ kind: 'delete', id: current.id, name: current.name });
                    }}
                    sx={{ color: 'error.main' }}
                >
                    <Delete
                        fontSize="small"
                        sx={{ mr: 1 }}
                    />
                    {t('tab_delete')}
                </MenuItem>
            </Menu>
        </>
    ) : null;

    const editorShown = !!(effectiveSelected && loaded);
    /**
     * Without the designer there is nothing to put a "show the list" button into -- so while there is
     * no diagram to edit, the list is shown whatever the preference says, or the page would be a dead end.
     */
    const listShown = list.open || !editorShown;

    const listToggle = (
        <Tooltip title={t(list.open ? 'tab_list_hide' : 'tab_list_show')}>
            <IconButton
                size="small"
                onClick={() => setList(previous => ({ ...previous, open: !previous.open }))}
                sx={{ mr: 1 }}
            >
                {list.open ? <MenuOpen /> : <MenuIcon />}
            </IconButton>
        </Tooltip>
    );

    return (
        <Box sx={{ display: 'flex', height: '100%' }}>
            {/* The list of stored diagrams -- the handle next to it draws the dividing line */}
            <Box
                sx={{
                    width: list.width,
                    flexShrink: 0,
                    display: listShown ? 'flex' : 'none',
                    flexDirection: 'column',
                    minWidth: 0,
                }}
            >
                <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}
                >
                    <Typography
                        variant="h6"
                        noWrap
                        sx={{ flex: 1, minWidth: 0 }}
                    >
                        {t('tab_title')}
                    </Typography>
                    <Tooltip title={t('tab_import')}>
                        <IconButton
                            size="small"
                            onClick={() => void startImport()}
                        >
                            <FileUpload fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('tab_export_all')}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!diagrams.length}
                                onClick={() => void exportAll()}
                            >
                                <Download fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('tab_new')}>
                        <IconButton
                            color="primary"
                            onClick={() => guard(() => openNamePrompt({ kind: 'create' }, ''))}
                        >
                            <Add />
                        </IconButton>
                    </Tooltip>
                </Stack>
                <Divider />
                <List
                    dense
                    sx={{ flex: 1, overflowY: 'auto' }}
                >
                    {diagrams.map(entry => (
                        <ListItemButton
                            key={entry.id}
                            selected={entry.id === effectiveSelected}
                            onClick={() => requestSelect(entry.id)}
                        >
                            <ListItemText
                                primary={entry.name}
                                secondary={diagramShortId(entry.id)}
                            />
                        </ListItemButton>
                    ))}
                </List>
            </Box>
            {listShown ? (
                <ResizeHandle
                    panel="left"
                    width={list.width}
                    min={LIST_MIN}
                    max={LIST_MAX}
                    defaultWidth={LIST_DEFAULT}
                    tooltip={t('editor_resize_hint')}
                    onChange={width => setList(previous => ({ ...previous, width }))}
                />
            ) : null}

            {/* The designer, or an explanation when there is nothing to design yet */}
            <Box sx={{ flex: 1, minWidth: 0, height: '100%' }}>
                {!loading && !diagrams.length ? (
                    <Stack
                        spacing={2}
                        sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', p: 4 }}
                    >
                        <Typography variant="h6">{t('tab_empty')}</Typography>
                        <Typography
                            color="text.secondary"
                            sx={{ maxWidth: 520, textAlign: 'center' }}
                        >
                            {t('tab_empty_hint')}
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<Add />}
                            onClick={() => openNamePrompt({ kind: 'create' }, '')}
                        >
                            {t('tab_new')}
                        </Button>
                    </Stack>
                ) : editorShown ? (
                    <EnergyFlowEditor
                        // A new id or a discard remounts it, which reinitialises the undo stack and
                        // the "clean" baseline from what is stored
                        key={`${effectiveSelected}:${generation}`}
                        variant="inline"
                        open
                        value={loaded}
                        onSave={onSave}
                        onClose={() => {
                            setGeneration(value => value + 1);
                            setDirty(false);
                        }}
                        onDirtyChange={setDirty}
                        context={context}
                        title={current?.name}
                        toolbarExtra={menu}
                        toolbarStart={listToggle}
                    />
                ) : null}
            </Box>

            <Dialog
                open={prompt.kind === 'create' || prompt.kind === 'rename'}
                onClose={closePrompt}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>{t(prompt.kind === 'rename' ? 'tab_rename' : 'tab_new')}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        variant="standard"
                        label={t('tab_name')}
                        value={nameDraft}
                        onChange={event => setNameDraft(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter' && nameDraft.trim()) {
                                void confirmPrompt();
                            }
                        }}
                        helperText={prompt.kind === 'rename' ? t('tab_rename_hint') : undefined}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={closePrompt}>{t('cancel')}</Button>
                    <Button
                        variant="contained"
                        disabled={!nameDraft.trim()}
                        onClick={() => void confirmPrompt()}
                    >
                        {t(prompt.kind === 'rename' ? 'tab_rename' : 'tab_create')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={prompt.kind === 'delete' || prompt.kind === 'unsaved'}
                onClose={closePrompt}
            >
                <DialogTitle>{t(prompt.kind === 'delete' ? 'tab_delete' : 'tab_unsaved')}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {prompt.kind === 'delete'
                            ? t('tab_delete_confirm', prompt.name)
                            : t('tab_unsaved_text', current?.name ?? '')}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closePrompt}>{t('cancel')}</Button>
                    <Button
                        variant="contained"
                        color={prompt.kind === 'delete' ? 'error' : 'primary'}
                        onClick={() => void confirmPrompt()}
                    >
                        {t(prompt.kind === 'delete' ? 'tab_delete' : 'tab_discard')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={prompt.kind === 'import'}
                onClose={closePrompt}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>{t('tab_import_title')}</DialogTitle>
                <DialogContent>
                    {prompt.kind === 'import' ? (
                        <>
                            {prompt.items.length ? (
                                <>
                                    <DialogContentText sx={{ mb: 1 }}>{t('tab_import_intro')}</DialogContentText>
                                    <List dense>
                                        {prompt.items.map(({ item, fileName }, index) => (
                                            <ListItem
                                                key={`${fileName}:${index}`}
                                                sx={{ display: 'block', px: 0 }}
                                            >
                                                <ListItemText
                                                    primary={item.name}
                                                    secondary={
                                                        item.source === 'energiefluss'
                                                            ? t('tab_import_converted')
                                                            : t('tab_import_from_bundle', fileName)
                                                    }
                                                />
                                                {item.source === 'energiefluss' ? (
                                                    <ImportSummary
                                                        item={item}
                                                        context={context}
                                                    />
                                                ) : null}
                                            </ListItem>
                                        ))}
                                    </List>
                                </>
                            ) : (
                                <DialogContentText>{t('tab_import_nothing')}</DialogContentText>
                            )}
                            {prompt.failures.length ? (
                                <>
                                    <Typography
                                        variant="subtitle2"
                                        color="error"
                                        sx={{ mt: 2 }}
                                    >
                                        {t('tab_import_failed')}
                                    </Typography>
                                    <List dense>
                                        {prompt.failures.map(failure => (
                                            <ListItem
                                                key={failure.fileName}
                                                sx={{ px: 0 }}
                                            >
                                                <ListItemText
                                                    primary={failure.fileName}
                                                    secondary={failure.message}
                                                />
                                            </ListItem>
                                        ))}
                                    </List>
                                </>
                            ) : null}
                        </>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={closePrompt}>{t('cancel')}</Button>
                    <Button
                        variant="contained"
                        disabled={prompt.kind !== 'import' || !prompt.items.length}
                        onClick={() => void confirmPrompt()}
                    >
                        {t('tab_import_ok', prompt.kind === 'import' ? prompt.items.length : 0)}
                    </Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={!!toast}
                autoHideDuration={2500}
                onClose={() => setToast(null)}
                message={toast}
            />
        </Box>
    );
}

export default DiagramManager;
