/**
 * What to tell the user about a file that could not be imported.
 *
 * The core reports codes, because it has no dictionary; the designer's paste box and the admin tab's
 * file import both turn them into the same sentences here.
 */
import type { ImportErrorCode } from '@energyflow/core';

import type { EditorContext } from './types';

/**
 * @param code what went wrong
 * @param detail the parser's own message, for `json`
 * @param t the translator of the host
 * @returns a sentence to show
 */
export function importErrorText(code: ImportErrorCode, detail: string | undefined, t: EditorContext['t']): string {
    switch (code) {
        case 'json':
            // The parser's message says where; the prefix says what the text was supposed to be
            return t('json_invalid', detail || '');
        case 'not-object':
            return t('json_not_an_object');
        case 'energiefluss-empty':
            return t('json_ef_nothing');
        case 'bundle-empty':
            return t('json_bundle_empty');
        case 'no-valid-nodes':
            return t('json_no_valid_nodes');
        case 'unknown-format':
        default:
            return t('json_unknown_format');
    }
}
