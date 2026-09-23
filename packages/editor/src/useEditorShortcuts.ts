/**
 * The designer's keyboard: copy, paste and delete the selection, move it with the arrow keys and
 * resize it with Shift and the arrow keys. Ctrl on Windows and Linux, ⌘ on a Mac.
 *
 * Copy goes to the system clipboard as text (see `clipboard.ts` in the core), so nodes can travel from
 * the designer in vis-2 to the one in the admin tab, or to another browser window. Two browser
 * restrictions shape how:
 *
 * - **Writing** happens inside a `copy` event raised with `execCommand('copy')`. That works on plain
 *   http, where ioBroker usually runs and where `navigator.clipboard` does not exist at all.
 * - **Reading** only happens in the `paste` event the browser raises for Ctrl+V. Asking for the
 *   clipboard directly would put a permission prompt in front of every paste. Where a browser raises no
 *   `paste` event outside a text field, a copy kept in memory is pasted instead.
 *
 * Nothing here reacts while a text field has the focus, or while focus is in a dialog on top of the
 * designer: Ctrl+C in the label field copies the text, as it should.
 */
import React from 'react';

import {
    copyNodes,
    parseClipboard,
    pasteNodes,
    moveNodes,
    removeEdge,
    removeNodes,
    resizeNodes,
    type FlowConfig,
} from '@flow/core';

import { selectedNodeIds, selectNodes } from './selection';
import type { EditorSelection } from './types';

/**
 * The last copy, for browsers without a `paste` event outside text fields. Module state on purpose:
 * it outlives the designer, so a node copied in one diagram of the admin tab can be pasted into the
 * next one.
 */
let memory: string | null = null;
/** Whether `memory` also reached the system clipboard; if it did, the system clipboard is the truth */
let systemHoldsMemory = false;

/** How long a Ctrl+V waits for the browser's `paste` event before falling back to `memory` */
const PASTE_FALLBACK_MS = 80;

/** Direction of each arrow key; for resizing, right and down mean larger */
const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];

function isTextEntry(element: Element): boolean {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return true;
    }
    if (element instanceof HTMLInputElement) {
        return !NON_TEXT_INPUTS.includes(element.type);
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

function hasTextSelection(): boolean {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}

/**
 * The letter of a shortcut. On a Cyrillic or Greek layout `key` is another letter, but the physical
 * key is still the one labelled C, and that is what people press.
 */
function shortcutLetter(event: KeyboardEvent): string {
    const key = event.key.length === 1 ? event.key.toLowerCase() : '';
    if (/^[a-z]$/.test(key)) {
        return key;
    }
    return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : key;
}

/** Put text on the system clipboard from inside a key handler; see the file comment for why this way */
function writeClipboard(text: string): void {
    let written = false;
    const onCopy = (event: ClipboardEvent): void => {
        event.clipboardData?.setData('text/plain', text);
        event.preventDefault();
        written = !!event.clipboardData;
    };
    document.addEventListener('copy', onCopy);
    try {
        // Deprecated, and still the only way that works without a secure context
        document.execCommand('copy');
    } catch {
        // The fallback below, or the in-memory copy, covers it
    } finally {
        document.removeEventListener('copy', onCopy);
    }
    systemHoldsMemory = written;
    if (!written && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
            () => {
                systemHoldsMemory = true;
            },
            () => undefined,
        );
    }
}

export interface EditorShortcutsOptions {
    /** The designer's outermost element: shortcuts apply while the focus is in it */
    root: React.RefObject<HTMLElement | null>;
    config: FlowConfig;
    selection: EditorSelection;
    /** See `commit` in the editor: `merge` joins repeated key presses into one undo step */
    commit: (config: FlowConfig, transient?: boolean, merge?: string) => void;
    select: (selection: EditorSelection) => void;
    /** True during a drag: the document is a draft then, and a paste would be lost with it */
    disabled?: boolean;
}

