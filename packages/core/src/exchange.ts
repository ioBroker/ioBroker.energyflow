/**
 * Moving diagrams in and out as files.
 *
 * Three shapes of file are understood, and {@link readImport} tells them apart so that neither the
 * designer's paste box nor the admin tab has to ask the user what they are holding:
 *
 * - **A diagram** -- what the designer exports: one document, `{ v, canvas, nodes, edges }`.
 * - **A bundle** -- what "export all" in the admin tab writes: several diagrams with their names, for
 *   a backup or to move a set of diagrams to another installation.
 * - **An `energiefluss-erweitert` configuration** -- converted on the way in, see `importEnergiefluss.ts`.
 *
 * A diagram file carries no name of its own; the name is the file name. That keeps an exported diagram
 * identical to what a widget stores, so the same file works in every place a diagram is pasted.
 */
import { normalizeConfig } from './defaults';
import { importEnergiefluss, isEnergiefluss, type ImportResult, type ImportWarning } from './importEnergiefluss';
import type { FlowConfig } from './types';

/** Marks a bundle file; checked on import, so no other JSON is mistaken for one */
export const BUNDLE_FORMAT = 'iobroker.flow/diagrams';

export interface DiagramBundle {
    format: typeof BUNDLE_FORMAT;
    v: 1;
    /** ISO timestamp, for the person looking at a folder of backups */
    exported: string;
    diagrams: { name: string; config: FlowConfig }[];
}

/**
 * Pack several diagrams into one file.
 *
 * @param diagrams name and content of each
 * @param now when the export happened
 * @returns the bundle, ready for `JSON.stringify`
 */
export function createBundle(diagrams: { name: string; config: FlowConfig }[], now = new Date()): DiagramBundle {
    return { format: BUNDLE_FORMAT, v: 1, exported: now.toISOString(), diagrams };
}

export function isBundle(value: unknown): value is DiagramBundle {
    return (
        !!value &&
        typeof value === 'object' &&
        (value as DiagramBundle).format === BUNDLE_FORMAT &&
        Array.isArray((value as DiagramBundle).diagrams)
    );
}

/** One diagram found in an imported file */
export interface ImportItem {
    name: string;
    config: FlowConfig;
    /** Where it came from; decides what the summary says about it */
    source: 'diagram' | 'bundle' | 'energiefluss';
    /** What a conversion could not carry over -- only ever set for `energiefluss` */
    warnings: ImportWarning[];
    /** The counts of a conversion, for its summary -- only set for `energiefluss` */
    stats?: ImportResult['stats'];
}

/**
 * Why a file could not be read. Codes rather than sentences, because the core has no dictionary; the
 * user interface translates them.
 */
export type ImportErrorCode =
    /** Not JSON at all; `detail` carries the parser's message */
    | 'json'
    /** JSON, but not an object */
    | 'not-object'
    /** An object that is none of the three formats */
    | 'unknown-format'
    /** An energiefluss configuration with nothing in it to convert */
    | 'energiefluss-empty'
    /** A bundle without a single usable diagram */
    | 'bundle-empty'
    /** A diagram whose nodes all lack an id, so nothing of it would survive */
    | 'no-valid-nodes';

export type ImportResultOrError = { items: ImportItem[] } | { error: ImportErrorCode; detail?: string };

/**
 * Read an imported file or a pasted text.
 *
 * @param text the file content
 * @param fallbackName name for a diagram that brings none -- normally the file name
 * @returns the diagrams it contains, or why there are none
 */
export function readImport(text: string, fallbackName: string): ImportResultOrError {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        return { error: 'json', detail: error instanceof Error ? error.message : String(error) };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: 'not-object' };
    }

    if (isBundle(value)) {
        const items: ImportItem[] = [];
        for (const entry of value.diagrams) {
            // A bundle is a file somebody may have edited by hand; an entry without a diagram in it is
            // skipped rather than imported as an empty one
            if (!entry || typeof entry !== 'object' || !Array.isArray(entry.config?.nodes)) {
                continue;
            }
            items.push({
                name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : fallbackName,
                config: normalizeConfig(entry.config),
                source: 'bundle',
                warnings: [],
            });
        }
        return items.length ? { items } : { error: 'bundle-empty' };
    }

    // Checked before the own format: an energiefluss document has none of our keys, and read as one of
    // ours it would silently turn into an empty diagram
    if (isEnergiefluss(value)) {
        const result = importEnergiefluss(value);
        if (!result.config.nodes.length) {
            return { error: 'energiefluss-empty' };
        }
        return {
            items: [
                {
                    name: fallbackName,
                    config: result.config,
                    source: 'energiefluss',
                    warnings: result.warnings,
                    stats: result.stats,
                },
            ],
        };
    }

    // Our own format has to show at least its `nodes` array. Anything laxer would accept any JSON file
    // as an empty diagram -- which is how a wrong file ends up replacing a real one without a word
    const rawNodes = (value as FlowConfig).nodes;
    if (Array.isArray(rawNodes)) {
        const config = normalizeConfig(value);
        // Nodes were there and none survived: every one lacked an id. Importing that as an empty
        // diagram would look like success
        if (rawNodes.length && !config.nodes.length) {
            return { error: 'no-valid-nodes' };
        }
        return { items: [{ name: fallbackName, config, source: 'diagram', warnings: [] }] };
    }

    return { error: 'unknown-format' };
}

/**
 * A file name for a diagram: `Meine Anlage` becomes `meine_anlage.json`. The reverse direction is
 * {@link nameFromFileName}.
 *
 * @param slug the id-safe form of the name (see `slugify` in `storage.ts`)
 * @returns the file name
 */
export function diagramFileName(slug: string): string {
    return `${slug}.json`;
}

/**
 * The name a diagram gets from the file it was imported from: the file name without its extension,
 * underscores turned back into spaces.
 *
 * @param fileName e.g. `meine_anlage.json`
 * @returns e.g. `meine anlage`
 */
export function nameFromFileName(fileName: string): string {
    const base = fileName
        .replace(/\.[^.]*$/, '')
        .replace(/_+/g, ' ')
        .trim();
    return base || 'diagram';
}
