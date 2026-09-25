/**
 * Diagrams stored centrally, in the adapter's own namespace.
 *
 * A diagram can live in two places. **Inline**, inside the widget that shows it -- which is how the
 * first version did it: it travels with a view export and needs nothing else. Or **stored**, as an
 * object `flow.<instance>.diagrams.<id>` of type `config` whose `native.flow` is the document, with
 * the widget carrying nothing but a reference to it (`{ "$ref": "flow.0.diagrams.pv" }`, see
 * {@link FlowConfigRef}).
 *
 * The second one is what makes a diagram editable in the admin without opening vis-2, and usable in
 * vis-2 and the device manager at the same time. It is a configuration, not a reading, so it is an
 * object: a state would carry a document as a string in its value and claim a timestamp, a quality
 * and an acknowledgement for something that never changes on its own. Both hosts read it with
 * `getObject` and follow it with `subscribeObject`, so an edit in the admin tab still reaches every
 * open view at once.
 */
import { normalizeConfig } from './defaults';
import { isConfigRef, type FlowConfig, type FlowConfigOrRef } from './types';

/** Name of the folder under the instance that holds the diagrams */
export const DIAGRAM_FOLDER = 'diagrams';

/** The key of `native` the document is stored under */
export const DIAGRAM_NATIVE = 'flow';

/**
 * The common prefix of every stored diagram of an instance.
 *
 * @param instance the adapter instance; the adapter is a singleton, so this is 0 in practice
 * @returns e.g. `flow.0.diagrams.`
 */
export function diagramPrefix(instance = 0): string {
    return `flow.${instance}.${DIAGRAM_FOLDER}.`;
}

/**
 * Whether an id names a stored diagram. Checked before a reference is followed, so a widget cannot be
 * pointed at an arbitrary object and have its `native` read as a diagram.
 *
 * @param id the object id
 * @returns true for `flow.<n>.diagrams.<id>`
 */
export function isDiagramId(id: string): boolean {
    return /^flow\.\d+\.diagrams\.[a-z0-9_-]+$/i.test(id);
}

/**
 * A readable, id-safe version of a name: `Meine Anlage (Süd)` becomes `meine_anlage_sued`.
 *
 * The id shows up in the reference stored in every widget, and in the object browser, so a readable
 * one is worth the few lines. German umlauts are transliterated rather than dropped, because they are
 * what most of the names that end up here contain.
 *
 * @param name the display name
 * @returns lower-case letters, digits and underscores; never empty
 */
export function slugify(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
    return slug || 'diagram';
}

/**
 * An id under the prefix that is not taken yet.
 *
 * @param name the display name to derive it from
 * @param taken the full ids that exist already
 * @param instance the adapter instance
 * @returns a full object id
 */
export function newDiagramId(name: string, taken: Iterable<string>, instance = 0): string {
    const used = new Set(taken);
    const base = `${diagramPrefix(instance)}${slugify(name)}`;
    if (!used.has(base)) {
        return base;
    }
    for (let i = 2; ; i++) {
        const candidate = `${base}_${i}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

/**
 * The `native` of a diagram object.
 *
 * @param config the diagram
 * @returns what to write into the object
 */
export function diagramNative(config: FlowConfig): { flow: FlowConfig } {
    return { [DIAGRAM_NATIVE]: config };
}

/**
 * Read the document out of a diagram object's `native`.
 *
 * Takes the `native` rather than the object, so the core needs to know nothing about ioBroker's
 * object shape -- the hosts hand over what they read.
 *
 * @param native the `native` of the object, or the object's document itself
 * @returns the diagram, or null if the object holds nothing usable yet
 */
export function diagramFromNative(native: unknown): FlowConfig | null {
    if (!native || typeof native !== 'object') {
        return null;
    }
    const document = (native as Record<string, unknown>)[DIAGRAM_NATIVE];
    if (!document || typeof document !== 'object') {
        return null;
    }
    // A stored diagram that itself points somewhere else would be a chain to follow; refuse it rather
    // than recurse, since nothing creates one on purpose
    if (isConfigRef(document as FlowConfigOrRef)) {
        return null;
    }
    return normalizeConfig(document);
}

/**
 * What a widget attribute holds: an inline diagram or a reference to a stored one.
 *
 * Has to be asked **before** `normalizeConfig`, which would turn a reference into an empty diagram
 * without complaint -- the reference has none of the keys a diagram has.
 *
 * @param stored the attribute value, possibly a JSON string
 * @returns the id of the referenced diagram, or the inline diagram
 */
export function readDiagramAttribute(stored: unknown): { ref: string } | { config: FlowConfig } {
    let value: unknown = stored;
    if (typeof stored === 'string' && stored.trim().startsWith('{')) {
        try {
            value = JSON.parse(stored);
        } catch {
            value = stored;
        }
    }
    if (value && typeof value === 'object' && isConfigRef(value as FlowConfigOrRef)) {
        const ref = (value as { $ref: string }).$ref;
        if (isDiagramId(ref)) {
            return { ref };
        }
    }
    return { config: normalizeConfig(value) };
}

/** The last segment of a diagram id, for display where the name is not known yet */
export function diagramShortId(id: string): string {
    return id.split('.').pop() || id;
}
