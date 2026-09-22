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
export { JsonDialog, ImportSummary, type JsonDialogProps } from './JsonDialog';
export { downloadText, pickFiles, type PickedFile } from './fileTransfer';
export { importErrorText } from './importMessages';
export { ScalingFields, SourceField, StateSourceRow, type SourceFieldProps } from './SourceField';
export { IconPickerDialog, IconPreview } from './IconPicker';
export { useClock, useLiveStates, useLiveValues } from './useLiveValues';
export { useObjectUnits } from './useObjectUnits';
export { useDefaultHistory, useEnergyToday, useHistory, useIsRecorded } from './useHistory';
export { HistoryDialog, type HistoryDialogProps } from './HistoryDialog';
export { DeviceWizard, type DeviceWizardProps } from './DeviceWizard';
export { diagramSvg, exportPng, exportSvg } from './exportImage';
export { downloadBlob } from './fileTransfer';
export { ResizeHandle, type ResizeHandleProps } from './ResizeHandle';
export { usePersistentState } from './usePersistentState';
export { DiagramAttribute, type DiagramAttributeProps } from './DiagramAttribute';
export {
    listDiagrams,
    loadDiagram,
    saveDiagram,
    createDiagram,
    renameDiagram,
    deleteDiagram,
    useStoredDiagrams,
    type StoredDiagramInfo,
} from './storedDiagrams';
export { selectedNodeIds, selectNodes } from './selection';
export { useEditorShortcuts, type EditorShortcutsOptions } from './useEditorShortcuts';
export type { EditorContext, EditorSelection } from './types';
