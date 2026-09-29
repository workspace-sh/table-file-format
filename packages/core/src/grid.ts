/**
 * Sheet views as grids (SPEC section 4, "Sheet views"; D41). A Sheet
 * view numbers its rows by what is saved in views.json: its grouping,
 * then its manual order or its sort, ties in file order, and file order
 * when nothing is saved. Filters hide rows without renumbering them, so
 * they play no part in a grid's order.
 */

import type { TableSchema, View } from "./types.js";
import { enumValues } from "./types.js";
import { inOrder, sorter } from "./arrange.js";

/** Whether a view is a Sheet view: a table layout with lettered columns and numbered rows. */
export function isSheet(view: View | undefined): view is View {
  return view?.layout === "table" && view.coordinates === true;
}

/** A Sheet view's columns, lettered A, B, C… in this order: its fields, or the schema's. */
export function sheetColumns(schema: TableSchema, view: View): string[] {
  return view.fields ?? schema.fields.map((f) => f.name);
}

/** A group in a grid: its key, the position (from 1) of its first row, and how many rows it has. */
export interface GridGroup {
  key: string;
  start: number;
  count: number;
}

const EMPTY = "(empty)";

function groupKey(v: unknown): string {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return EMPTY;
  return String(v);
}

/**
 * A Sheet view's grid order, as the file index of the row at each place
 * (the first is row 1), and its groups. Rows are named by their index in
 * the file; `read` gives one's value of a field, computed or stored, and
 * is asked only for the fields the view groups and sorts by, once per
 * row. `id` gives a row's id, for a manual order.
 */
export function arrangeGrid(
  count: number,
  view: View,
  schema: TableSchema,
  read: (index: number, field: string) => unknown,
  id: (index: number) => string,
): { order: number[]; groups: GridGroup[] } {
  const all: number[] = new Array(count);
  for (let i = 0; i < count; i++) all[i] = i;
  const ordered = !!view.order && view.order.length > 0;
  const sorts = ordered ? [] : (view.sort ?? []);
  const groupField = view.group?.field;
  let arranged = ordered ? inOrder(all, view.order, id) : all;
  if (sorts.length > 0) arranged = sorter(sorts, schema).sort(all, read);
  if (!groupField) return { order: arranged, groups: [] };

  // A Map keeps keys in the order they arrive (a plain object would put
  // keys that look like integers first). Enum values first, in their
  // declared order; then the rest as they arrive; empties last.
  const buckets = new Map<string, number[]>();
  for (const i of arranged) {
    const k = groupKey(read(i, groupField));
    const bucket = buckets.get(k);
    if (bucket) bucket.push(i);
    else buckets.set(k, [i]);
  }
  const declared = enumValues(schema.fields.find((f) => f.name === groupField));
  const keys = [
    ...declared.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => k !== EMPTY && !declared.includes(k)),
    ...(buckets.has(EMPTY) ? [EMPTY] : []),
  ];
  const order: number[] = [];
  const groups: GridGroup[] = [];
  for (const k of keys) {
    const bucket = buckets.get(k)!;
    groups.push({ key: k, start: order.length + 1, count: bucket.length });
    for (const i of bucket) order.push(i);
  }
  return { order, groups };
}
