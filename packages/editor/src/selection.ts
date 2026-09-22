/**
 * Working with {@link EditorSelection} without caring whether it holds one node or several.
 */
import type { EditorSelection } from './types';

/**
 * @param selection the selection
 * @returns the selected node ids -- empty for an edge, the canvas or nothing
 */
export function selectedNodeIds(selection: EditorSelection): string[] {
    if (selection.kind === 'node') {
        return [selection.id];
    }
    return selection.kind === 'nodes' ? selection.ids : [];
}

/**
 * @param ids the nodes to select
 * @returns the canvas for none, `node` for one, `nodes` for several
 */
export function selectNodes(ids: string[]): EditorSelection {
    const unique = [...new Set(ids)];
    if (!unique.length) {
        return { kind: 'canvas' };
    }
    return unique.length === 1 ? { kind: 'node', id: unique[0] } : { kind: 'nodes', ids: unique };
}

/**
 * Whether a selection is the same set of nodes as a list, in any order. Lets a rubber band that is
 * dragged without covering anything new skip the update.
 *
 * @param selection the current selection
 * @param ids the candidate
 * @returns true when nothing would change
 */
export function sameNodes(selection: EditorSelection, ids: string[]): boolean {
    const current = selectedNodeIds(selection);
    if (current.length !== ids.length) {
        return false;
    }
    const set = new Set(current);
    return ids.every(id => set.has(id));
}

/** A Mac names its modifier ⌘ and takes it where other systems take Ctrl */
export const IS_MAC =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
