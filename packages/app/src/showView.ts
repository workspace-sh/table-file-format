// What a view shows, for an app holding tables by `bundle/table` key: the
// view as this viewer arranged it, its rows in order after this viewer's
// search, and a Sheet view's grid as saved (D41). Every platform's app
// runs this, so a view shows the same rows everywhere.

import {
  applyView,
  isSheet,
  searchRows,
  sheetOrder,
  type ParsedTable,
  type Row,
  type SheetRef,
  type TextOrder,
  type View,
} from "@workspace.sh/table-core";
import { sheetDirectory } from "@workspace.sh/table-ui/shared";

import { arrangedView, type Arrangement } from "./arrangements.ts";
import { bundleOf, bundleTables, tableNameOf } from "./bundles.ts";

/** A Sheet view's grid as saved: every row in grid order, each row's number, the sheets a formula may name. */
export interface SheetGridShown {
  order: string[];
  position: Map<string, number>;
  sheets: SheetRef[];
}

export interface ShownView {
  /** The view as shown: the saved one with this viewer's arrangement over it. */
  view: View;
  /** Its rows, filtered, sorted and searched. */
  rows: Row[];
  /** How many rows the view shows before the search: "3 of 12 matching". */
  inView: number;
  sheet?: SheetGridShown;
}

/**
 * The saved grid of a Sheet view (D41), for its row numbers and for
 * formulas typed in it; undefined for any other view.
 */
export function sheetShown(tables: Record<string, ParsedTable>, key: string, view: View): SheetGridShown | undefined {
  if (!isSheet(view)) return undefined;
  const table = tables[key];
  if (!table) return undefined;
  const inBundle = bundleTables(tables, bundleOf(key));
  const self = tableNameOf(key);
  const order = sheetOrder(table, view.id, { tables: inBundle, self });
  if (!order) return undefined;
  const position = new Map<string, number>();
  order.ids.forEach((id, i) => position.set(id, i + 1));
  return { order: order.ids, position, sheets: sheetDirectory(inBundle, self) };
}

/**
 * The rows `view` of table `key` shows. Lookups and rollups reach the
 * tables they name within this bundle (D36, D37). Formulas read the views
 * as saved, never this viewer's arrangement of them. `viewerText` orders
 * text by the viewer's own locale, used only for a sort they made.
 */
export function showView(
  tables: Record<string, ParsedTable>,
  key: string,
  view: View,
  options: { arrangement?: Arrangement; search?: string; viewerText?: TextOrder } = {},
): ShownView {
  const table = tables[key]!;
  const { arrangement, search = "", viewerText } = options;
  const shown = arrangedView(view, arrangement);
  const viewRows = applyView(table, shown, {
    tables: bundleTables(tables, bundleOf(key)),
    self: tableNameOf(key),
    ...(arrangement?.sort && viewerText ? { text: viewerText } : {}),
  });
  const rows = searchRows(viewRows, search, { schema: table.schema, bodies: table.bodies });
  const sheet = sheetShown(tables, key, view);
  return { view: shown, rows, inView: viewRows.length, ...(sheet ? { sheet } : {}) };
}
