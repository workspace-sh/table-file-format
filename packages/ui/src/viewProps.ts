// What a view takes, whatever draws it: these views on web and React
// Native, and table-gtk's on Linux. An app wires one set of callbacks and
// hands them to either.

import type { Field, ParsedTable, Row, SheetRef, TableSchema, View } from "@workspace.sh/table-core";

export interface ViewProps {
  view: View;
  rows: Row[];
  schema: TableSchema;
  bodies?: Record<string, string>;
  /**
   * Sibling `.table/` directories indexed by their path (the value
   * stored in a field's `relation.table` declaration). Provided by
   * the consuming app so relation cells can resolve the target row's
   * display value. Cells with no resolvable target render the raw id
   * with a "broken" visual state.
   */
  relatedTables?: Record<string, ParsedTable>;
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  /** Remove a choice from a field; rows holding it lose it (the host asks first). */
  onRemoveEnumValue?: (fieldName: string, value: string) => void;
  /** Delete a field from the table: its values and every view's use of it (the host asks first). */
  onDeleteField?: (fieldName: string) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  /**
   * Put the table's schema back as it was: a field's settings, cancelled.
   * Absent: the field editor puts its field back through onUpdateField and
   * onMoveField, which leaves `schema-version` raised.
   */
  onRestoreSchema?: (schema: TableSchema) => void;
  onAddField?: (field: Field) => void;
  /**
   * Add an empty row. The app mints its id (D23) and may return it: the
   * table then opens that row's first cell for typing.
   */
  onAddRow?: () => string | void;
  /** Delete a row, and its body. The app confirms first if it wants to. */
  onDeleteRow?: (rowId: string) => void;
  onOpenBody?: (rowId: string) => void;
  /**
   * Choose a file for an attachment cell (SPEC section 6). The app asks
   * for one, copies it into the table's attachments/ folder and sets the
   * cell to its filename. Absent: an attachment's name is typed.
   */
  onAttachFile?: (rowId: string, fieldName: string) => void;
  onUpdateView?: (patch: Partial<View>) => void;
  /**
   * Called when a relation cell is clicked. Address takes the form
   * `<table-path>#row=<id>` (see docs/SPEC.md, "Addressing"). Apps
   * implement to navigate to the target row.
   */
  onOpenRelation?: (address: string) => void;
  /**
   * Every row of the table as stored, not only those this view shows, so
   * a formula reading another row (D34) can be previewed and explained.
   */
  allRows?: Row[];
  /** This table's key in `relatedTables`, so lookups and linked rows preview (D36). */
  tableKey?: string;
  /**
   * A Sheet view's grid as saved (D41): every row in grid order, each
   * row's number, and the Sheet views a formula may name. Row numbers
   * and formulas follow it, whatever this reader's own sort or search.
   */
  sheet?: { order: string[]; position: Map<string, number>; sheets: SheetRef[] };
  /** Add a row above or below another. Absent where a sort decides where rows go. */
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
}
