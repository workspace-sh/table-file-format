// A table whose rows are in the bundle's index, not in memory (SPEC section
// 8; LARGE-TABLES-PLAN): what its view reads, and how an edit to a row is
// written. Every platform's app runs this over its own SqlDriver.

import {
  applyView,
  memoryViewRows,
  putRows,
  queryIndex,
  removeRows,
  rowLocal,
  searchRows,
  type IndexQuery,
  type ParsedTable,
  type SqlDriver,
  type View,
  type ViewRows,
} from "@workspace.sh/table-core";

/** Tables with this many rows or more are read through the index. */
export const INDEXED_FROM = 50_000;

/** What a view asks the index for: the view as shown (arranged), and the viewer's search. */
export function viewQuery(view: View, search = ""): IndexQuery {
  return {
    ...(view.filter ? { filter: view.filter } : {}),
    ...(view.sort ? { sort: view.sort } : {}),
    ...(view.order ? { order: view.order } : {}),
    ...(search.trim().length > 0 ? { search } : {}),
    ...(view.group?.field !== undefined ? { group: view.group.field } : {}),
    ...(view.totals ? { totals: view.totals } : {}),
  };
}

/**
 * Whether a table can be held in the index: one whose formulas read only
 * their own row, and with no Sheet view, whose formulas read by place
 * (LARGE-TABLES-PLAN section 1). Any other is held in memory.
 */
export function canBeIndexed(table: Pick<ParsedTable, "schema" | "views">): boolean {
  if (table.views.some((v) => v.coordinates === true)) return false;
  const computed = table.schema.fields.filter((f) => f.computed);
  return computed.length === 0 || rowLocal(table.schema, computed);
}

/**
 * The rows a view of an indexed table shows. The index answers when it
 * can promise what memory would give; when it can't (a field holding
 * values its type doesn't, a filter JavaScript would coerce), every row is
 * read out of it and the view is worked out in memory, which is always
 * right and, on a large table, slow.
 */
export async function indexedViewRows(
  db: SqlDriver,
  name: string,
  table: ParsedTable,
  view: View,
  search = "",
): Promise<ViewRows> {
  const version = `${table.indexed?.version ?? 0}|${JSON.stringify(viewQuery(view, search))}`;
  const answered = await queryIndex(db, { name, schema: table.schema, query: viewQuery(view, search), version });
  if (answered) return answered;
  const all = await queryIndex(db, { name, schema: table.schema });
  if (!all) throw new Error(`no index for ${name}`);
  const rows = await all.rows(0, all.count);
  const inView = applyView({ ...table, rows }, view);
  const shown = searchRows(inView, search, { schema: table.schema, bodies: table.bodies });
  return memoryViewRows(shown, {
    inView: inView.length,
    version,
    schema: table.schema,
    ...(view.group?.field !== undefined ? { group: view.group.field } : {}),
    ...(view.totals ? { totals: view.totals } : {}),
  });
}

let edits = 0;
/** A key no saved file has: an edited index is stale until its rows are saved and it's stamped again. */
const editedKey = () => `edited:${Date.now()}:${++edits}`;

/** A cell of an indexed table's row set. False when there's no such row. */
export async function setIndexedCell(db: SqlDriver, name: string, table: ParsedTable, rowId: string, field: string, value: unknown): Promise<boolean> {
  const all = await queryIndex(db, { name, schema: table.schema });
  const row = await all?.row(rowId);
  if (!row) return false;
  const next = { ...row };
  if (value === undefined) delete next[field];
  else next[field] = value as never;
  await putRows(db, { name, schema: table.schema, rows: [next], key: editedKey() });
  return true;
}

/** A new, empty row at the end of an indexed table. */
export async function addIndexedRow(db: SqlDriver, name: string, table: ParsedTable, id: string): Promise<void> {
  await putRows(db, { name, schema: table.schema, rows: [{ id }], key: editedKey() });
}

/** A row of an indexed table removed. */
export async function removeIndexedRow(db: SqlDriver, name: string, table: ParsedTable, rowId: string): Promise<void> {
  await removeRows(db, { name, schema: table.schema, ids: [rowId], key: editedKey() });
}

/** A row's page, as the index searches it; an empty string removes it. */
export async function setIndexedBody(db: SqlDriver, name: string, table: ParsedTable, rowId: string, content: string): Promise<void> {
  const all = await queryIndex(db, { name, schema: table.schema });
  const row = await all?.row(rowId);
  if (!row) return;
  await putRows(db, { name, schema: table.schema, rows: [row], bodies: { [rowId]: content }, key: editedKey() });
}

/** One edit to a row of an indexed table, as the app's state queues them (AppState.indexWork). */
export type IndexEdit =
  | { kind: "cell"; rowId: string; field: string; value: unknown }
  | { kind: "add"; rowId: string }
  | { kind: "remove"; rowId: string }
  | { kind: "body"; rowId: string; content: string };

/** Make queued edits in the index, in order, and say how many rows the table has after them. */
export async function makeIndexEdits(db: SqlDriver, name: string, table: ParsedTable, edits: readonly IndexEdit[]): Promise<number> {
  for (const edit of edits) {
    if (edit.kind === "cell") await setIndexedCell(db, name, table, edit.rowId, edit.field, edit.value);
    else if (edit.kind === "add") await addIndexedRow(db, name, table, edit.rowId);
    else if (edit.kind === "remove") await removeIndexedRow(db, name, table, edit.rowId);
    else await setIndexedBody(db, name, table, edit.rowId, edit.content);
  }
  const all = await queryIndex(db, { name, schema: table.schema });
  if (!all) throw new Error(`no index for ${name}`);
  return all.count;
}
