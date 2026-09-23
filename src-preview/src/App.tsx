/**
 * The development preview.
 *
 * `GenericApp` does the ioBroker plumbing, exactly as in the admin tab. On top of it three pages, one
 * per place the admin-side GUI appears -- so each can be worked on with hot reload instead of a build
 * and an upload per change:
 *
 * - **Admin tab** -- the page of `src-admin`, the very same component.
 * - **Widget** -- a stored diagram as a vis-2 widget or a device card draws it, with live values.
 * - **Configuration** -- the attribute editor that vis-2, ioBroker.devices and adapter configuration
 *   pages show, with the value it would store.
 */
import React from 'react';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import {
    AppBar,
    Box,
    CssBaseline,
    IconButton,
    MenuItem,
    Paper,
    Select,
    Tab,
    Tabs,
    Toolbar,
    Tooltip,
    Typography,
} from '@mui/material';
import { Brightness4, Brightness7 } from '@mui/icons-material';

import {
    AdminConnection,
    GenericApp,
    I18n,
    Loader,
    type GenericAppProps,
    type GenericAppState,
} from '@iobroker/gui-components';

import translations, { I18N_PREFIX } from '@flow/i18n';
import type { EditorContext } from '@flow/editor';

import DiagramManager from '../../src-admin/src/DiagramManager';
import { WidgetPreview } from './WidgetPreview';
import { ConfigPreview } from './ConfigPreview';

type Page = 'admin' | 'widget' | 'config';

const PAGES: Page[] = ['admin', 'widget', 'config'];

/** Languages the dictionary actually has; the others fall back to English anyway */
const LANGUAGES: ioBroker.Languages[] = ['de', 'en'];

const PAGE_KEY = 'flow.preview.page';

interface AppState extends GenericAppState {
    page: Page;
    lang: ioBroker.Languages;
}

function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

function readPage(): Page {
    try {
        const stored = window.localStorage.getItem(PAGE_KEY) as Page | null;
        return stored && PAGES.includes(stored) ? stored : 'admin';
    } catch {
        return 'admin';
    }
}

/**
 * Where admin is: `ADMIN_URL` in `vite.config.ts`. Always explicit -- the socket client only guesses
 * 8081 on port 3000, and the preview runs elsewhere.
 */
function adminSocket(): GenericAppProps['socket'] {
    return { protocol: __ADMIN_PROTOCOL__, host: __ADMIN_HOST__, port: __ADMIN_PORT__ };
}

export default class App extends GenericApp<GenericAppProps, AppState> {
    constructor(props: GenericAppProps) {
        const extendedProps: GenericAppProps = { ...props };
        extendedProps.bottomButtons = false;
        // @ts-expect-error the two connection classes differ only in their admin-only methods
        extendedProps.Connection = AdminConnection;
        extendedProps.adapterName = 'flow';
        extendedProps.socket = adminSocket();
        super(props, { ...extendedProps, doNotLoadAllObjects: true });

        // Same registration as the admin tab: a copy, because `extendTranslations` rewrites its input
        const copy: Record<string, unknown> = {};
        for (const [language, words] of Object.entries(translations)) {
            copy[language] = typeof words === 'string' ? words : { ...(words as Record<string, string>) };
        }
        I18n.extendTranslations(copy);

        const theme = this.createTheme();
        this.state = {
            ...this.state,
            theme,
            themeName: this.getThemeName(theme),
            themeType: this.getThemeType(theme),
            page: readPage(),
            lang: I18n.getLanguage(),
        };
    }

    /** The language is only known once the system configuration has arrived */
    onConnectionReady(): void {
        this.setState({ lang: I18n.getLanguage() });
    }

    setPage(page: Page): void {
        try {
            window.localStorage.setItem(PAGE_KEY, page);
        } catch {
            // Only a convenience; the preview starts on the admin tab next time
        }
        this.setState({ page });
    }

    setLanguage(lang: ioBroker.Languages): void {
        I18n.setLanguage(lang);
        this.setState({ lang });
    }

    renderPage(): React.JSX.Element {
        const instance = this.instance || 0;
        const context: EditorContext = {
            socket: this.socket,
            theme: this.state.theme,
            themeType: this.state.themeType,
            lang: this.state.lang,
            // The preview is served by Vite, the icons of the adapters by the admin
            imagePrefix: `${__ADMIN_PROTOCOL__}//${__ADMIN_HOST__}:${__ADMIN_PORT__}`,
            t,
        };

        if (this.state.page === 'widget') {
            return (
                <WidgetPreview
                    context={context}
                    instance={instance}
                />
            );
        }
        if (this.state.page === 'config') {
            return (
                <ConfigPreview
                    context={context}
                    instance={instance}
                />
            );
        }
        return (
            <DiagramManager
                socket={this.socket}
                theme={this.state.theme}
                themeType={this.state.themeType}
                instance={instance}
            />
        );
    }

    render(): React.JSX.Element {
        if (!this.state.loaded) {
            return (
                <StyledEngineProvider injectFirst>
                    <ThemeProvider theme={this.state.theme}>
                        <CssBaseline />
                        <Loader themeType={this.state.themeType} />
                    </ThemeProvider>
                </StyledEngineProvider>
            );
        }

        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <CssBaseline />
                    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <AppBar
                            position="static"
                            color="primary"
                            enableColorOnDark
                        >
                            <Toolbar
                                variant="dense"
                                sx={{ gap: 2 }}
                            >
                                <Typography variant="subtitle1">Flow · preview</Typography>
                                <Tabs
                                    value={this.state.page}
                                    onChange={(_event, page: Page) => this.setPage(page)}
                                    textColor="inherit"
                                    indicatorColor="secondary"
                                    sx={{ flex: 1, minHeight: 48 }}
                                >
                                    <Tab
                                        value="admin"
                                        label="Admin tab"
                                    />
                                    <Tab
                                        value="widget"
                                        label="Widget"
                                    />
                                    <Tab
                                        value="config"
                                        label="Configuration"
                                    />
                                </Tabs>
                                <Select
                                    variant="standard"
                                    value={this.state.lang}
                                    onChange={event => this.setLanguage(event.target.value)}
                                    sx={{ color: 'inherit', '& .MuiSvgIcon-root': { color: 'inherit' } }}
                                    disableUnderline
                                >
                                    {LANGUAGES.map(lang => (
                                        <MenuItem
                                            key={lang}
                                            value={lang}
                                        >
                                            {lang}
                                        </MenuItem>
                                    ))}
                                </Select>
                                <Tooltip title="Light / dark">
                                    <IconButton
                                        color="inherit"
                                        onClick={() => this.toggleTheme()}
                                    >
                                        {this.state.themeType === 'dark' ? <Brightness7 /> : <Brightness4 />}
                                    </IconButton>
                                </Tooltip>
                            </Toolbar>
                        </AppBar>
                        <Paper
                            square
                            elevation={0}
                            // Remounted per language: the pages read the language once, as the hosts
                            // do, and a real host never switches it while a page is open
                            key={this.state.lang}
                            sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
                        >
                            {this.renderPage()}
                        </Paper>
                    </Box>
                    {this.renderError()}
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}
