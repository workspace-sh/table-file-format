// A table whose rows are in the bundle's index, not in memory (SPEC section
// 8; LARGE-TABLES-PLAN): what its view reads, and how an edit to a row is
// written. Every platform's app runs this over its own SqlDriver.

import {
  applyView,
  buildIndex,
  memoryViewRows,
  putRows,
  queryIndex,
  removeRows,
  rowLocal,
  searchRows,
  type IndexQuery,
  type ParsedTable,
  type Row,
  type SqlDriver,
  type TableSchema,
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

// -- A table's rows as the bytes of its rows.ndjson: what an archive holds, and a browser's file storage ----

const NEWLINE = 10;

/**
 * The rows in `bytes`, a `rows.ndjson`, one at a time, never as one string:
 * a line that doesn't parse, or has no id, is skipped as the reader skips
 * it (SPEC section 3).
 */
export function* rowsInBytes(bytes: Uint8Array): Iterable<Row> {
  const decoder = new TextDecoder();
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(NEWLINE, start);
    if (end < 0) end = bytes.length;
    if (end > start) {
      const line = decoder.decode(bytes.subarray(start, end));
      if (line.trim().length > 0) {
        try {
          const row: unknown = JSON.parse(line);
          if (row !== null && typeof row === "object" && typeof (row as Row).id === "string") yield row as Row;
        } catch {
          // Skipped.
        }
      }
    }
    start = end + 1;
  }
}

/** How many lines of `bytes` hold something: its rows, near enough to say how far a build has got. */
export function linesInBytes(bytes: Uint8Array): number {
  let count = 0;
  let blank = true;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === NEWLINE) {
      if (!blank) count++;
      blank = true;
    } else if (byte !== 13 && byte !== 32 && byte !== 9) blank = false;
  }
  return blank ? count : count + 1;
}

/** The first `count` rows in `bytes`: what shows while the rest are read. */
export function firstRowsInBytes(bytes: Uint8Array, count: number): Row[] {
  const rows: Row[] = [];
  for (const row of rowsInBytes(bytes)) {
    rows.push(row);
    if (rows.length >= count) break;
  }
  return rows;
}

/**
 * Build a table's index from the bytes of its `rows.ndjson`, streaming
 * them in, with its search index left for after (`buildSearchIndex`).
 * Resolves with how many rows went in.
 */
export async function buildIndexFromBytes(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; rows: Uint8Array; bodies?: Record<string, string>; key: string; onProgress?: (done: number, total: number) => void },
): Promise<number> {
  const total = options.onProgress ? linesInBytes(options.rows) : 0;
  let done = 0;
  options.onProgress?.(0, total);
  async function* streamed(): AsyncIterable<Row> {
    for (const row of rowsInBytes(options.rows)) {
      done++;
      if (done % 5000 === 0) options.onProgress?.(done, total);
      yield row;
    }
  }
  await buildIndex(db, { name: options.name, schema: options.schema, rows: streamed(), bodies: options.bodies, key: options.key, search: "later" });
  options.onProgress?.(done, total);
  return done;
}
