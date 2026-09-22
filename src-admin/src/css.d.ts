// Ambient declaration for style side-effect imports (`import '@iobroker/gui-components/index.css'`).
// TypeScript 6 rejects a side-effect import it cannot resolve types for. This file must stay free of
// imports and exports, or it becomes a module and the wildcard turns into a module augmentation.
declare module '*.css';
