/**
 * The entry point `pluginLoader.ts` of ioBroker.devices imports.
 *
 * It loads this module by the fixed name `./Components` and picks a widget out of the **default
 * export** by the `name` from `common.deviceWidgets.components[]` in `io-package.json`. So this object
 * and that list have to stay in step -- a mismatch shows up as "Plugin component X not found".
 */
import EnergyFlowDm from './EnergyFlowDm';

export default {
    EnergyFlow: EnergyFlowDm,
};
