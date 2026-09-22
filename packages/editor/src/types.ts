/**
 * What the designer needs from whichever application it was opened in.
 *
 * Both hosts can supply all of it: vis-2 hands its widget attributes a `context` with the socket and
 * the theme, the device manager hands its settings dialog the same things. Keeping it in one small
 * interface is what makes the designer host-agnostic -- it never asks "am I in vis-2?".
 */
import type { Connection, IobTheme, ThemeType } from '@iobroker/gui-components';

export interface EditorContext {
    /** Live connection, for the state picker and the preview values */
    socket: Connection;
    /** The MUI theme of the host, needed by `DialogSelectID` */
    theme: IobTheme;
    themeType: ThemeType;
    lang: ioBroker.Languages;
    /** Translates a key of this widget set */
    t: (key: string, ...args: (string | number)[]) => string;
}

/**
 * What the designer currently has selected. One node is `node`, two or more are `nodes` -- the
 * inspector edits a single node and only offers what applies to all of them for several, so the two
 * are kept apart instead of `node` being a list of one. Build them with `selectNodes`.
 */
export type EditorSelection =
    | { kind: 'none' }
    | { kind: 'canvas' }
    | { kind: 'node'; id: string }
    | { kind: 'nodes'; ids: string[] }
    | { kind: 'edge'; id: string };
