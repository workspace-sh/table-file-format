// A view of a large table, read through its bundle's index (SPEC section 8)
// as the table app reads one: the head of its file at once while the index is
// made, with how far the reading has got; then the view's own rows from the
// index. A layout other than the table's shows its rows when there are few
// enough (FewRows). For a .table opened as a document and an embed alike.

import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkLabel, GtkProgressBar } from "@gtkx/jsx/gtk";
import { asStored, ingestingText } from "@workspace.sh/table-app";
import type { ParsedTable, Row, View } from "@workspace.sh/table-core";
import type { ViewProps } from "@workspace.sh/table-ui/shared";

import { LayoutView } from "../LayoutView.js";
import { FewRows } from "./FewRows.js";
import type { IndexedTables } from "./useIndexedTables.js";

const NO_ROWS: Row[] = [];

/** How far a large table's reading has got. */
export const readingLine = ({ done, total }: { done: number; total: number }) =>
  total > 0 ? `${done.toLocaleString("en")} of ${total.toLocaleString("en")} rows read` : "Reading its rows";

export interface IndexedViewProps {
  indexed: IndexedTables;
  /** The view as shown (arranged). */
  view: View;
  table: ParsedTable;
  tableName: string;
  related: Record<string, ParsedTable>;
  sheet?: ViewProps["sheet"];
  /** What tells the view apart from another of the file's, for remounting. */
  viewKey: string;
  /** The views' edit callbacks; none to look only. */
  edits: Partial<ViewProps>;
  onOpenRelation?: (address: string) => void;
  restorePlace?: ViewProps["restorePlace"];
}

export function IndexedView({ indexed, view, table, tableName, related, sheet, viewKey, edits, onOpenRelation, restorePlace }: IndexedViewProps) {
  const showReading = view.layout === "table" && !indexed.source && !!indexed.reading;
  // Removing a choice takes it out of every row that holds it, which the index can't yet do in place.
  const indexEdits = { ...edits, onRemoveEnumValue: undefined, onInsertRow: undefined };
  if (indexed.building && !showReading) {
    return (
      <GtkBox name="table-building" orientation={Gtk.Orientation.VERTICAL} spacing={8} vexpand valign={Gtk.Align.START} marginStart={12} marginEnd={12} marginTop={12}>
        <GtkLabel label={readingLine(indexed.building)} xalign={0} cssClasses={["dim-label"]} />
        <GtkProgressBar fraction={indexed.building.total > 0 ? indexed.building.done / indexed.building.total : 0} />
      </GtkBox>
    );
  }
  if (showReading) {
    return (
      <GtkBox orientation={Gtk.Orientation.VERTICAL} vexpand>
        <GtkLabel label={ingestingText(view)} xalign={0} wrap marginStart={12} marginEnd={12} marginBottom={6} cssClasses={["dim-label", "caption"]} />
        {/* While it's read it is to look at, not to work in. */}
        <GtkBox canFocus={false} vexpand>
          <LayoutView key={`${viewKey}\u0000reading`} layout="table" view={asStored(view)} rows={NO_ROWS} source={indexed.reading} schema={table.schema} relatedTables={related} tableKey={tableName} />
        </GtkBox>
      </GtkBox>
    );
  }
  if (indexed.source && view.layout !== "table") {
    return (
      <FewRows source={indexed.source}>
        {(rows) => (
          <LayoutView
            key={viewKey}
            layout={view.layout}
            view={view}
            rows={rows}
            schema={table.schema}
            bodies={table.bodies}
            relatedTables={related}
            tableKey={tableName}
            {...indexEdits}
            onOpenRelation={onOpenRelation}
          />
        )}
      </FewRows>
    );
  }
  if (indexed.source) {
    return (
      <LayoutView
        key={viewKey}
        layout="table"
        view={view}
        rows={NO_ROWS}
        source={indexed.source}
        schema={table.schema}
        bodies={table.bodies}
        relatedTables={related}
        tableKey={tableName}
        sheet={sheet}
        {...indexEdits}
        onOpenRelation={onOpenRelation}
        restorePlace={restorePlace}
      />
    );
  }
  return <GtkBox vexpand />;
}
