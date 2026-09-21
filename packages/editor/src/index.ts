/**
 * `@energyflow/editor` -- the designer, shared by both host bundles.
 *
 * It is one component: {@link EnergyFlowEditor}, a full-screen dialog. The host supplies an
 * {@link EditorContext} (socket, theme, language, translator) and gets a document back.
 *
 * Unlike the core, this does import MUI and `@iobroker/gui-components` -- both hosts provide those as
 * federation singletons, and the state picker and the colour picker are exactly the wheels that must
 * not be reinvented.
 */
export { EnergyFlowEditor, type EnergyFlowEditorProps } from './EnergyFlowEditor';
export { Canvas, type CanvasProps } from './Canvas';
export { Inspector, type InspectorProps } from './Inspector';
export { PresetDialog, type PresetDialogProps } from './PresetDialog';
export { JsonDialog, type JsonDialogProps } from './JsonDialog';
export { SourceField, StateSourceRow, type SourceFieldProps } from './SourceField';
export { IconPickerDialog, IconPreview } from './IconPicker';
export { useLiveValues } from './useLiveValues';
export type { EditorContext, EditorSelection } from './types';
