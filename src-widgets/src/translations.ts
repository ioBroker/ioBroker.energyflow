// The dictionary lives in `@flow/i18n`, because the device manager plugin needs exactly the same
// one. This module only exists because module federation exposes it under `./translations`, which is
// the name both hosts load it by.
export { default } from '@flow/i18n';
