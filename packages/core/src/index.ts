/**
 * `@energyflow/core` -- everything that is the same in vis-2 and in the device manager.
 *
 * The two hosts are separate applications: different React trees, different themes, different ways of
 * getting a state value. What they are not allowed to differ in is the diagram itself. So all of the
 * model, the value resolution, the geometry and the rendering live here, and a host bundle is a thin
 * shell that subscribes to states and hands the numbers over.
 *
 * Nothing in here imports MUI, a socket or an icon package. The only runtime dependency is React.
 */
export * from './types';
export * from './expr';
export * from './values';
export * from './format';
export * from './theme';
export * from './defaults';
export * from './geometry';
export * from './runtime';
export * from './model';
export * from './presets';
export * from './importEnergiefluss';
export * from './icons';
export * from './EnergyFlowView';
export { default as EnergyFlowView } from './EnergyFlowView';
