// The same dictionary the vis-2 widget set uses. `pluginLoader.ts` of ioBroker.devices loads this
// module by the name `./translations` and hands the default export to `I18n.extendTranslations`, which
// applies the `prefix` for us.
export { default } from '@energyflow/i18n';
