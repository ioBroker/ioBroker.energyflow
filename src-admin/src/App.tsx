/**
 * The admin tab "Energy flow".
 *
 * `GenericApp` does the ioBroker plumbing -- the socket, the theme admin is in, the language -- and
 * everything else is {@link DiagramManager}.
 */
import React from 'react';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import { CssBaseline, Paper } from '@mui/material';

import { AdminConnection, GenericApp, I18n, Loader, type GenericAppProps } from '@iobroker/gui-components';

import translations from '@energyflow/i18n';

import DiagramManager from './DiagramManager';

export default class App extends GenericApp {
    constructor(props: GenericAppProps) {
        const extendedProps: GenericAppProps = { ...props };
        // A tab has no settings to save, so the save/close bar of a configuration page is not wanted
        extendedProps.bottomButtons = false;
        // @ts-expect-error the two connection classes differ only in their admin-only methods
        extendedProps.Connection = AdminConnection;
        extendedProps.adapterName = 'energyflow';
        super(props, { ...extendedProps, doNotLoadAllObjects: true });

        // The dictionary carries a `prefix`, which `extendTranslations` understands and the
        // `translations` prop of GenericApp does not -- so it is registered here, as a copy, because
        // `extendTranslations` rewrites the object it is handed
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
        };
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
                    <Paper
                        square
                        elevation={0}
                        style={{ height: '100%', overflow: 'hidden' }}
                    >
                        <DiagramManager
                            socket={this.socket}
                            theme={this.state.theme}
                            themeType={this.state.themeType}
                            instance={this.instance || 0}
                        />
                    </Paper>
                    {this.renderError()}
                </ThemeProvider>
            </StyledEngineProvider>
        );
    }
}
