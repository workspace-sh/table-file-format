// The views, by layout: the shared table-ui views with the callbacks the
// table screen gives them.

import type { Field, ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import type { SheetGridShown } from "@workspace.sh/table-app";
import type { PlaceMeasure } from "@workspace.sh/table-ui/shared";
import { BoardView, CalendarView, GalleryView, ListView, TableView } from "@workspace.sh/table-ui";

export interface ViewCallbacks {
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue: (fieldName: string, value: string) => void;
  onRemoveEnumValue: (fieldName: string, value: string) => void;
  onDeleteField: (fieldName: string) => void;
  onMoveField: (fieldName: string, delta: -1 | 1) => void;
  onRestoreSchema?: (schema: TableSchema) => void;
  onAddField: (field: Field) => void;
  onAddRow: () => string | void;
  onDeleteRow: (rowId: string) => void;
  onOpenBody: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
  relatedTables: Record<string, ParsedTable>;
  onOpenRelation: (address: string) => void;
  /** Every row of the table, for formulas that read another row (D34). */
  allRows: Row[];
  /** This table's key among `relatedTables`. */
  tableKey: string;
  sheet?: SheetGridShown;
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
  /** Where you are in the table, for history (the cell selected), and putting it back. */
  onPlace?: (place: { rowId?: string; field?: string }) => void;
  restorePlace?: { place: { rowId?: string; field?: string }; n: number } | null;
  onPlaceMeasure?: (measure: PlaceMeasure | null) => void;
  /** The view's rows read through the index (a large table), or as its file has them while it's read. */
  source?: ViewRows;
}

/** What a table shown while it is still read is given: its rows, to look at, and nothing that changes it. */
export type ReadingCallbacks = Pick<ViewCallbacks, "relatedTables" | "onOpenRelation" | "allRows" | "tableKey"> & { source: ViewRows };

export function renderView(
  view: View,
  rows: Row[],
  schema: TableSchema,
  bodies: Record<string, string> | undefined,
  given: ViewCallbacks | ReadingCallbacks,
) {
  // A table being read is looked at, not worked in: it comes with no way to change it.
  const cb = given as Partial<ViewCallbacks> & ReadingCallbacks;
  const common = {
    view,
    rows,
    schema,
    bodies,
    relatedTables: cb.relatedTables,
    onOpenRelation: cb.onOpenRelation,
  };
  switch (view.layout) {
    case "board":
      // BoardView handles its own horizontal scroll: snap-paging on touch
      // viewports, free scroll on wide ones.
      return <BoardView {...common} onUpdateRow={cb.onUpdateRow} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />;
    case "gallery":
      return <GalleryView {...common} onOpenBody={cb.onOpenBody} />;
    case "list":
      return <ListView {...common} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />;
    case "calendar":
      return <CalendarView {...common} onOpenBody={cb.onOpenBody} />;
    default:
      // TableView manages its own horizontal scroll: the pane to the right
      // of the frozen primary column.
      return (
        <TableView
          {...common}
          onUpdateView={cb.onUpdateView}
          onUpdateRow={cb.onUpdateRow}
          onUpdateField={cb.onUpdateField}
          onAddEnumValue={cb.onAddEnumValue}
          onRemoveEnumValue={cb.onRemoveEnumValue}
          onDeleteField={cb.onDeleteField}
          onMoveField={cb.onMoveField}
          onRestoreSchema={cb.onRestoreSchema}
          onAddField={cb.onAddField}
          onAddRow={cb.onAddRow}
          onDeleteRow={cb.onDeleteRow}
          onOpenBody={cb.onOpenBody}
          allRows={cb.allRows}
          tableKey={cb.tableKey}
          sheet={cb.sheet}
          onInsertRow={cb.onInsertRow}
          onPlace={cb.onPlace}
          restorePlace={cb.restorePlace}
          onPlaceMeasure={cb.onPlaceMeasure}
          source={cb.source}
        />
      );
  }
}
