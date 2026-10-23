// A table whose rows are in the bundle's index, not in memory (SPEC section
// 8; LARGE-TABLES-PLAN): what its view reads, and how an edit to a row is
// written. Every platform's app runs this over its own SqlDriver.

import {
  applyView,
  buildIndex,
  memoryViewRows,
  parseRowsText,
  putRows,
  queryIndex,
  removeRows,
  rowLocal,
  searchRows,
  type IndexQuery,
  type LazyZipEntry,
  type ParsedTable,
  type Row,
  type SqlDriver,
  type TableSchema,
  type UnreadLine,
  type ValidationError,
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

/** A cell of an indexed table's row set. Gives back what the cell held ({ value }), or null when there's no such row. */
export async function setIndexedCell(
  db: SqlDriver,
  name: string,
  table: ParsedTable,
  rowId: string,
  field: string,
  value: unknown,
): Promise<{ value: unknown } | null> {
  const all = await queryIndex(db, { name, schema: table.schema });
  const row = await all?.row(rowId);
  if (!row) return null;
  const next = { ...row };
  if (value === undefined) delete next[field];
  else next[field] = value as never;
  await putRows(db, { name, schema: table.schema, rows: [next], key: editedKey() });
  return { value: row[field] };
}

/** A new, empty row at the end of an indexed table. */
export async function addIndexedRow(db: SqlDriver, name: string, table: ParsedTable, id: string): Promise<void> {
  await putRows(db, { name, schema: table.schema, rows: [{ id }], key: editedKey() });
}

/** A row of an indexed table removed. Gives back the row and its place in the file order, or null when there's no such row. */
export async function removeIndexedRow(db: SqlDriver, name: string, table: ParsedTable, rowId: string): Promise<{ row: Row; at: number } | null> {
  return (await removeRows(db, { name, schema: table.schema, ids: [rowId], key: editedKey() }))[0] ?? null;
}

/** A row's page, as the index searches it; an empty string removes it. */
export async function setIndexedBody(db: SqlDriver, name: string, table: ParsedTable, rowId: string, content: string): Promise<void> {
  const all = await queryIndex(db, { name, schema: table.schema });
  const row = await all?.row(rowId);
  if (!row) return;
  await putRows(db, { name, schema: table.schema, rows: [row], bodies: { [rowId]: content }, key: editedKey() });
}

/** A row removed from an indexed table put back where it was, with its page. */
export async function restoreIndexedRow(db: SqlDriver, name: string, table: ParsedTable, row: Row, at: number, content?: string): Promise<void> {
  await putRows(db, {
    name,
    schema: table.schema,
    rows: [row],
    at: { [row.id]: at },
    ...(content !== undefined ? { bodies: { [row.id]: content } } : {}),
    key: editedKey(),
  });
}

/**
 * One edit to a row of an indexed table, as the app's state queues them
 * (AppState.indexWork). `restore` is what undoes a `remove`: the row as it
 * was, its place in the file order, and its page.
 */
export type IndexEdit =
  | { kind: "cell"; rowId: string; field: string; value: unknown }
  | { kind: "add"; rowId: string }
  | { kind: "remove"; rowId: string }
  | { kind: "body"; rowId: string; content: string }
  | { kind: "restore"; rowId: string; row: Row; at: number; content?: string };

/**
 * Make queued edits in the index, in order. Says how many rows the table
 * has after them, and for each edit the one that undoes it (`back`, in the
 * edits' order): null where the edit changed nothing, and for a page,
 * whose text before is the state's to know (the index holds it folded).
 */
export async function makeIndexEdits(
  db: SqlDriver,
  name: string,
  table: ParsedTable,
  edits: readonly IndexEdit[],
): Promise<{ count: number; back: (IndexEdit | null)[] }> {
  const back: (IndexEdit | null)[] = [];
  for (const edit of edits) {
    if (edit.kind === "cell") {
      const was = await setIndexedCell(db, name, table, edit.rowId, edit.field, edit.value);
      back.push(was ? { kind: "cell", rowId: edit.rowId, field: edit.field, value: was.value } : null);
    } else if (edit.kind === "add") {
      await addIndexedRow(db, name, table, edit.rowId);
      back.push({ kind: "remove", rowId: edit.rowId });
    } else if (edit.kind === "remove") {
      const was = await removeIndexedRow(db, name, table, edit.rowId);
      back.push(was ? { kind: "restore", rowId: edit.rowId, row: was.row, at: was.at } : null);
    } else if (edit.kind === "restore") {
      await restoreIndexedRow(db, name, table, edit.row, edit.at, edit.content);
      back.push({ kind: "remove", rowId: edit.rowId });
    } else {
      await setIndexedBody(db, name, table, edit.rowId, edit.content);
      back.push(null);
    }
  }
  const all = await queryIndex(db, { name, schema: table.schema });
  if (!all) throw new Error(`no index for ${name}`);
  return { count: all.count, back };
}

// -- A table's rows as the bytes of its rows.ndjson: what an archive holds, and a browser's file storage ----

const NEWLINE = 10;

/**
 * The rows in `bytes`, a `rows.ndjson`, one at a time, never as one string:
 * a line that doesn't parse, or has no id, is skipped as the reader skips
 * it (SPEC section 3).
 */
export function rowsInBytes(bytes: Uint8Array): Iterable<Row> {
  return rowsInChunks([bytes]);
}

/**
 * Splits a `rows.ndjson` that comes in pieces into its rows: a line may run
 * across two pieces. `push` each piece in turn, then `end`.
 */
function rowSplitter(onBytes?: (bytes: number) => void, strict?: () => string): { push(chunk: Uint8Array): Iterable<Row>; end(): Iterable<Row> } {
  const decoder = new TextDecoder();
  const rowOf = (line: Uint8Array): Row | undefined => {
    if (line.length === 0) return undefined;
    const text = decoder.decode(line);
    if (text.trim().length === 0) return undefined;
    let row: unknown;
    try {
      row = JSON.parse(text);
    } catch {
      row = undefined;
    }
    if (row !== null && typeof row === "object" && !Array.isArray(row) && typeof (row as Row).id === "string" && (row as Row).id !== "") return row as Row;
    // Read for an index, a line that isn't a row stops it: the index writes the rows back, and would leave the line out (#567).
    if (strict) throw new Error(`a line of ${strict()} couldn't be read`);
    return undefined;
  };
  // The start of a line whose end is in the next piece.
  let carry: Uint8Array | null = null;
  return {
    *push(chunk) {
      let start = 0;
      for (;;) {
        const end = chunk.indexOf(NEWLINE, start);
        if (end < 0) break;
        let line = chunk.subarray(start, end);
        if (carry) {
          const joined: Uint8Array = new Uint8Array(carry.length + line.length);
          joined.set(carry);
          joined.set(line, carry.length);
          line = joined;
          carry = null;
        }
        // Said a line at a time, not a piece at a time: a piece can be most of the file.
        onBytes?.(line.length + 1);
        const row = rowOf(line);
        if (row) yield row;
        start = end + 1;
      }
      if (start < chunk.length) {
        const rest = chunk.subarray(start);
        if (carry) {
          const joined: Uint8Array = new Uint8Array(carry.length + rest.length);
          joined.set(carry);
          joined.set(rest, carry.length);
          carry = joined;
        } else carry = rest.slice();
      }
    },
    *end() {
      if (carry) onBytes?.(carry.length);
      const last = carry ? rowOf(carry) : undefined;
      carry = null;
      if (last) yield last;
    },
  };
}

/** The same, for a `rows.ndjson` that comes in pieces: a line may be split across two. */
export function* rowsInChunks(chunks: Iterable<Uint8Array>, onBytes?: (bytes: number) => void): Iterable<Row> {
  const split = rowSplitter(onBytes);
  for (const chunk of chunks) yield* split.push(chunk);
  yield* split.end();
}

/**
 * The same, for pieces read as they come (a file read a piece at a time over
 * an asynchronous API, as the Mac's is). Given `strict`, a line that isn't a
 * row throws, naming the file `strict` says it's in.
 */
export async function* rowsInAsyncChunks(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, onBytes?: (bytes: number) => void, strict?: () => string): AsyncIterable<Row> {
  const split = rowSplitter(onBytes, strict);
  for await (const chunk of chunks) yield* split.push(chunk);
  yield* split.end();
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
 * Build a table's index from its `rows.ndjson`, as bytes or in pieces
 * (`chunks`, each also handed to `keep` as it's read, for a copy), with its
 * search index left for after (`buildSearchIndex`). `size` is the whole
 * file's, for saying how far along a build from pieces is: its row count
 * isn't known until the end, so the total it reports is worked out from the
 * rows so far. Resolves with how many rows went in.
 */
export async function buildIndexFromBytes(
  db: SqlDriver,
  options: {
    name: string;
    schema: TableSchema;
    // `chunks` may come as they're read (an async iterable); `keep` may write them away asynchronously, and each is waited for.
    // `files`, in place of `chunks`: a table's rows files (D51), each said to `onFile` with the place its first row takes, as it's begun.
    rows:
      | Uint8Array
      | {
          chunks?: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
          files?: { name: string; chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array> }[];
          size: number;
          keep?: (chunk: Uint8Array, file: string) => unknown;
          onFile?: (file: string, first: number) => unknown;
        };
    bodies?: Record<string, string>;
    key: string;
    onProgress?: (done: number, total: number) => void;
    /** Rows per transaction and per batch, as buildIndex takes them: for a device that stalls on a long commit or a long batch. */
    commitEvery?: number;
    batchSize?: number;
  },
): Promise<number> {
  const whole = options.rows instanceof Uint8Array ? options.rows : null;
  const pieces = options.rows instanceof Uint8Array ? null : options.rows;
  const counted = whole && options.onProgress ? linesInBytes(whole) : 0;
  let done = 0;
  let read = 0;
  const total = () => (pieces ? (read > 0 ? Math.max(done, Math.round((done / read) * pieces.size)) : 0) : counted);
  options.onProgress?.(0, total());
  // The rows file being read, for saying where a line that couldn't be read is.
  let reading = "";
  async function* taken(): AsyncIterable<Uint8Array> {
    for (const file of pieces!.files ?? [{ name: "", chunks: pieces!.chunks ?? [] }]) {
      reading = file.name;
      // Every row of the files before has been taken by now: a piece is asked for only once the last one's rows are.
      await pieces!.onFile?.(file.name, done + 1);
      let last = NEWLINE;
      for await (const chunk of file.chunks) {
        await pieces!.keep?.(chunk, file.name);
        if (chunk.length > 0) last = chunk[chunk.length - 1]!;
        yield chunk;
      }
      // A file whose last line has no end: its row is its own, not the start of the next file's first.
      if (last !== NEWLINE) yield new Uint8Array([NEWLINE]);
    }
  }
  async function* streamed(): AsyncIterable<Row> {
    const where = () => (reading ? `rows/${reading}` : "its rows");
    for await (const row of whole ? rowsInAsyncChunks([whole], undefined, where) : rowsInAsyncChunks(taken(), (bytes) => (read += bytes), where)) {
      done++;
      if (done % 5000 === 0) options.onProgress?.(done, total());
      yield row;
    }
  }
  await buildIndex(db, {
    name: options.name,
    schema: options.schema,
    rows: streamed(),
    bodies: options.bodies,
    key: options.key,
    search: "later",
    ...(options.commitEvery !== undefined ? { commitEvery: options.commitEvery } : {}),
    ...(options.batchSize !== undefined ? { batchSize: options.batchSize } : {}),
  });
  options.onProgress?.(done, done);
  return done;
}

/** A large table's rows read into memory after all, with what couldn't be read kept (SPEC section 3): what a table held there needs. */
export interface HeldRows {
  rows: Row[];
  rowFiles: { name: string; ids: string[] }[];
  unread: UnreadLine[];
  diagnostics: ValidationError[];
}

/**
 * A table's rows from an archive's rows files, read as a reader reads them:
 * a line that isn't a row, or repeats a row's id, is kept to be written back
 * and said, not dropped (#567, D54). For holding a table in memory when its
 * index can't be made.
 */
export function readHeldRows(rows: LazyZipEntry, firstFile: string): HeldRows {
  const decoder = new TextDecoder();
  const held: HeldRows = { rows: [], rowFiles: [], unread: [], diagnostics: [] };
  const seen = new Map<string, Row>();
  for (const part of rows.parts ?? [{ name: firstFile, entry: rows }]) {
    let text = "";
    for (const chunk of part.entry.chunks()) text += decoder.decode(chunk, { stream: true });
    text += decoder.decode();
    const these = parseRowsText(text, held.diagnostics, held.unread, { file: `rows/${part.name}`, after: held.rows.at(-1)?.id ?? null, seen });
    for (const r of these) held.rows.push(r);
    held.rowFiles.push({ name: part.name, ids: these.map((r) => r.id) });
  }
  return held;
}

/** What a table read into memory takes from HeldRows: its rows, and the rest only when there is any, as a reader sets them. */
export function withHeld(held: HeldRows): Pick<ParsedTable, "rows" | "rowFiles" | "unread" | "diagnostics"> {
  return {
    rows: held.rows,
    ...(held.rowFiles.length > 0 ? { rowFiles: held.rowFiles } : {}),
    ...(held.unread.length > 0 ? { unread: held.unread } : {}),
    ...(held.diagnostics.length > 0 ? { diagnostics: held.diagnostics } : {}),
  };
}

/** What's said of a large table held in memory because no index could be made of it: why, and that the lines it couldn't read are kept. */
export function heldText(table: string, error: unknown, held: HeldRows): string {
  const why = `${table} is large, and its index couldn't be made (${error instanceof Error ? error.message : String(error)}). It's held in memory instead, and may be slow.`;
  const lines = held.unread.length;
  if (lines === 0) return why;
  return `${why} ${lines === 1 ? "A line of its rows couldn't be read; it's kept as it is." : `${lines} lines of its rows couldn't be read; they're kept as they are.`}`;
}

