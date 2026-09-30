// Sheet views in an app (D41): what each one is called where a formula
// names it, which formulas read one by place, where a new row goes, and
// which cells a place covers, for outlining them.

import {
  formulaRefs,
  isSheet,
  parseExpr,
  sheetColumns,
  sheetOrder,
  type FormulaRef,
  type ParsedTable,
  type Row,
  type SheetRef,
  type View,
} from "@workspace.sh/table-core";

/**
 * Every Sheet view in a bundle, as a formula in table `self` names it:
 * `By date` for one of its own, `Deals: Pipeline` for another table's
 * (the table's title, or its name). Each with its columns and its rows in
 * grid order, as saved.
 */
export function sheetDirectory(tables: Record<string, ParsedTable>, self: string): SheetRef[] {
  const out: SheetRef[] = [];
  for (const [name, t] of Object.entries(tables)) {
    for (const v of t.views) {
      if (!isSheet(v)) continue;
      const order = sheetOrder(t, v.id, { tables, self: name });
      if (!order) continue;
      const title = typeof t.meta?.title === "string" && t.meta.title ? t.meta.title : name;
      out.push({
        name: name === self ? v.name : `${title}: ${v.name}`,
        view: v.id,
        ...(name === self ? {} : { table: name }),
        columns: sheetColumns(t.schema, v),
        rows: order.ids,
      });
    }
  }
  return out;
}

/** The computed fields, in any table of the bundle, that read a Sheet view by place. */
export function sheetDependents(
  tables: Record<string, ParsedTable>,
  table: string,
  viewId: string,
): { table: string; field: string }[] {
  const out: { table: string; field: string }[] = [];
  for (const [name, t] of Object.entries(tables)) {
    for (const f of t.schema.fields) {
      if (!f.computed) continue;
      const r = parseExpr(f.computed.expr);
      if (!r.ok) continue;
      const reads = formulaRefs(r.expr).some((ref) => ref.place && ref.place.view === viewId && (ref.place.table ?? name) === table);
      if (reads) out.push({ table: name, field: f.name });
    }
  }
  return out;
}

/** Whether a new row can go at a place in a view: not when a saved sort decides where rows go. */
export function canInsertAt(view: View): boolean {
  return !(view.sort && view.sort.length > 0) || (!!view.order && view.order.length > 0);
}

/**
 * The table's rows, and the view's manual order if it has one, with `row`
 * above or below `anchor` (D41: file order is meaningful). In a grouped
 * view the new row joins the anchor's group. Null when the view is sorted,
 * so a new row's place isn't the reader's to choose.
 */
export function insertRowAt(
  rows: Row[],
  view: View,
  anchor: string,
  where: "above" | "below",
  row: Row,
): { rows: Row[]; order?: string[] } | null {
  if (!canInsertAt(view)) return null;
  const at = rows.findIndex((r) => r.id === anchor);
  if (at === -1) return null;
  const anchorRow = rows[at]!;
  const made: Row = { ...row };
  const group = view.group?.field;
  if (group && anchorRow[group] !== undefined) made[group] = anchorRow[group];
  const order = view.order && view.order.length > 0 ? view.order : undefined;
  const inOrder = order ? order.indexOf(anchor) : -1;
  if (order && inOrder !== -1) {
    // Placed by the manual order; it joins the file at the end.
    const next = [...order];
    next.splice(where === "above" ? inOrder : inOrder + 1, 0, made.id);
    return { rows: [...rows, made], order: next };
  }
  const next = [...rows];
  next.splice(where === "above" ? at : at + 1, 0, made);
  return { rows: next };
}

/**
 * The cells a formula's reference covers in the Sheet view it's shown in,
 * for outlining: `here` is the row whose formula is open, `order` the
 * sheet's rows in grid order. A place in another sheet covers none here.
 * At most `limit` cells, so a whole column of a long table stays cheap.
 */
export function placeCells(
  ref: FormulaRef,
  sheet: string,
  here: string,
  order: readonly string[],
  columns: readonly string[],
  limit = 2000,
): { field: string; rowId: string }[] {
  const p = ref.place;
  if (!p || p.view !== sheet || p.table !== undefined) return [];
  const pos = (row: string | number | null, edge: number): number | null => {
    if (row === null) return edge;
    if (typeof row === "string") {
      const i = order.indexOf(row);
      return i === -1 ? null : i;
    }
    const h = order.indexOf(here);
    return h === -1 ? null : h + row;
  };
  const a = pos(p.from.row, 0);
  const b = pos(p.to.row, order.length - 1);
  if (a === null || b === null) return [];
  const top = p.from.row === null || p.to.row === null ? a : Math.min(a, b);
  const bottom = p.from.row === null || p.to.row === null ? b : Math.max(a, b);
  let fields = [p.from.field];
  if (p.to.field !== p.from.field) {
    const f = columns.indexOf(p.from.field);
    const t = columns.indexOf(p.to.field);
    if (f === -1 || t === -1) return [];
    fields = columns.slice(Math.min(f, t), Math.max(f, t) + 1);
  }
  const out: { field: string; rowId: string }[] = [];
  for (let i = Math.max(top, 0); i <= Math.min(bottom, order.length - 1) && out.length < limit; i++) {
    for (const field of fields) out.push({ field, rowId: order[i]! });
  }
  return out;
}

/** A row's number in a Sheet view: its place in the grid as saved (D41), else where it's shown. */
export function rowNumber(position: Map<string, number> | undefined, rowId: string, index: number): number {
  return position?.get(rowId) ?? index + 1;
}