export function useEditorShortcuts(options: EditorShortcutsOptions): void {
    const { root, config, selection, commit, select, disabled } = options;

    React.useEffect(() => {
        if (disabled) {
            return undefined;
        }
        let pendingPaste: ReturnType<typeof setTimeout> | null = null;

        /**
         * Whether a key press is meant for the diagram: the focus is in the designer (or nowhere, or on
         * the dialog around it) and not in a text field. A dialog opened on top of the designer lives
         * in a portal outside of `root`, so its focus does not count.
         */
        const applies = (): boolean => {
            const element = root.current;
            if (!element?.isConnected) {
                return false;
            }
            const active = document.activeElement;
            if (!active || active === document.body) {
                return true;
            }
            if (isTextEntry(active)) {
                return false;
            }
            return element.contains(active) || active.contains(element);
        };

        const paste = (text: string | null): boolean => {
            const clipboard = text ? parseClipboard(text) : null;
            if (!clipboard) {
                return false;
            }
            const result = pasteNodes(config, clipboard);
            commit(result.config);
            select(selectNodes(result.ids));
            return true;
        };

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.defaultPrevented || event.altKey || !applies()) {
                return;
            }
            const command = event.ctrlKey || event.metaKey;
            const letter = shortcutLetter(event);

            if (command && !event.shiftKey && letter === 'c') {
                const clipboard = copyNodes(config, selectedNodeIds(selection));
                // Selected text on the page wins: that is what the user means to copy then
                if (!clipboard || hasTextSelection()) {
                    return;
                }
                memory = JSON.stringify(clipboard);
                writeClipboard(memory);
            } else if (command && !event.shiftKey && letter === 'v') {
                // Not prevented: the default action is what raises the `paste` event below
                if (pendingPaste) {
                    clearTimeout(pendingPaste);
                }
                pendingPaste = setTimeout(() => {
                    pendingPaste = null;
                    paste(memory);
                }, PASTE_FALLBACK_MS);
                // vis-2 has its own Ctrl+V for widgets; it must not paste one behind the designer
                event.stopPropagation();
                return;
            } else if (!command && ARROWS[event.key]) {
                const ids = selectedNodeIds(selection).filter(id => config.nodes.some(node => node.id === id));
                if (!ids.length) {
                    return;
                }
                // One grid step, so a node moved by keyboard lands where a dragged one would
                const grid = config.canvas.grid;
                const step = grid && grid > 0 ? grid : 1;
                const [dx, dy] = ARROWS[event.key];
                const key = ids.join('\n');
                if (event.shiftKey) {
                    commit(resizeNodes(config, ids, dx * step, dy * step), false, `resize:${key}`);
                } else {
                    commit(moveNodes(config, ids, dx * step, dy * step), false, `move:${key}`);
                }
            } else if (!command && (event.key === 'Delete' || event.key === 'Backspace')) {
                const ids = selectedNodeIds(selection).filter(id => config.nodes.some(node => node.id === id));
                if (ids.length) {
                    commit(removeNodes(config, ids));
                } else if (selection.kind === 'edge' && config.edges.some(edge => edge.id === selection.id)) {
                    commit(removeEdge(config, selection.id));
                } else {
                    return;
                }
                select({ kind: 'canvas' });
            } else {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        };

        const onPaste = (event: ClipboardEvent): void => {
            if (!applies()) {
                return;
            }
            if (pendingPaste) {
                clearTimeout(pendingPaste);
                pendingPaste = null;
            }
            // The system clipboard decides -- unless the copy never reached it, then memory does
            const pasted =
                paste(event.clipboardData?.getData('text/plain') ?? null) || (!systemHoldsMemory && paste(memory));
            if (pasted) {
                event.preventDefault();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('paste', onPaste);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('paste', onPaste);
            if (pendingPaste) {
                clearTimeout(pendingPaste);
            }
        };
    }, [root, config, selection, commit, select, disabled]);
}
