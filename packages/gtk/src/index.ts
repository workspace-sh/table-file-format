// The .table views for GTK4 and libadwaita, through GTKX. Same names and
// props as @workspace.sh/table-ui, so an app wires the same callbacks to
// either; what a cell shows comes from table-ui's shared logic, so both
// show a table the same way.

export { TableView } from "./TableView.js";
export { BoardView, CalendarView, GalleryView, ListView } from "./cards.js";
export { CellValue, type CellValueProps } from "./CellValue.js";
export { EditableCell, type EditableCellProps } from "./EditableCell.js";
export { useDark } from "./theme.js";
export { DisplaySettingsProvider, useDirection, useDisplaySettings, type DisplaySettings, type ViewProps, type ViewSettingsProps } from "@workspace.sh/table-ui/shared";
export { FormulaPanel, type FormulaPanelProps } from "./FormulaPanel.js";
export { ViewSettings } from "./ViewSettings.js";
export { AddField, FieldEditor, type AddFieldProps, type FieldEditorProps } from "./FieldEditor.js";
export { RowPage, type RowPageProps } from "./RowPage.js";
export { AttachmentImage } from "./AttachmentImage.js";
export { AttachmentsProvider, type AttachmentUrl } from "@workspace.sh/table-ui/shared";
