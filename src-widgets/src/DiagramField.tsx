/**
 * The single widget attribute that holds the diagram -- or a reference to a stored one.
 *
 * vis-2 renders one custom React component for a `type: 'custom'` field, and this is it. All the UI
 * lives in `DiagramAttribute` of the editor package, which the device manager uses as well; this file
 * only translates between vis-2's attribute contract and that component.
 *
 * **This module is loaded lazily** (see `EnergyFlow.tsx`), and that is not an optimisation to be
 * undone: everything the designer needs hangs off it, including the state picker and the colour
 * picker of `@iobroker/gui-components`. vis-2 does not share that package, so it is bundled -- 620 kB
 * of it. A view that only *displays* diagrams must never download that, and it only stays out of the
 * runtime chunk as long as nothing in the eager path imports this file or `@iobroker/gui-components`.
 */
import React from 'react';
import { I18n } from '@iobroker/gui-components';

import { DiagramAttribute, type EditorContext } from '@energyflow/editor';
import type { RxWidgetInfoCustomComponentProperties, WidgetData } from '@iobroker/types-vis-2';

import { I18N_PREFIX } from './Generic';

export interface DiagramFieldProps {
    /** Name of the attribute inside the widget data */
    name: string;
    data: WidgetData;
    setData: (data: WidgetData) => void;
    /** What vis-2 hands to a custom attribute component */
    visContext: RxWidgetInfoCustomComponentProperties['context'];
}

/** Translate a key of this widget set. vis-2 stores them prefixed, see `translations.ts`. */
function translate(key: string, ...args: (string | number)[]): string {
    return I18n.t(`${I18N_PREFIX}${key}`, ...(args as string[]));
}

export function DiagramField(props: DiagramFieldProps): React.JSX.Element {
    const { name, data, setData, visContext } = props;

    const editorContext: EditorContext = React.useMemo(
        () => ({
            socket: visContext.socket,
            theme: visContext.theme,
            themeType: visContext.theme?.palette?.mode === 'dark' ? 'dark' : 'light',
            lang: I18n.getLanguage(),
            t: translate,
        }),
        [visContext.socket, visContext.theme],
    );

    return (
        <DiagramAttribute
            value={data[name]}
            onChange={next => setData({ ...data, [name]: next })}
            context={editorContext}
        />
    );
}

export default DiagramField;
