import type { VisRxWidgetState } from '@iobroker/types-vis-2';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import { I18N_PREFIX } from '@flow/i18n';

export { I18N_PREFIX };

/**
 * Base class of the widgets in this set.
 *
 * `window.visRxWidget` is provided by vis-2 at runtime -- a widget set must never import a vis-2 base
 * class directly, or it ends up extending a second copy of it.
 */
export default class Generic<
    RxData extends Record<string, any>,
    State extends Partial<VisRxWidgetState> = VisRxWidgetState,
> extends (window.visRxWidget as typeof VisRxWidget)<RxData, State> {
    static getI18nPrefix(): string {
        return I18N_PREFIX;
    }
}
