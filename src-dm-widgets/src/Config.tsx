/**
 * The designer, as a `jsonConfig` custom component.
 *
 * This is how the diagram editor gets into the device manager -- and into **any adapter's admin
 * configuration**, because both are the same form renderer: `@iobroker/json-config`. A host can only
 * put foreign UI into that form through an item of `type: 'custom'`, which resolves the `url`,
 * registers it as a federation remote, loads the module named in `name` and renders the export it
 * points at. `EnergyFlowDm.getConfigSchema()` holds the device-manager half of that contract; the
 * README documents the snippet for an adapter's own `jsonConfig.json`.
 *
 * The props are whatever `ConfigGeneric` passes down, plus the flattened `socket` / `theme` /
 * `themeType` that `ConfigCustom` adds. The two that matter:
 *
 * - `data` is the surrounding object (a widget's settings, or an adapter's `native`) and `attr` the
 *   key of this item
 * - `onChange(attr, value)` writes the value back and marks the form dirty, which is what makes the
 *   host's save button light up
 */
import React from 'react';
import { I18n, type Connection, type IobTheme, type ThemeType } from '@iobroker/gui-components';
import type { ConfigGenericProps } from '@iobroker/json-config';

import { DiagramAttribute, type EditorContext } from '@energyflow/editor';
import translations, { I18N_PREFIX } from '@energyflow/i18n';

/** What `ConfigCustom` adds on top of the generic item props */
interface DesignerProps extends ConfigGenericProps {
    socket: Connection;
    theme: IobTheme;
    themeType: ThemeType;
}

/**
 * Register this adapter's dictionary, once.
 *
 * In the device manager the plugin loader has already done it -- it loads `./translations` before it
 * loads the widget. In an adapter's admin configuration **nothing does**, and without this the whole
 * designer renders raw keys like `energyflow_insp_node`. So the component brings its own words and
 * does not depend on how the host got here.
 *
 * `extendTranslations` rewrites the object it is handed (it consumes `prefix` and prefixes every key),
 * so it gets a copy: the dictionary is a shared module, and the vis-2 side registers the same one.
 */
let dictionaryRegistered = false;

function ensureTranslations(): void {
    if (dictionaryRegistered) {
        return;
    }
    dictionaryRegistered = true;
    try {
        const copy: Record<string, unknown> = {};
        for (const [language, words] of Object.entries(translations)) {
            copy[language] = typeof words === 'string' ? words : { ...(words as Record<string, string>) };
        }
        I18n.extendTranslations(copy);
    } catch (error) {
        console.warn(`energyflow: cannot register translations: ${String(error)}`);
    }
}

ensureTranslations();

function t(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

export function Designer(props: DesignerProps): React.JSX.Element {
    const { data, attr, onChange, custom, oContext, socket, theme, themeType } = props;

    // `attr` is the key of this item in the schema; falling back to 'diagram' keeps the component
    // usable if it is ever embedded under a different name
    const key = attr || 'diagram';
    const stored = (data as Record<string, unknown> | undefined)?.[key];

    const editorContext: EditorContext = React.useMemo(
        () => ({
            socket,
            theme,
            themeType,
            lang: I18n.getLanguage(),
            t,
        }),
        [socket, theme, themeType],
    );

    /**
     * Hand a new value to the form. Which shape it wants depends on `custom`, and `ConfigGeneric`
     * of `@iobroker/json-config` does exactly this dance: a per-object custom settings page takes
     * `(attr, value)`, every other form -- an adapter's configuration page and the device manager's
     * widget settings -- expects the caller to write into `data` and hand the whole object back.
     * Called with the attribute alone, those forms store nothing and only light up the save button:
     * that is why a chosen diagram fell back to "in this widget" and was gone after saving.
     *
     * `forceUpdate` re-renders this item with the new `data` afterwards, without which the component
     * keeps showing the value it was rendered with.
     */
    const commit = (next: unknown): void => {
        if (custom) {
            void onChange(key, next, () => oContext?.forceUpdate?.([key], data));
            return;
        }
        const changed = { ...(data as Record<string, unknown>), [key]: next };
        void onChange(changed, undefined, () => oContext?.forceUpdate?.([key], changed));
    };

    return (
        <DiagramAttribute
            value={stored}
            onChange={commit}
            context={editorContext}
        />
    );
}

/**
 * The components of this module, **as its default export**: both loaders that render a `custom` item
 * -- the one in `@iobroker/json-config` and the older copy the device manager carries -- read
 * `(await loadRemote(...)).default` and index *that* with the name from the schema
 * (`energyflow/Config/Designer`). A module with only named exports is reported as
 * "Component ... not found. Found:" with an empty list.
 */
export default { Designer };
