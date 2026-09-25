/**
 * Words that depend on what flows.
 *
 * A producer of water is a spring, the grid of a water diagram is the house connection, and the
 * share that did not come from the mains is not "autarky" there but the rainwater share. The keys
 * are optional: `kind_source_water` is used when the dictionary has it, otherwise the plain
 * `kind_source` -- which is why only the words that really differ need an entry.
 */
import { mediumOf, type FlowConfig, type NodeKind, type PaletteEntry } from '@flow/core';

/**
 * The medium's word for a key, or the plain one.
 *
 * Any sentence of the designer can have one: `insp_soc_water` is "Füllstand" where `insp_soc` is
 * "Ladezustand", and a key nobody translated for this medium simply stays the way it was.
 *
 * @param base the key without the medium, e.g. `kind_source`
 * @param config the diagram, for its medium
 * @param t translates a key of this widget set
 * @returns the name to show
 */
export function mediumWord(base: string, config: FlowConfig | undefined, t: (key: string) => string): string {
    const key = `${base}_${mediumOf(config).id}`;
    const special = t(key);
    return special && !isMissing(special, key) ? special : t(base);
}

/**
 * Whether a translator answered "I do not know this key".
 *
 * `I18n.t` answers with the key when it has no sentence for it -- but with the *namespaced* key,
 * `flow_kind_label_energy`, because that is how the key is stored. Comparing against the bare key
 * therefore never matches, and every fallback word would come out as its own key. The prefix is the
 * host's, so it is not compared: an answer that ends in the key and starts with nothing but a
 * namespace is the key.
 *
 * @param answer what the translator returned
 * @param key what it was asked for
 * @returns true if there is no sentence for it
 */
function isMissing(answer: string, key: string): boolean {
    return answer.endsWith(key) && /^[a-z0-9]*_?$/i.test(answer.slice(0, -key.length));
}

/**
 * @param kind the node kind
 * @param config the diagram, for its medium
 * @param t translates a key of this widget set
 * @returns the name to show
 */
export function kindLabel(kind: NodeKind, config: FlowConfig | undefined, t: (key: string) => string): string {
    return mediumWord(`kind_${kind}`, config, t);
}

/**
 * @param kpi the key figure, `none` included
 * @param config the diagram, for its medium
 * @param t translates a key of this widget set
 * @returns the name to show
 */
export function kpiLabel(kpi: string, config: FlowConfig | undefined, t: (key: string) => string): string {
    return mediumWord(`kpi_${kpi}`, config, t);
}

/**
 * @param entry a palette entry
 * @param config the diagram, for its medium
 * @param t translates a key of this widget set
 * @returns the name to show -- its own, or the name of its kind in this medium
 */
export function paletteLabel(entry: PaletteEntry, config: FlowConfig | undefined, t: (key: string) => string): string {
    return entry.label ? t(entry.label) : kindLabel(entry.kind, config, t);
}
