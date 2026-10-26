// The index (SPEC section 8): a table's rows kept in SQLite so a view, a
// search or a point read costs milliseconds at a million rows, and an edit
// is a statement, not a rebuild. One implementation for every platform: it
// speaks to a `SqlDriver`, a few lines over node:sqlite, op-sqlite,
// expo-sqlite or SQLite WASM.
//
// The index answers exactly what the in-memory path (applyView, searchRows)
// would, or says it can't: `queryIndex` returns null when it can't promise
// the same rows, and the caller computes the view in memory. Nothing is
// ever approximately right.

import { instantOf } from "./encoding.js";
import type { CellFormula, Field, ParsedTable, Row, TableSchema, ViewFilter, ViewSort, ViewTotal } from "./types.js";
import { cellFormulas, cellLine } from "./cells.js";
import { cellRenamed } from "./renameField.js";
import { enumValues } from "./types.js";
import type { RowGroup, ViewRows } from "./row-source.js";
import { exactSum } from "./query.js";
import { computeRows, rowLocal } from "./workbook.js";

export type SqlValue = string | number | null;

/** What the index needs of a SQLite binding. */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all(sql: string, params?: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  /** Runs one statement for many parameter lists, if the binding can do that faster than `run` in a loop. */
  batch?(sql: string, params: SqlValue[][]): Promise<void>;
  /**
   * True when every statement runs in this process, so a statement a row
   * costs only SQLite's own work (node:sqlite, SQLite WASM). Unset, each
   * statement crosses to native code (op-sqlite, expo-sqlite), and the
   * indexer sends a batch of rows as one statement where it can.
   */
  inProcess?: boolean;
}

/** Structured query: the view's filter and sort, a manual order, and free text (SPEC section 8). Never raw SQL. */
export interface IndexQuery {
  filter?: ViewFilter[];
  sort?: ViewSort[];
  /** A view's manual order: the rows named come first in this order, the rest follow in file order, and `sort` is ignored (as applyView does). */
  order?: string[];
  /** Case-insensitive substring over string, date and datetime fields, the row id and the page: searchRows' scope. */
  search?: string;
  /** The field a view groups by: rows come a group at a time, in applyGroup's order. */
  group?: string;
  /** The view's totals, by field. */
  totals?: Record<string, ViewTotal>;
  /** Rows the view hides by hand, by id (D58). */
  hidden?: string[];
}

/** The rows a query matches, as a view reads them (a ViewRows), every answer a promise. */
export interface IndexedRows extends ViewRows {
  rows(start: number, end: number): Promise<Row[]>;
  ids(start: number, end: number): Promise<string[]>;
  placeOf(id: string): Promise<number>;
  row(id: string): Promise<Row | undefined>;
  totals(): Promise<Record<string, number | undefined>>;
  groups(): Promise<RowGroup[]>;
}

export interface BuildOptions {
  /** The table's name in its bundle; one database holds every table of a bundle. */
  name: string;
  schema: TableSchema;
  /** In file order. Rows can be streamed (insertion is batched) unless the schema has formulas that read other rows. */
  rows: Row[] | AsyncIterable<Row>;
  /** Pages by row id (SPEC section 7); searched along with the fields. */
  bodies?: Record<string, string>;
  /** What the source was at this point, a content hash: `isIndexStale` compares it. */
  key: string;
  /** Rows per transaction step; 5,000 by default. */
  batchSize?: number;
  /**
   * "later" leaves the search's own index (the slow part of a build)
   * unmade: the table answers everything at once, a search by reading
   * each row's text, and `buildSearchIndex` makes it a step at a time.
   */
  search?: "now" | "later";
  /**
   * Rows per transaction. Left out, the build is one transaction: a
   * reader sees the old index or the new one. Given, it commits every so
   * many rows, so no commit is larger than that (a phone stops its timers
   * for the whole of a long one). The table then has no key from the
   * build's first step to its last: a reader sees no index, and reads from
   * memory, until it is whole; never half of one. A build that fails
   * part-way leaves none.
   */
  commitEvery?: number;
  /** Cells' own formulas (D52): every `cells/` line, kept with the rows. Each must read only its own row. */
  cells?: CellFormula[];
}

export const INDEX_FORMAT = 1;

const SEP = "\u0001";
const BATCH = 5000;
/** How far into every row, in file order, a window is before it is found by position and not by skipping to it. */
const DEEP = 2000;
/** The longest manual order the index sorts by; past it the view is computed in memory. */
const MAX_ORDER = 5000;
const NEVER = 1e9;

type Kind = "number" | "boolean" | "text" | "datetime" | "array" | "opaque";

function kindOf(field: Field): Kind {
  switch (field.type) {
    case "number":
    case "integer":
    case "year":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
    case "date":
    case "time":
    case "duration":
      return "text";
    case "datetime":
      return "datetime";
    case "array":
      return "array";
    default:
      return "opaque";
  }
}

/** Searched like searchRows does: string, date and datetime fields only. */
const searched = (f: Field) => f.type === "string" || f.type === "date" || f.type === "datetime";

const isEmpty = (v: unknown) => v === undefined || v === null || v === "";

/** Whether a value is what its field's kind holds. Empty values are always fine. */
function conforms(kind: Kind, v: unknown): boolean {
  if (isEmpty(v)) return true;
  switch (kind) {
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "text":
      return typeof v === "string";
    case "datetime":
      return typeof v === "string" && !Number.isNaN(instantOf(v));
    case "array":
      return Array.isArray(v) && v.every((x) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x)));
    case "opaque":
      return true;
  }
}

interface Plan {
  fields: Field[];
  kinds: Kind[];
  /** Fields whose column can't be trusted whatever the rows hold: computed from other rows. */
  never: Set<number>;
  /** The column list after id, j and s: c, then f for text and datetime, then i for datetime. */
  columns: string[];
  /** One SQL name per field for each of its columns. */
  c: string[];
  f: (string | null)[];
  i: (string | null)[];
}

function planOf(schema: TableSchema): Plan {
  const fields = schema.fields;
  const kinds = fields.map(kindOf);
  const computed = fields.filter((f) => f.computed);
  const local = computed.length === 0 || rowLocal(schema, computed);
  const never = new Set<number>();
  if (!local) fields.forEach((f, n) => f.computed && never.add(n));
  const c = fields.map((_, n) => `c${n}`);
  const f = kinds.map((k, n) => (k === "text" || k === "datetime" ? `f${n}` : null));
  const i = kinds.map((k, n) => (k === "datetime" ? `i${n}` : null));
  const columns: string[] = [];
  fields.forEach((_, n) => {
    columns.push(c[n]!);
    if (f[n]) columns.push(f[n]!);
    if (i[n]) columns.push(i[n]!);
  });
  return { fields, kinds, never, columns, c, f, i };
}

/** A table's identity as the index keeps it: field names and types, which decide the columns. */
const signature = (schema: TableSchema) => JSON.stringify(schema.fields.map((f) => [f.name, f.type, f.computed ? 1 : 0]));

/** The separator can't be inside a part, or a search could match across two of them. */
function clean(s: string): string {
  return s.includes(SEP) ? s.split(SEP).join("\u0002") : s;
}

/** What a row is in the index: its column values, its search text, and which fields hold something their kind doesn't. */
function encode(plan: Plan, row: Row, body: string | undefined): { values: SqlValue[]; search: string; bad: number[] } {
  const values: SqlValue[] = [];
  const bad: number[] = [];
  const parts: string[] = [clean(String(row.id).toLowerCase())];
  plan.fields.forEach((field, n) => {
    const kind = plan.kinds[n]!;
    const v = row[field.name];
    const ok = conforms(kind, v);
    if (!ok) bad.push(n);
    // "" is kept as '' (a filter can tell it from an absent value); null and absent are NULL.
    let c: SqlValue = null;
    if (v === "") c = "";
    else if (ok && !isEmpty(v)) {
      if (kind === "boolean") c = v ? 1 : 0;
      else if (kind === "array" || kind === "opaque") c = JSON.stringify(v);
      else c = v as string | number;
    }
    values.push(c);
    if (plan.f[n]) values.push(typeof c === "string" ? c.toLowerCase() : null);
    if (plan.i[n]) values.push(typeof c === "string" && c !== "" ? instantOf(c) : null);
    if (searched(field)) parts.push(typeof v === "string" ? clean(v.toLowerCase()) : "");
  });
  parts.push(body === undefined ? "" : clean(body.toLowerCase()));
  return { values, search: parts.join(SEP), bad };
}

// -- Tables ---------------------------------------------------------------

async function tableNumber(db: SqlDriver, name: string, create: boolean): Promise<number | null> {
  await db.exec(
    "create table if not exists _tables(name text primary key, n integer not null, key text, format integer, sig text, built_at text)",
  );
  const found = await db.all("select n from _tables where name = ?", [name]);
  if (found[0]) return found[0].n as number;
  if (!create) return null;
  const next = ((await db.all("select max(n) as m from _tables"))[0]?.m as number | null) ?? 0;
  await db.run("insert into _tables(name, n) values(?, ?)", [name, next + 1]);
  return next + 1;
}

// ---- Cells' own formulas (D52): every `cells/` line, kept by the index as the table's rows are

/** The key a row read out of the index carries its cells' own formulas under, by field: for an editor to start from. Never a field's name. */
export const OWN_FORMULAS = "\u0000cells";
/** The key a row read out of the index carries its cells' notes under, by field (D57). Never a field's name. */
export const CELL_NOTES = "\u0000notes";

async function cellsTable(db: SqlDriver): Promise<void> {
  await db.exec("create table if not exists _cells(n integer not null, seq integer not null, id text not null, field text not null, line text not null, primary key(n, seq)); create index if not exists _cells_id on _cells(n, id)");
}

/** A table's `cells/` lines, all of them, replaced. */
async function setCellLines(db: SqlDriver, n: number, cells: readonly CellFormula[]): Promise<void> {
  await cellsTable(db);
  await db.run("delete from _cells where n = ?", [n]);
  let seq = 0;
  for (const c of cells) await db.run("insert into _cells(n, seq, id, field, line) values(?, ?, ?, ?, ?)", [n, ++seq, c.id, c.field, cellLine(c)]);
}

/** The lines of the rows `ids` (all of the table's when absent), in the order kept. */
async function cellLinesOf(db: SqlDriver, n: number, ids?: readonly string[]): Promise<CellFormula[]> {
  await cellsTable(db);
  if (ids && ids.length === 0) return [];
  const found = ids
    ? await db.all(`select line from _cells where n = ? and id in (${ids.map(() => "?").join(", ")}) order by seq`, [n, ...ids])
    : await db.all("select line from _cells where n = ? order by seq", [n]);
  return found.map((r) => JSON.parse(r.line as string) as CellFormula);
}

/** Whether a table has any cells' own formulas, so reads put their results back (D52). */
async function hasCells(db: SqlDriver, n: number): Promise<boolean> {
  await cellsTable(db);
  return (await db.all("select 1 from _cells where n = ? limit 1", [n])).length > 0;
}

/**
 * Rows as computed, and the JSON the index keeps for each: the computed
 * row without the results of formulas cells have of their own in stored
 * fields, which are never stored (D52), so the rows written back hold none.
 */
function withOwnCells(schema: TableSchema, raw: Row[], cells: readonly CellFormula[], compute: boolean): { shown: Row[]; kept: Row[] } {
  if (cells.length === 0) {
    const shown = compute ? computeRows(schema, raw).rows : raw;
    return { shown, kept: shown };
  }
  const shown = computeRows(schema, raw, { cells: [...cells] }).rows;
  const own = cellFormulas(schema, raw, cells);
  const stored = new Set(schema.fields.filter((f) => !f.computed).map((f) => f.name));
  const kept = shown.map((row) => {
    const mine = own.get(row.id);
    if (!mine) return row;
    const next = { ...row };
    for (const field of mine.keys()) if (stored.has(field)) delete next[field];
    return next;
  });
  return { shown, kept };
}

/** Rows read out of the index, their cells' own formulas' results put back and the formulas themselves carried for an editor (OWN_FORMULAS). */
async function withCellResults(db: SqlDriver, n: number, schema: TableSchema, rows: Row[]): Promise<Row[]> {
  const ids = rows.map((r) => r.id);
  const cells = await cellLinesOf(db, n, ids);
  if (cells.length === 0) return rows;
  const formulas = cells.some((c) => c.expr !== undefined);
  const shown = formulas ? computeRows(schema, rows, { cells }).rows : rows;
  const own = cellFormulas(schema, rows, cells);
  // Each cell's note, the first line's for it (D57).
  const notes = new Map<string, Record<string, string>>();
  for (const c of cells) {
    if (c.note === undefined) continue;
    const mine = notes.get(c.id) ?? {};
    mine[c.field] ??= c.note;
    notes.set(c.id, mine);
  }
  return shown.map((row) => {
    const mine = own.get(row.id);
    const noted = notes.get(row.id);
    if (!mine && !noted) return row;
    return {
      ...row,
      ...(mine ? { [OWN_FORMULAS]: Object.fromEntries([...mine].map(([f, c]) => [f, c.expr])) } : {}),
      ...(noted ? { [CELL_NOTES]: noted } : {}),
    };
  });
}

/** Whether cells' formulas read only their own row, as an index of row-at-a-time work needs. */
export function cellsRowLocal(cells: readonly CellFormula[] | undefined): boolean {
  if (!cells || cells.length === 0) return true;
  const fields = cells.flatMap((c, i) => (c.expr === undefined ? [] : [{ name: `\u0000${i}`, type: "string" as const, computed: { expr: c.expr, dialect: c.dialect ?? "table-expr-v1" } }]));
  return rowLocal({ fields }, fields);
}

/**
 * A cell of an indexed table given its own formula, in the stored form, or
 * none (null) (D52): every line for that cell replaced, the row worked out
 * again. A formula set on a stored field takes the row's value's place.
 * Gives back the formula it had, or null when there's no such row.
 */
export async function setIndexedCellFormula(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; rowId: string; field: string; expr: string | null; key: string },
): Promise<{ was: string | undefined } | null> {
  const n = await tableNumber(db, options.name, false);
  if (n === null) throw new Error(`no index for ${options.name}`);
  const found = (await db.all(`select j from r${n} where id = ?`, [options.rowId]))[0];
  if (!found) return null;
  await cellsTable(db);
  const line = (await cellLinesOf(db, n, [options.rowId])).find((c) => c.field === options.field);
  const had = line?.expr;
  await db.run("delete from _cells where n = ? and id = ? and field = ?", [n, options.rowId, options.field]);
  // The cell's note stays, with or without a formula (D57).
  const note = line?.note;
  if (options.expr !== null || note !== undefined) {
    const seq = Number((await db.all("select coalesce(max(seq), 0) as m from _cells where n = ?", [n]))[0]!.m) + 1;
    const next: CellFormula = { id: options.rowId, field: options.field, ...(options.expr !== null ? { expr: options.expr } : {}), ...(note !== undefined ? { note } : {}) };
    await db.run("insert into _cells(n, seq, id, field, line) values(?, ?, ?, ?, ?)", [n, seq, options.rowId, options.field, cellLine(next)]);
  }
  const row = JSON.parse(found.j as string) as Row;
  if (options.expr !== null && !options.schema.fields.find((f) => f.name === options.field)?.computed) delete row[options.field];
  await putRows(db, { name: options.name, schema: options.schema, rows: [row], key: options.key });
  return { was: had };
}

/** A cell of an indexed table's note set, or taken away (empty) (D57). Gives back the note it had; null when there's no such row. */
export async function setIndexedCellNote(
  db: SqlDriver,
  options: { name: string; rowId: string; field: string; note: string; key: string },
): Promise<{ was: string | undefined } | null> {
  const n = await tableNumber(db, options.name, false);
  if (n === null) throw new Error(`no index for ${options.name}`);
  if ((await db.all(`select 1 from r${n} where id = ?`, [options.rowId])).length === 0) return null;
  const line = (await cellLinesOf(db, n, [options.rowId])).find((c) => c.field === options.field);
  const kept = options.note.trim() === "" ? undefined : options.note;
  await db.run("delete from _cells where n = ? and id = ? and field = ?", [n, options.rowId, options.field]);
  const { note: _was, ...rest } = line ?? { id: options.rowId, field: options.field };
  const next: CellFormula = { ...rest, ...(kept !== undefined ? { note: kept } : {}) } as CellFormula;
  if (next.expr !== undefined || next.note !== undefined) {
    const seq = Number((await db.all("select coalesce(max(seq), 0) as m from _cells where n = ?", [n]))[0]!.m) + 1;
    await db.run("insert into _cells(n, seq, id, field, line) values(?, ?, ?, ?, ?)", [n, seq, options.rowId, options.field, cellLine(next)]);
  }
  await db.run("update _tables set key = ?, built_at = ? where n = ?", [options.key, new Date().toISOString(), n]);
  return { was: line?.note };
}

/** A table's cells' own formulas, out of its index: all its lines (D52). */
export async function indexedCells(db: SqlDriver, name: string): Promise<CellFormula[]> {
  const n = await tableNumber(db, name, false);
  if (n === null) throw new Error(`no index for ${name}`);
  return cellLinesOf(db, n);
}

/**
 * A table's `cells/` text out of its index, as a writer writes it (D52):
 * in the rows' file order, a line for no row after; a stored field's line
 * whose row holds a value as well goes (the value was typed after it).
 * Empty when it has none.
 */
export async function storedCellsText(db: SqlDriver, options: { name: string; schema: TableSchema }): Promise<string> {
  const n = await tableNumber(db, options.name, false);
  if (n === null) throw new Error(`no index for ${options.name}`);
  await cellsTable(db);
  const stored = new Set(options.schema.fields.filter((f) => !f.computed).map((f) => f.name));
  const found = await db.all(`select c.line as line, c.field as field, r.j as j from _cells c left join r${n} r on r.id = c.id where c.n = ? order by (r.pos is null), r.pos, c.seq`, [n]);
  let text = "";
  for (const r of found) {
    let line = r.line as string;
    if (r.j !== null && r.j !== undefined && stored.has(r.field as string)) {
      const v = (JSON.parse(r.j as string) as Row)[r.field as string];
      const c = JSON.parse(line) as CellFormula;
      if (c.expr !== undefined && v !== undefined && v !== null && v !== "") {
        // A value typed over a formula takes its place; a note stays (D57).
        if (c.note === undefined) continue;
        const { expr: _gone, dialect: _with, ...rest } = c;
        line = cellLine(rest as CellFormula);
      }
    }
    text += `${line}\n`;
  }
  return text;
}

async function dropTables(db: SqlDriver, n: number): Promise<void> {
  await db.exec(`drop table if exists x${n}; drop table if exists r${n};`);
  await db.exec("create table if not exists _bad(n integer, fld integer, bad integer, primary key(n, fld))");
  await db.run("delete from _bad where n = ?", [n]);
  await searchUpTo(db, n);
  await db.run("delete from _fts where n = ?", [n]);
  // A fill left under way by a change of fields, and fields' values kept hidden, are for the tables just dropped.
  await setFill(db, n, null);
  await setHidden(db, n, []);
  await cellsTable(db);
  await db.run("delete from _cells where n = ?", [n]);
}

/**
 * How far a table's search index has got, for one being made a step at a
 * time: the last row position in it. Null when it's whole, as it is unless
 * the build left it for later.
 */
async function searchUpTo(db: SqlDriver, n: number): Promise<number | null> {
  await db.exec("create table if not exists _fts(n integer primary key, upto integer not null)");
  const found = await db.all("select upto from _fts where n = ?", [n]);
  return found[0] ? (found[0].upto as number) : null;
}

/**
 * Make the next piece of a search index left for later (`search: "later"`).
 * Resolves true while there is more to make. Each call is one short
 * transaction, so whatever else is asked of the database between calls is
 * answered between them.
 */
export async function buildSearchIndex(db: SqlDriver, name: string, batchSize = 20_000): Promise<boolean> {
  const n = await tableNumber(db, name, false);
  if (n === null) return false;
  const upto = await searchUpTo(db, n);
  if (upto === null) return false;
  // The search text is being made again (alterIndex): its index is made after.
  if ((await fillOf(db, n))?.search) return false;
  const last = (await db.all(`select max(pos) as m from (select pos from r${n} where pos > ? order by pos limit ?)`, [upto, batchSize]))[0]?.m as number | null;
  await db.exec("begin");
  try {
    if (last === null || last === undefined) await db.run("delete from _fts where n = ?", [n]);
    else {
      await db.run(`insert into x${n}(rowid, s) select pos, s from r${n} where pos > ? and pos <= ? order by pos`, [upto, last]);
      await db.run("update _fts set upto = ? where n = ?", [last, n]);
    }
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
  return last !== null && last !== undefined;
}

async function createTables(db: SqlDriver, n: number, plan: Plan): Promise<void> {
  await dropTables(db, n);
  await db.exec(
    `create table r${n}(pos integer primary key, id text not null, j text not null, s text not null, ${plan.columns.join(", ")});`,
  );
  await db.exec(`create unique index r${n}_id on r${n}(id);`);
}

/** Build an index for a table from its rows (SPEC section 8), replacing any index of the same name. */
export async function buildIndex(db: SqlDriver, options: BuildOptions): Promise<void> {
  const { name, schema, rows, bodies, key } = options;
  const plan = planOf(schema);
  const n = (await tableNumber(db, name, true))!;
  forgetIndexes(db, n);
  // Not given cells' own formulas: the ones it holds already, as a build again from its own rows file has none to give (D52).
  const heldCells = options.cells ? undefined : await cellLinesOf(db, n);
  await db.exec("begin");
  try {
    await createTables(db, n, plan);
    // Positions alone, for finding a window deep in file order (see `page`).
    // Made before the rows, so it grows with them a little at a time: made
    // after, it is one statement that takes seconds at a million rows, and
    // on a phone nothing scheduled runs until it's done.
    await sortIndex(db, n, ["pos"], "p");
    const steps = options.commitEvery !== undefined && options.commitEvery > 0 ? options.commitEvery : 0;
    // In steps, what's there is nobody's index until the last one says so.
    if (steps) await db.run("update _tables set key = null where n = ?", [n]);
    let uncommitted = 0;
    const computed = schema.fields.filter((f) => f.computed);
    // Formulas that read other rows are computed over every row at once; others, a batch at a time.
    const across = computed.length > 0 && !rowLocal(schema, computed);
    if (across && !Array.isArray(rows)) throw new Error("formulas that read other rows need the rows as an array");
    const source = Array.isArray(rows) && across ? computeRows(schema, rows).rows : rows;
    const perBatch = computed.length > 0 && !across;
    // Cells' own formulas (D52), worked out a batch at a time with their rows: so each must read only its own.
    const cells = options.cells ?? heldCells ?? [];
    if (cells.length > 0 && (across || !cellsRowLocal(cells))) throw new Error("cells' own formulas that read other rows can't be indexed");
    await setCellLines(db, n, cells);
    const cellsByRow = new Map<string, CellFormula[]>();
    for (const c of cells) {
      const mine = cellsByRow.get(c.id);
      if (mine) mine.push(c);
      else cellsByRow.set(c.id, [c]);
    }
    const size = options.batchSize ?? BATCH;
    const bad = new Map<number, number>();
    for (const f of plan.never) bad.set(f, NEVER);
    const sql = `insert into r${n}(id, j, s, ${plan.columns.join(", ")}) values(?, ?, ?, ${plan.columns.map(() => "?").join(", ")})`;
    const flush = async (chunk: Row[]) => {
      if (chunk.length === 0) return;
      const mine = cellsByRow.size > 0 ? chunk.flatMap((r) => cellsByRow.get(r.id) ?? []) : [];
      const { shown, kept } = withOwnCells(schema, chunk, mine, perBatch);
      const lists = shown.map((row, x) => {
        const e = encode(plan, row, bodies?.[row.id]);
        for (const f of e.bad) bad.set(f, (bad.get(f) ?? 0) + 1);
        return [String(row.id), JSON.stringify(kept[x]), e.search, ...e.values] as SqlValue[];
      });
      try {
        if (db.batch) await db.batch(sql, lists);
        else for (const params of lists) await db.run(sql, params);
      } catch (error) {
        // A row's id on more than one line (D54): the reader keeps the later lines as they are, which the index can't.
        if (/unique/i.test(error instanceof Error ? error.message : String(error))) throw new Error("two of its rows have the same id");
        throw error;
      }
    };
    let chunk: Row[] = [];
    for await (const row of source) {
      chunk.push(row);
      if (chunk.length >= size) {
        await flush(chunk);
        uncommitted += chunk.length;
        chunk = [];
        if (steps && uncommitted >= steps) {
          await db.exec("commit");
          await db.exec("begin");
          uncommitted = 0;
        }
      }
    }
    await flush(chunk);
    await db.exec(`create virtual table x${n} using fts5(s, content='r${n}', content_rowid='pos', tokenize='trigram');`);
    if (options.search === "later") await db.run("insert into _fts(n, upto) values(?, -1)", [n]);
    else await db.exec(`insert into x${n}(x${n}) values('rebuild');`);
    for (const [fld, count] of bad) await db.run("insert into _bad(n, fld, bad) values(?, ?, ?)", [n, fld, count]);
    await db.run("update _tables set key = ?, format = ?, sig = ?, built_at = ? where n = ?", [
      key,
      INDEX_FORMAT,
      signature(schema),
      new Date().toISOString(),
      n,
    ]);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    // Steps already committed are taken out again: a build leaves a whole index or none.
    if (options.commitEvery) await dropTables(db, n).catch(() => {});
    throw error;
  }
}

// -- A change of fields, in place ---------------------------------------
//
// A field added, removed, moved, retyped or given a formula changes the
// index where it is, from each row's JSON (`j`): never by reading the rows
// file again (#551). Columns are by field position, so they are renamed to
// their new places (a change to the table's schema, not its rows); a
// field's new columns are added empty; a removed field's are parked. What
// has to be worked out again (a formula's values, a retyped field's
// columns, the search text) is filled a step at a time behind whatever is
// asked meanwhile (`fillIndex`); until it's done, those fields are ones
// the index doesn't promise, and a view that sorts, filters or groups by
// them is worked out the slow way, which is right.

/** A pending fill: which fields, by their place in the schema, and how far it has got. */
interface Fill {
  upto: number;
  fields: number[];
  search: boolean;
  /** Values found that their field's type doesn't hold, by field. */
  bad: Record<number, number>;
}

async function fillOf(db: SqlDriver, n: number): Promise<Fill | null> {
  await db.exec("create table if not exists _fill(n integer primary key, upto integer not null, fill text not null)");
  const found = await db.all("select upto, fill from _fill where n = ?", [n]);
  if (!found[0]) return null;
  const { drop, ...rest } = JSON.parse(found[0].fill as string) as Omit<Fill, "upto"> & { drop?: string[] };
  // A fill from before fields were hidden took gone fields out as it went: what it hadn't yet is hidden now.
  if (drop?.length) await setHidden(db, n, [...new Set([...(await hiddenOf(db, n)), ...drop])]);
  return { upto: found[0].upto as number, ...rest };
}

async function setFill(db: SqlDriver, n: number, fill: Fill | null): Promise<void> {
  await db.exec("create table if not exists _fill(n integer primary key, upto integer not null, fill text not null)");
  if (!fill) {
    await db.run("delete from _fill where n = ?", [n]);
    return;
  }
  const { upto, ...rest } = fill;
  await db.run("insert or replace into _fill(n, upto, fill) values(?, ?, ?)", [n, upto, JSON.stringify(rest)]);
}

// -- Fields hidden --------------------------------------------------------
//
// A field removed from the schema leaves its values in each row's JSON,
// hidden: every row read or saved leaves them out, so the file loses the
// field as it did. An undo that brings the field back (alterIndex's
// `restore`) finds its values where they were (#562). A new field that
// only reuses the name has them taken out then; a build forgets them.

async function hiddenOf(db: SqlDriver, n: number): Promise<string[]> {
  await db.exec("create table if not exists _hidden(n integer, name text not null, primary key(n, name))");
  return (await db.all("select name from _hidden where n = ? order by name", [n])).map((r) => r.name as string);
}

async function setHidden(db: SqlDriver, n: number, names: string[]): Promise<void> {
  await db.exec("create table if not exists _hidden(n integer, name text not null, primary key(n, name))");
  await db.run("delete from _hidden where n = ?", [n]);
  for (const name of names) await db.run("insert into _hidden(n, name) values(?, ?)", [n, name]);
}

/** Rows as they are read: without the fields hidden. */
function withoutHidden<R extends Row>(hidden: string[], rows: R[]): R[] {
  if (hidden.length === 0) return rows;
  return rows.map((row) => {
    if (!hidden.some((name) => name in row)) return row;
    const out = { ...row };
    for (const name of hidden) delete out[name];
    return out;
  });
}

/** A row's hidden fields' values, to keep when the row is written again. */
function hiddenValues(hidden: string[], row: Row): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const name of hidden) if (name in row) kept[name] = row[name];
  return kept;
}

/** Field names in the order the search text holds them. */
const searchedNames = (schema: TableSchema) => schema.fields.filter(searched).map((f) => f.name);

let parked = 0;

/**
 * Change table `name`'s index from schema `from` to schema `to` in place.
 * Resolves false when it can't (no index, an index of another schema, or
 * formulas that read other rows among those changed): build it instead.
 * Resolves true with the index answering for `to` at once; what has to be
 * worked out again is left to `fillIndex`.
 *
 * A field `to` doesn't have keeps its values, hidden. `restore` names the
 * fields of `to` that come back with them (an undo of their removal);
 * any other field of a hidden field's name starts empty.
 */
export async function alterIndex(db: SqlDriver, name: string, from: TableSchema, to: TableSchema, options: { restore?: string[] } = {}): Promise<boolean> {
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) return false;
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(from)) return false;
  const was = planOf(from);
  const now = planOf(to);
  // Formulas over other rows are worked out over every row at once: no steps for them.
  if (was.never.size > 0 || now.never.size > 0) return false;
  const before = new Map(from.fields.map((f, i) => [f.name, i]));
  const after = new Set(to.fields.map((f) => f.name));
  // Each field of `to`'s place in `from`: by its id (D62), so a field renamed is the same field
  // (D63); else by its name, unless the field of that name has another id, which makes it another.
  const byId = new Map(from.fields.flatMap((f, i) => (f.id !== undefined ? [[f.id, i] as const] : [])));
  const matched = to.fields.map((f): number | undefined => {
    if (f.id !== undefined && byId.has(f.id)) return byId.get(f.id);
    const o = before.get(f.name);
    if (o !== undefined && f.id !== undefined && from.fields[o]!.id !== undefined && from.fields[o]!.id !== f.id) return undefined;
    return o;
  });
  const renamed = to.fields.flatMap((f, k) => {
    const o = matched[k];
    return o !== undefined && from.fields[o]!.name !== f.name ? [{ from: from.fields[o]!.name, to: f.name }] : [];
  });
  const kept = new Set(matched.filter((o) => o !== undefined));
  const pending = await fillOf(db, n);
  const wasHidden = await hiddenOf(db, n);
  // A field gone is hidden, its values kept. One that comes back is shown again: with its
  // values when it's restored, and emptied first when it's a new field of that name.
  const gone = from.fields.filter((_, i) => !kept.has(i)).map((f) => f.name);
  const back = wasHidden.filter((name) => after.has(name));
  const hidden = [...new Set([...wasHidden.filter((name) => !after.has(name)), ...gone])];
  const emptied = back.filter((name) => !(options.restore ?? []).includes(name));
  // A field that keeps its name and loses its formula holds nothing (its results were never
  // in the file): taken out of the JSON now, as edits to it from now on are its own.
  const unformulated = from.fields.filter((f, i) => f.computed && kept.has(i) && !to.fields[matched.indexOf(i)]!.computed).map((f) => f.name);
  if ([...unformulated, ...emptied, ...renamed.flatMap((r) => [r.from, r.to])].some((name) => /["\\]/.test(name))) return false;

  // Each field of `to`: where it was, and whether its values are worked out again.
  // A new field is: its values are whatever the rows hold under its name, as a build reads them.
  const moves = to.fields.map((f, k) => {
    const o = matched[k];
    if (o === undefined) return { k, o: null as number | null, refill: true };
    const old = from.fields[o]!;
    const retyped = was.kinds[o] !== now.kinds[k];
    const reformulated = JSON.stringify(old.computed ?? null) !== JSON.stringify(f.computed ?? null);
    return { k, o, refill: retyped || reformulated };
  });
  // The search text holds the searched fields' values in order.
  // A field renamed is searched as it was: its new name stands for its old.
  const renamedTo = new Map(renamed.map((r) => [r.from, r.to]));
  const searchChanged =
    JSON.stringify(searchedNames(from).map((f) => renamedTo.get(f) ?? f)) !== JSON.stringify(searchedNames(to)) || moves.some((m) => m.refill && searched(to.fields[m.k]!));

  forgetIndexes(db, n);
  await db.exec("begin");
  try {
    // Sort indexes are named by field place: dropped, and made again as they're asked for.
    for (const ix of await db.all("select name from sqlite_master where type = 'index' and tbl_name = ? and name like ?", [`r${n}`, `r${n}\_o%`])) {
      if (String(ix.name).startsWith(`r${n}_o`)) await db.exec(`drop index if exists ${ix.name as string}`);
    }
    for (const name of [...unformulated, ...emptied]) await db.run(`update r${n} set j = json_remove(j, ?) where json_type(j, ?) is not null`, [`$."${name}"`, `$."${name}"`]);
    // A field renamed (D63): its key in every row's JSON, its cells' lines and what reads it in them,
    // and the hidden names. Through a name nothing has, so two fields that swap names don't meet.
    if (renamed.length > 0) {
      const step = `${Date.now().toString(36)}${(parked++).toString(36)}`;
      const passes = [renamed.map((r, i) => ({ from: r.from, to: `__renaming_${step}_${i}` })), renamed.map((r, i) => ({ from: `__renaming_${step}_${i}`, to: r.to }))];
      const cells = await db.all("select seq, line from _cells where n = ?", [n]).catch(() => [] as Record<string, unknown>[]);
      let lines = cells.map((c) => ({ seq: c.seq as number, cell: JSON.parse(c.line as string) as CellFormula }));
      for (const pass of passes) {
        for (const r of pass) {
          await db.run(`update r${n} set j = json_set(json_remove(j, ?), ?, json(j -> ?)) where json_type(j, ?) is not null`, [`$."${r.from}"`, `$."${r.to}"`, `$."${r.from}"`, `$."${r.from}"`]);
          lines = lines.map((l) => ({ seq: l.seq, cell: cellRenamed(l.cell, to, name, r.from, r.to) }));
        }
      }
      for (const l of lines) await db.run("update _cells set field = ?, line = ? where n = ? and seq = ?", [l.cell.field, cellLine(l.cell), n, l.seq]);
    }
    // Every column out of the way first, so no new name meets an old one.
    for (const col of was.columns) await db.exec(`alter table r${n} rename column ${col} to q_${col}`);
    const kept = new Set<string>();
    for (const { k, o } of moves) {
      for (const [mine, theirs] of [
        [now.c[k], o === null ? null : was.c[o]],
        [now.f[k], o === null ? null : was.f[o]],
        [now.i[k], o === null ? null : was.i[o]],
      ] as [string | null | undefined, string | null | undefined][]) {
        if (!mine) continue;
        if (theirs) {
          await db.exec(`alter table r${n} rename column q_${theirs} to ${mine}`);
          kept.add(theirs);
        } else {
          await db.exec(`alter table r${n} add column ${mine}`);
        }
      }
    }
    // What no field holds any more is parked, under a name nothing will ask for.
    const mark = `${Date.now().toString(36)}${(parked++).toString(36)}`;
    for (const col of was.columns) if (!kept.has(col)) await db.exec(`alter table r${n} rename column q_${col} to z${mark}_${col}`);

    // Which fields hold values their type doesn't: kept for those that kept their values;
    // promised by none being filled (counted as they are).
    const oldBad = new Map(
      (await db.all("select fld, bad from _bad where n = ?", [n])).map((r) => [r.fld as number, r.bad as number] as const),
    );
    await db.run("delete from _bad where n = ?", [n]);
    const refill = new Set(moves.filter((m) => m.refill).map((m) => m.k));
    // A fill under way carries on, its fields at their new places.
    if (pending) for (const m of moves) if (m.o !== null && pending.fields.includes(m.o)) refill.add(m.k);
    for (const { k, o } of moves) {
      const bad = refill.has(k) ? NEVER : (oldBad.get(o!) ?? 0);
      if (bad !== 0) await db.run("insert into _bad(n, fld, bad) values(?, ?, ?)", [n, k, bad]);
    }

    const search = searchChanged || (pending?.search ?? false);
    await setHidden(db, n, hidden);
    if (refill.size > 0 || search) {
      await setFill(db, n, { upto: -1, fields: [...refill].sort((a, b) => a - b), search, bad: {} });
      // Until the search text is made again, a search reads every row's text, and the search's own index is made after.
      if (search) {
        await searchUpTo(db, n);
        await db.run("insert or replace into _fts(n, upto) values(?, -1)", [n]);
        await db.exec(`insert into x${n}(x${n}) values('delete-all')`);
      }
    } else {
      await setFill(db, n, null);
    }
    await db.run("update _tables set sig = ? where n = ?", [signature(to), n]);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
  return true;
}

/** Whether table `name`'s index has fields still being worked out after a change of fields. */
export async function indexFilling(db: SqlDriver, name: string): Promise<boolean> {
  const n = await tableNumber(db, name, false);
  return n !== null && (await fillOf(db, n)) !== null;
}

/**
 * Work out the next piece of what a change of fields left (alterIndex):
 * a batch of rows, in file order, in one short transaction, so whatever
 * else is asked is answered between calls. Resolves true while there is
 * more. `schema` is the table's schema now.
 */
export async function fillIndex(db: SqlDriver, name: string, schema: TableSchema, batchSize = BATCH): Promise<boolean> {
  const n = await tableNumber(db, name, false);
  if (n === null) return false;
  const fill = await fillOf(db, n);
  if (!fill) return false;
  const plan = planOf(schema);
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(schema)) return false;
  const found = await db.all(`select pos, j, s from r${n} where pos > ? order by pos limit ?`, [fill.upto, batchSize]);
  await db.exec("begin");
  try {
    if (found.length === 0) {
      // Done: each filled field is promised again when what it holds fits its type.
      for (const k of fill.fields) {
        const counted = fill.bad[k] ?? 0;
        // Edits made meanwhile shifted the count from where the change left it.
        const now = ((await db.all("select bad from _bad where n = ? and fld = ?", [n, k]))[0]?.bad as number | undefined) ?? NEVER;
        const bad = Math.max(0, counted + now - NEVER);
        await db.run("delete from _bad where n = ? and fld = ?", [n, k]);
        if (bad > 0) await db.run("insert into _bad(n, fld, bad) values(?, ?, ?)", [n, k, bad]);
      }
      await setFill(db, n, null);
      await db.exec("commit");
      return false;
    }
    const computes = fill.fields.some((k) => schema.fields[k]?.computed);
    const hidden = await hiddenOf(db, n);
    const raw = found.map((r) => JSON.parse(r.j as string) as Row);
    // Worked out as a build would: without the fields hidden.
    const stored = withoutHidden(hidden, raw);
    // With the batch's cells' own formulas (D52), whose results stay out of the rows' JSON.
    const own = withOwnCells(schema, stored, await cellLinesOf(db, n, stored.map((r) => String(r.id))), computes);
    const rows = own.shown;
    // Each row's JSON is written again when its formulas' results change it, keeping its hidden values.
    const rewrite = computes;
    const cols: { col: string; at: number }[] = [];
    for (const k of fill.fields) {
      // The value's place in what `encode` gives: the fields' columns in order.
      let at = 0;
      for (let m = 0; m < k; m++) at += 1 + (plan.f[m] ? 1 : 0) + (plan.i[m] ? 1 : 0);
      cols.push({ col: plan.c[k]!, at });
      if (plan.f[k]) cols.push({ col: plan.f[k]!, at: at + 1 });
      if (plan.i[k]) cols.push({ col: plan.i[k]!, at: at + 1 + (plan.f[k] ? 1 : 0) });
    }
    // What each row is set to, after its place: the JSON, the search text, then the columns.
    const sets = [...(rewrite ? ["j"] : []), ...(fill.search ? ["s"] : []), ...cols.map((c) => c.col)];
    const lists = rows.map((row, x) => {
      const body = bodyOf(found[x]!.s as string);
      const e = encode(plan, row, body === "" ? undefined : body);
      for (const k of e.bad) if (fill.fields.includes(k)) fill.bad[k] = (fill.bad[k] ?? 0) + 1;
      const values: SqlValue[] = [found[x]!.pos as number];
      if (rewrite) values.push(JSON.stringify({ ...own.kept[x]!, ...hiddenValues(hidden, raw[x]!) }));
      if (fill.search) values.push(e.search);
      for (const { at } of cols) values.push(e.values[at] ?? null);
      return values;
    });
    if (sets.length > 0 && db.inProcess && db.batch) {
      // A statement a row, prepared once: the fastest where nothing crosses.
      await db.batch(`update r${n} set ${sets.map((col) => `${col} = ?`).join(", ")} where pos = ?`, lists.map(([pos, ...set]) => [...set, pos!]));
    } else if (sets.length > 0) {
      // The whole batch in one statement, its rows as one JSON array: a driver whose every
      // statement crosses to native code (the Mac's and the phone's) crosses once a batch, not once a row.
      const value = (i: number) => `json_extract(u.value, '$[${i}]')`;
      await db.run(
        `update r${n} set ${sets.map((col, i) => `${col} = ${value(i + 1)}`).join(", ")} from json_each(?) as u where r${n}.pos = ${value(0)}`,
        [JSON.stringify(lists)],
      );
    }
    await setFill(db, n, { ...fill, upto: found[found.length - 1]!.pos as number });
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
  return true;
}

/** The content key the index was built from, or null when there is no index of this name. */
export async function indexKey(db: SqlDriver, name: string): Promise<string | null> {
  const n = await tableNumber(db, name, false);
  if (n === null) return null;
  const found = await db.all("select key, format from _tables where n = ?", [n]);
  const row = found[0];
  return row && row.format === INDEX_FORMAT ? (row.key as string | null) : null;
}

/** Whether the index is missing or was built from other content than `key`, so readers compute in memory (or rebuild). */
export async function isIndexStale(db: SqlDriver, name: string, key: string): Promise<boolean> {
  return (await indexKey(db, name)) !== key;
}

/** Remove a table's index. Always safe: readers fall back to memory. */
export async function dropIndex(db: SqlDriver, name: string): Promise<void> {
  const n = await tableNumber(db, name, false);
  if (n === null) return;
  forgetIndexes(db, n);
  await dropTables(db, n);
  await db.run("delete from _tables where n = ?", [n]);
}

// -- Edits in place -------------------------------------------------------

/**
 * Add or replace rows in place: an edit costs a statement, not a rebuild.
 * New rows go at the end of the file order. Not for schemas with formulas
 * that read other rows (a change in one row changes others): rebuild.
 * `bodies` sets the page of a row (an empty string removes it); a row
 * given without an entry keeps its page. `at` gives a new row its place
 * in the file order (a row removed, put back where removeRows found it);
 * a place another row has since taken is not used, and it goes at the end.
 */
export async function putRows(
  db: SqlDriver,
  options: {
    name: string;
    schema: TableSchema;
    rows: Row[];
    bodies?: Record<string, string>;
    at?: Record<string, number>;
    key: string;
    /** Cells' own formulas to add with the rows: a row put back with its (D52). */
    cells?: CellFormula[];
  },
): Promise<void> {
  const { name, schema, rows, bodies, at, key } = options;
  const plan = planOf(schema);
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) throw new Error(`no index for ${name}`);
  if (plan.never.size > 0) throw new Error("formulas that read other rows can't be edited in place: rebuild the index");
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(schema)) throw new Error("the schema changed: rebuild the index");
  const computed = schema.fields.some((f) => f.computed);
  const cols = plan.columns;
  // A search index still being made holds only the rows up to here; the rest reach it as it gets to them.
  const upto = await searchUpTo(db, n);
  const searched = (pos: number) => upto === null || pos <= upto;
  const counted = countedAt(await fillOf(db, n));
  // A row written again keeps its hidden fields' values: an undo of their removal finds them.
  const hidden = await hiddenOf(db, n);
  // Cells' own formulas (D52): worked out with their row, their results kept out of its JSON.
  if (options.cells && options.cells.length > 0) {
    await cellsTable(db);
    let seq = Number((await db.all("select coalesce(max(seq), 0) as m from _cells where n = ?", [n]))[0]!.m);
    for (const c of options.cells) await db.run("insert into _cells(n, seq, id, field, line) values(?, ?, ?, ?, ?)", [n, ++seq, c.id, c.field, cellLine(c)]);
  }
  const cells = await cellLinesOf(db, n, rows.map((r) => String(r.id)));
  await db.exec("begin");
  try {
    for (const raw of rows) {
      const own = withOwnCells(schema, [raw], cells.length > 0 ? cells.filter((c) => c.id === raw.id) : [], computed);
      const row = own.shown[0]!;
      const keep = own.kept[0]!;
      const old = (await db.all(`select pos, j, s from r${n} where id = ?`, [String(row.id)]))[0];
      const priorBody = old ? bodyOf(old.s as string) : "";
      const body = bodies && row.id in bodies ? bodies[row.id]!.toLowerCase() : priorBody;
      const e = encode(plan, row, body === "" ? undefined : body);
      if (old) {
        const was = encode(plan, JSON.parse(old.j as string) as Row, undefined);
        await shiftBad(db, n, counted(was.bad, old.pos as number), -1);
        if (searched(old.pos as number)) await db.run(`insert into x${n}(x${n}, rowid, s) values('delete', ?, ?)`, [old.pos as number, old.s as string]);
        await db.run(
          `update r${n} set j = ?, s = ?, ${cols.map((c) => `${c} = ?`).join(", ")} where pos = ?`,
          [JSON.stringify({ ...keep, ...hiddenValues(hidden, JSON.parse(old.j as string) as Row) }), e.search, ...e.values, old.pos as number],
        );
        if (searched(old.pos as number)) await db.run(`insert into x${n}(rowid, s) values(?, ?)`, [old.pos as number, e.search]);
      } else {
        const wanted = at?.[row.id];
        const free = wanted !== undefined && (await db.all(`select 1 from r${n} where pos = ?`, [wanted])).length === 0;
        await db.run(
          `insert into r${n}(pos, id, j, s, ${cols.join(", ")}) values(?, ?, ?, ?, ${cols.map(() => "?").join(", ")})`,
          [free ? wanted : null, String(row.id), JSON.stringify(keep), e.search, ...e.values],
        );
        const pos = (await db.all(`select pos from r${n} where id = ?`, [String(row.id)]))[0]!.pos as number;
        if (searched(pos)) await db.run(`insert into x${n}(rowid, s) values(?, ?)`, [pos, e.search]);
        await shiftBad(db, n, counted(e.bad, pos), 1);
        continue;
      }
      await shiftBad(db, n, counted(e.bad, old.pos as number), 1);
    }
    await db.run("update _tables set key = ?, built_at = ? where n = ?", [key, new Date().toISOString(), n]);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

/** The page's part of a row's search text (the last piece). */
function bodyOf(search: string): string {
  return search.slice(search.lastIndexOf(SEP) + 1);
}

/** Remove rows by id, and their pages. Gives back each row removed and its place in the file order, which putRows' `at` puts it back at. */
export async function removeRows(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; ids: string[]; key: string },
): Promise<{ row: Row; at: number; cells?: CellFormula[] }[]> {
  const { name, schema, ids, key } = options;
  const plan = planOf(schema);
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) throw new Error(`no index for ${name}`);
  const upto = await searchUpTo(db, n);
  const fill = await fillOf(db, n);
  const counted = countedAt(fill);
  const removed: { row: Row; at: number; cells?: CellFormula[] }[] = [];
  // Their cells' own formulas go with them, and come back with them (D52).
  const cells = await cellLinesOf(db, n, ids);
  await db.exec("begin");
  try {
    for (const id of ids) {
      const old = (await db.all(`select pos, j, s from r${n} where id = ?`, [id]))[0];
      if (!old) continue;
      // Whole, hidden fields and all: put back (undo), it is as it was.
      const mine = cells.filter((c) => c.id === id);
      removed.push({ row: JSON.parse(old.j as string) as Row, at: num(old.pos), ...(mine.length > 0 ? { cells: mine } : {}) });
      if (mine.length > 0) await db.run("delete from _cells where n = ? and id = ?", [n, id]);
      await shiftBad(db, n, counted(encode(plan, JSON.parse(old.j as string) as Row, undefined).bad, old.pos as number), -1);
      if (upto === null || (old.pos as number) <= upto) await db.run(`insert into x${n}(x${n}, rowid, s) values('delete', ?, ?)`, [old.pos as number, old.s as string]);
      await db.run(`delete from r${n} where pos = ?`, [old.pos as number]);
    }
    await db.run("update _tables set key = ?, built_at = ? where n = ?", [key, new Date().toISOString(), n]);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
  return removed;
}

/**
 * Of the fields a row at `pos` holds wrongly, those its count goes by: while
 * a fill is under way (fillIndex), its fields are counted as it reaches
 * each row, so a row it hasn't reached yet isn't counted for them here.
 */
const countedAt = (fill: Fill | null) => (fields: number[], pos: number) =>
  fill === null || pos <= fill.upto ? fields : fields.filter((k) => !fill.fields.includes(k));

async function shiftBad(db: SqlDriver, n: number, fields: number[], by: 1 | -1): Promise<void> {
  for (const fld of fields) {
    await db.run("insert or ignore into _bad(n, fld, bad) values(?, ?, 0)", [n, fld]);
    await db.run("update _bad set bad = max(bad + ?, 0) where n = ? and fld = ?", [by, n, fld]);
  }
}

// -- Queries --------------------------------------------------------------

type Compiled = { sql: string; params: SqlValue[] } | null;
const FALSE: Compiled = { sql: "0", params: [] };
const TRUE: Compiled = { sql: "1", params: [] };

/** Text with a unit from U+D800 up: UTF-16 order isn't code point order there, so a comparison against it isn't SQLite's. */
const WIDE = /[\uD800-￿]/;

/** A cell holds nothing: absent, null or "". */
const blank = (col: string) => `(${col} is null or ${col} = '')`;

/** An array column's cell as JSON, "" (the one other thing it can hold) as an empty list. */
const items = (col: string) => `json_each(case when ${col} = '' then '[]' else ${col} end)`;

/** A filter as SQL over the column `col`, exactly as matchesFilter answers it, or null when it can't promise that. */
function filterSql(kind: Kind, col: string, f: ViewFilter, instantCol?: string): Compiled {
  const value = f.value;
  if (kind === "opaque" && f.operator !== "empty" && f.operator !== "not_empty") return null;
  const text = kind === "text" || kind === "datetime";
  const same =
    kind === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : kind === "boolean"
        ? typeof value === "boolean"
        : text
          ? typeof value === "string"
          : false;
  const bind = (v: unknown): SqlValue => (typeof v === "boolean" ? (v ? 1 : 0) : (v as SqlValue));
  switch (f.operator) {
    case "eq":
    case "neq": {
      // An absent value and null are both NULL in the index, and are strictly different to a filter.
      if (value === undefined || value === null) return null;
      const eq = f.operator === "eq";
      // Nothing of another type, or an object, is ever strictly equal.
      if (value !== "" && !same) return eq ? FALSE : TRUE;
      return eq ? { sql: `${col} = ?`, params: [bind(value)] } : { sql: `(${col} is null or ${col} <> ?)`, params: [bind(value)] };
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Empty cells match none of these (SPEC "Empty values"). Anything but one kind of value on both sides is JS coercion.
      if (!same || kind === "boolean") return null;
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.operator];
      // A datetime against a datetime: the instants, as applyFilters compares them.
      if (kind === "datetime" && instantCol && typeof value === "string" && !Number.isNaN(instantOf(value))) {
        return { sql: `(${instantCol} is not null and ${instantCol} ${op} ?)`, params: [instantOf(value)] };
      }
      if (typeof value === "string" && WIDE.test(value)) return null;
      return { sql: `(${col} is not null and ${col} <> '' and ${col} ${op} ?)`, params: [value as SqlValue] };
    }
    case "contains":
    case "not_contains": {
      const has = f.operator === "contains";
      if (kind === "array") {
        if (typeof value !== "string" && typeof value !== "number") return null;
        const found = `exists(select 1 from ${items(col)} where value = ?)`;
        // A "" cell isn't a list but a string, which has the item "" and no other.
        if (value === "") {
          return has
            ? { sql: `(${col} = '' or (${col} is not null and ${found}))`, params: [value] }
            : { sql: `(${col} is not null and ${col} <> '' and not ${found})`, params: [value] };
        }
        return has
          ? { sql: `(${col} is not null and ${col} <> '' and ${found})`, params: [value] }
          : { sql: `(${col} is not null and not ${found})`, params: [value] };
      }
      const needle = String(value);
      // Only text is searched: a number or boolean cell holds no string, and "" is the one string it can hold.
      if (needle === "") return has ? { sql: `typeof(${col}) = 'text'`, params: [] } : FALSE;
      return { sql: `(typeof(${col}) = 'text' and instr(${col}, ?) ${has ? ">" : "="} 0)`, params: [needle] };
    }
    case "starts_with":
    case "ends_with": {
      const needle = String(value);
      if (needle === "") return { sql: `(typeof(${col}) = 'text' and ${kind === "array" ? `${col} = ''` : "1"})`, params: [] };
      if (kind === "array") return FALSE;
      return f.operator === "starts_with"
        ? { sql: `(typeof(${col}) = 'text' and instr(${col}, ?) = 1)`, params: [needle] }
        : { sql: `(typeof(${col}) = 'text' and substr(${col}, -length(?)) = ?)`, params: [needle, needle] };
    }
    case "empty":
      return { sql: blank(col), params: [] };
    case "not_empty":
      return { sql: `(${col} is not null and ${col} <> '')`, params: [] };
    case "in":
    case "not_in": {
      if (!Array.isArray(value)) return FALSE;
      if (value.some((x) => x === undefined || x === null)) return null;
      const within = f.operator === "in";
      // A listed item of another type is never strictly equal to a cell: it can be left out.
      const fits = (x: unknown) =>
        x === "" ||
        (kind === "number" ? typeof x === "number" : kind === "boolean" ? typeof x === "boolean" : typeof x === "string" || (kind === "array" && typeof x === "number"));
      const list = JSON.stringify(value.filter(fits).map(bind));
      if (kind === "array") {
        const some = `exists(select 1 from ${items(col)} where value in (select value from json_each(?)))`;
        const blankListed = value.includes("");
        const cell = `(${col} = '' and ${blankListed ? "1" : "0"})`;
        return within
          ? { sql: `(${col} is not null and (${cell} or (${col} <> '' and ${some})))`, params: [list] }
          : { sql: `(${col} is null or not (${cell} or (${col} <> '' and ${some})))`, params: [list] };
      }
      return within
        ? { sql: `${col} in (select value from json_each(?))`, params: [list] }
        : { sql: `(${col} is null or ${col} not in (select value from json_each(?)))`, params: [list] };
    }
  }
}

/** `value` added `count` times, as numbers whose sum is exactly that: the product and what rounding it lost. */
function* times(value: number, count: number): Iterable<number> {
  const product = value * count;
  // Dekker's product: each factor split in two halves whose products are exact.
  const split = (a: number): [number, number] => {
    const c = 134217729 * a;
    const high = c - (c - a);
    return [high, a - high];
  };
  const [vh, vl] = split(value);
  const [ch, cl] = split(count);
  const lost = vl * cl - (product - vh * ch - vl * ch - vh * cl);
  if (Number.isFinite(lost) && Number.isFinite(product)) {
    yield product;
    yield lost;
  } else {
    // Too large to split: one at a time.
    for (let i = 0; i < count; i++) yield value;
  }
}

/** A number as the driver hands it back: some give a whole number too large for a double's exact range as a bigint. */
const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : (v as number));

const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * ORDER BY terms for one sort, as sorter() compares: empties last whichever
 * way, then enum order, instant, lower case, and as written. The terms are
 * the same text every time (the enum is written in, not bound) so an index
 * on them serves the sort.
 */
function sortTerms(plan: Plan, field: Field, n: number, direction: "asc" | "desc", q: string): string[] | null {
  const kind = plan.kinds[n]!;
  const dir = direction === "desc" ? "desc" : "asc";
  const c = `${q}${plan.c[n]}`;
  // Empties tie with each other, so the terms after the first see them all as NULL.
  const plain = `nullif(${c}, '')`;
  const terms: string[] = [`${blank(c)} asc`];
  if (kind === "number" || kind === "boolean") terms.push(`${plain} ${dir}`);
  else if (kind === "text" || kind === "datetime") {
    const declared = enumValues(field);
    if (declared.some((v) => v.includes("\0"))) return null;
    if (declared.length > 0) {
      terms.push(`case ${c} ${declared.map((v, i) => `when ${literal(v)} then ${i}`).join(" ")} else ${declared.length} end ${dir}`);
    }
    if (kind === "datetime") terms.push(`${q}${plan.i[n]} ${dir}`);
    terms.push(`nullif(${q}${plan.f[n]}, '') ${dir}`, `${plain} ${dir}`);
  } else return null;
  return terms;
}

const made = new WeakMap<object, Set<string>>();

/** An index on a sort's terms, made the first time that sort is asked for: a million rows aren't sorted again for every page. */
async function sortIndex(db: SqlDriver, n: number, terms: string[], name: string): Promise<void> {
  let have = made.get(db);
  if (!have) made.set(db, (have = new Set()));
  const id = `r${n}_${name}`;
  if (have.has(id)) return;
  await db.exec(`create index if not exists ${id} on r${n}(${terms.join(", ")});`);
  have.add(id);
}

function forgetIndexes(db: SqlDriver, n: number) {
  const have = made.get(db);
  if (have) for (const id of [...have]) if (id.startsWith(`r${n}_`)) have.delete(id);
}

async function badFields(db: SqlDriver, n: number): Promise<Set<number>> {
  await db.exec("create table if not exists _bad(n integer, fld integer, bad integer, primary key(n, fld))");
  const found = await db.all("select fld from _bad where n = ? and bad > 0", [n]);
  return new Set(found.map((r) => r.fld as number));
}

/**
 * Run a view's query against the index. Returns null when it can't promise
 * the rows applyView and searchRows would give (no index, a stale schema, a
 * field holding values its type doesn't, a formula over other rows, a sort
 * order only a viewer's own language gives): compute the view in memory.
 */
export async function queryIndex(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; query?: IndexQuery; version?: string },
): Promise<IndexedRows | null> {
  const { name, schema } = options;
  const query = options.query ?? {};
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) return null;
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(schema)) return null;
  const plan = planOf(schema);
  const bad = await badFields(db, n);
  const pendingFill = await fillOf(db, n);
  const hidden = await hiddenOf(db, n);
  const filling = pendingFill !== null && plan.never.size === 0 && pendingFill.fields.some((k) => schema.fields[k]?.computed);
  let cellsKnown: Promise<boolean> | undefined;
  const cellsHere = () => (cellsKnown ??= hasCells(db, n));
  const index = new Map(schema.fields.map((f, i) => [f.name, i]));
  const usable = (fieldName: string): number | null => {
    const i = index.get(fieldName);
    return i === undefined || bad.has(i) ? null : i;
  };

  const where: string[] = [];
  const whereParams: SqlValue[] = [];
  for (const f of query.filter ?? []) {
    const i = usable(f.field);
    if (i === null) return null;
    const compiled = filterSql(plan.kinds[i]!, `r.${plan.c[i]}`, f, plan.i[i] ? `r.${plan.i[i]}` : undefined);
    if (!compiled) return null;
    where.push(compiled.sql);
    whereParams.push(...compiled.params);
  }

  // Rows hidden by hand (D58).
  if (query.hidden && query.hidden.length > 0) {
    where.push(`r.id not in (${query.hidden.map(() => "?").join(", ")})`);
    whereParams.push(...query.hidden);
  }

  const needle = (query.search ?? "").trim().toLowerCase();
  let narrowed = false;
  if (needle.length > 0) {
    if (needle.includes(SEP) || needle.includes("\u0002")) return null;
    // The search text is being made again after a change of fields (alterIndex).
    if (pendingFill?.search) return null;
    // The trigram index finds candidates (it folds a little more than lower case does); instr is the exact test.
    // (While a search index is still being made, every row's text is read instead.)
    narrowed = [...needle].length >= 3 && (await searchUpTo(db, n)) === null;
    if (narrowed) {
      where.push(`r.pos in (select rowid from x${n} where x${n} match ?)`);
      whereParams.push(`"${needle.replace(/"/g, '""')}"`);
    }
    where.push("instr(r.s, ?) > 0");
    whereParams.push(needle);
  }

  let join = "";
  let firstSort: { terms: string[]; name: string } | null = null;
  const joinParams: SqlValue[] = [];
  const orderTerms: string[] = [];
  if (query.order && query.order.length > 0) {
    // Rows named come first, in the order of their last mention.
    const last = new Map(query.order.map((id, i) => [id, i]));
    const ids = [...last.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (ids.length > MAX_ORDER) return null;
    join = "left join json_each(?) o on o.value = r.id";
    joinParams.push(JSON.stringify(ids));
    orderTerms.push("(o.key is null) asc", "o.key asc");
  } else {
    const sorts = query.sort ?? [];
    for (const [at, s] of sorts.entries()) {
      const i = usable(s.field);
      if (i === null) return null;
      const terms = sortTerms(plan, schema.fields[i]!, i, s.direction, "r.");
      if (!terms) return null;
      if (at === 0) {
        firstSort = { terms: sortTerms(plan, schema.fields[i]!, i, s.direction, "")!, name: `o${i}${s.direction === "desc" ? "d" : "a"}` };
        await sortIndex(db, n, firstSort.terms, firstSort.name);
      }
      orderTerms.push(...terms);
    }
  }
  orderTerms.push("r.pos asc");

  // A grouped view: only fields whose cells have one string each, as applyGroup names a group.
  let groupAt: number | null = null;
  if (query.group !== undefined) {
    groupAt = usable(query.group);
    if (groupAt === null) return null;
    const kind = plan.kinds[groupAt]!;
    if (kind === "array" || kind === "opaque") return null;
  }
  // Totals the index can promise: counts of anything, and sums of a number field.
  for (const [fieldName, kind] of Object.entries(query.totals ?? {})) {
    const i = index.get(fieldName);
    if (i === undefined) continue;
    if (bad.has(i)) return null;
    if (kind !== "count" && kind !== "count_empty" && plan.kinds[i] === "opaque") return null;
  }

  const order = orderTerms.join(", ");
  const and = (extra: string | null) => {
    const all = extra ? [...where, extra] : where;
    return all.length > 0 ? `where ${all.join(" and ")}` : "";
  };
  const clause = and(null);
  const total = await db.all(`select count(*) as n from r${n} r ${clause}`, whereParams);
  const count = total[0]!.n as number;
  let inView = count;
  if (needle.length > 0) {
    // The search's two terms are the last in `where`, and its parameters the last bound.
    const searchTerms = narrowed ? 2 : 1;
    const before = where.slice(0, where.length - searchTerms);
    const found = await db.all(
      `select count(*) as n from r${n} r ${before.length > 0 ? `where ${before.join(" and ")}` : ""}`,
      whereParams.slice(0, whereParams.length - searchTerms),
    );
    inView = found[0]!.n as number;
  }

  /** A window of the rows matching `extra` as well, in the view's order. */
  const page = async (column: string, extra: string | null, extraParams: SqlValue[], limit: number, offset: number) => {
    // Every row, in file order: skipping to a window deep in a large table
    // would pass over every row before it, whole. Its first row is found in
    // an index of positions alone, and the window read from there.
    if (offset >= DEEP && limit >= 0 && where.length === 0 && extra === null && join === "" && orderTerms.length === 1) {
      await sortIndex(db, n, ["pos"], "p");
      const first = await db.all(`select pos from r${n} indexed by r${n}_p order by pos limit 1 offset ?`, [offset]);
      if (!first[0]) return [];
      return db.all(`select ${column} as v from r${n} r where r.pos >= ? order by r.pos limit ?`, [first[0].pos as number, limit]);
    }
    return db.all(`select ${column} as v from r${n} r ${join} ${and(extra)} order by ${order} limit ? offset ?`, [
      ...joinParams,
      ...whereParams,
      ...extraParams,
      limit,
      offset,
    ]);
  };
  /** A row's number, from 1, among the rows matching `extra` as well; null when it isn't one of them. */
  const rankOf = async (id: string, extra: string | null, extraParams: SqlValue[]): Promise<number | null> => {
    if (orderTerms.length === 1) {
      // File order: the rows before it are the ones stored before it.
      const at = await db.all(`select r.pos as pos from r${n} r ${and(extra ? `${extra} and r.id = ?` : "r.id = ?")}`, [...whereParams, ...extraParams, id]);
      if (!at[0]) return null;
      const before = await db.all(`select count(*) as n from r${n} r ${and(extra ? `${extra} and r.pos < ?` : "r.pos < ?")}`, [...whereParams, ...extraParams, at[0].pos as number]);
      return (before[0]!.n as number) + 1;
    }
    const found = await db.all(
      `select rn from (select r.id as id, row_number() over (order by ${order}) as rn from r${n} r ${join} ${and(extra)}) where id = ?`,
      [...joinParams, ...whereParams, ...extraParams, id],
    );
    return found[0] ? (found[0].rn as number) : null;
  };

  // Groups, as applyGroup makes them: a cell's value as a string names its
  // group, declared choices come first in their order, then the rest as
  // they first appear, and blank cells last.
  interface Bucket extends RowGroup {
    blank: boolean;
    raws: SqlValue[];
    first: number;
  }
  let buckets: Promise<Bucket[]> | null = null;
  // A cell's group: its value, with every blank cell as NULL.
  const groupColumn = groupAt === null ? "" : `nullif(r.${plan.c[groupAt]}, '')`;
  const keyOf = (raw: SqlValue): string =>
    raw === null || raw === "" ? "(empty)" : plan.kinds[groupAt!] === "boolean" ? (raw ? "true" : "false") : String(raw);
  const inBucket = (b: Bucket): { sql: string; params: SqlValue[] } => {
    const parts: string[] = [];
    if (b.blank) parts.push(`${groupColumn} is null`);
    for (const _ of b.raws) parts.push(`${groupColumn} = ?`);
    return { sql: parts.length === 1 ? parts[0]! : `(${parts.join(" or ")})`, params: b.raws };
  };
  /** Past this many groups to put in order of first appearance, one pass over the rows is cheaper than asking for each. */
  const MAX_FIRSTS = 200;
  const loadBuckets = (): Promise<Bucket[]> => {
    if (groupAt === null) return Promise.resolve([]);
    return (buckets ??= (async () => {
      // An index on the group and then the view's first sort: a group's
      // count, and any page of it, is read straight off it.
      const bare = `nullif(${plan.c[groupAt!]}, '')`;
      await sortIndex(db, n, [bare, ...(firstSort?.terms ?? []), "pos"], `g${groupAt}${firstSort?.name ?? ""}`);
      const found = await db.all(`select ${groupColumn} as g, count(*) as n from r${n} r ${clause} group by 1`, whereParams);
      const byKey = new Map<string, Bucket>();
      for (const row of found) {
        const raw = (typeof row.g === "bigint" ? Number(row.g) : row.g) as SqlValue;
        const key = keyOf(raw);
        let bucket = byKey.get(key);
        if (!bucket) byKey.set(key, (bucket = { key, start: 0, count: 0, blank: false, raws: [], first: Infinity }));
        if (raw === null) bucket.blank = true;
        else bucket.raws.push(raw);
        bucket.count += row.n as number;
      }
      const declared = enumValues(schema.fields[groupAt!]);
      const rank = (b: Bucket) => (b.key === "(empty)" ? 3 : declared.includes(b.key) ? 1 : 2);
      // The rest come as they first appear in the view's order.
      const rest = [...byKey.values()].filter((b) => rank(b) === 2);
      if (rest.length > MAX_FIRSTS) {
        const firsts = await db.all(
          `select g, min(rn) as first from (select ${groupColumn} as g, row_number() over (order by ${order}) as rn from r${n} r ${join} ${clause}) group by g`,
          [...joinParams, ...whereParams],
        );
        for (const row of firsts) {
          const bucket = byKey.get(keyOf((typeof row.g === "bigint" ? Number(row.g) : row.g) as SqlValue))!;
          bucket.first = Math.min(bucket.first, row.first as number);
        }
      } else if (rest.length > 1) {
        const owner = new Map<string, Bucket>();
        for (const b of rest) {
          for (const raw of b.raws) {
            const first = await page("r.id", `${groupColumn} = ?`, [raw], 1, 0);
            if (first[0]) owner.set(first[0].v as string, b);
          }
        }
        const ids = [...owner.keys()];
        const inOrder = await db.all(
          `select r.id as id from r${n} r ${join} where r.id in (${ids.map(() => "?").join(", ")}) order by ${order}`,
          [...joinParams, ...ids],
        );
        inOrder.forEach((row, at) => {
          const bucket = owner.get(row.id as string)!;
          bucket.first = Math.min(bucket.first, at);
        });
      }
      const ordered = [...byKey.values()].sort((a, b) => {
        const by = rank(a) - rank(b);
        if (by !== 0) return by;
        return rank(a) === 1 ? declared.indexOf(a.key) - declared.indexOf(b.key) : a.first - b.first;
      });
      let start = 0;
      for (const b of ordered) {
        b.start = start;
        start += b.count;
      }
      return ordered;
    })());
  };

  const windowOf = async (column: string, start: number, end: number): Promise<SqlValue[]> => {
    const from = Math.max(0, start);
    if (end <= from) return [];
    if (groupAt === null) return (await page(column, null, [], end - from, from)).map((r) => r.v as SqlValue);
    const out: SqlValue[] = [];
    for (const b of await loadBuckets()) {
      const lo = Math.max(from, b.start);
      const hi = Math.min(end, b.start + b.count);
      if (hi <= lo) continue;
      const within = inBucket(b);
      for (const r of await page(column, within.sql, within.params, hi - lo, lo - b.start)) out.push(r.v as SqlValue);
    }
    return out;
  };

  let totals: Promise<Record<string, number | undefined>> | null = null;
  const loadTotals = async (): Promise<Record<string, number | undefined>> => {
    const out: Record<string, number | undefined> = {};
    for (const [fieldName, kind] of Object.entries(query.totals ?? {})) {
      const i = index.get(fieldName);
      const counting = kind === "count" || kind === "count_empty";
      if (i === undefined) {
        // No such field: every cell is blank.
        out[fieldName] = kind === "count" ? 0 : kind === "count_empty" ? count : undefined;
        continue;
      }
      const c = `r.${plan.c[i]}`;
      if (counting) {
        // A blank cell, as viewTotal has it: nothing, "" or an empty list.
        const held = plan.kinds[i] === "array" || plan.kinds[i] === "opaque" ? `(${c} is not null and ${c} <> '' and ${c} <> '[]')` : `(${c} is not null and ${c} <> '')`;
        if (where.length === 0) await sortIndex(db, n, [plan.c[i]!], `t${i}`);
        const found = await db.all(`select count(*) as n from r${n} r ${and(held)}`, whereParams);
        const have = found[0]!.n as number;
        out[fieldName] = kind === "count" ? have : count - have;
        continue;
      }
      if (plan.kinds[i] !== "number") {
        out[fieldName] = undefined;
        continue;
      }
      // The column's distinct numbers and how many rows hold each, read off
      // an index on the column alone: a total doesn't pass over the rows.
      // With a filter or a search the rows are passed over once, as the filter needs anyway.
      if (where.length === 0) await sortIndex(db, n, [plan.c[i]!], `t${i}`);
      const found = await db.all(
        `select ${c} as v, count(*) as k from r${n} r ${where.length === 0 ? "" : "not indexed"} ${and(`typeof(${c}) in ('integer', 'real')`)} group by ${c}`,
        whereParams,
      );
      let have = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of found) {
        const v = num(r.v);
        have += r.k as number;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (have === 0) out[fieldName] = undefined;
      else if (kind === "min") out[fieldName] = lo;
      else if (kind === "max") out[fieldName] = hi;
      else {
        const sum = exactSum(
          (function* () {
            for (const r of found) yield* times(num(r.v), r.k as number);
          })(),
        );
        out[fieldName] = kind === "sum" ? sum : sum / have;
      }
    }
    return out;
  };

  return {
    count,
    inView,
    version: options.version ?? `${(await indexKey(db, name)) ?? ""}|${JSON.stringify(query)}`,
    async rows(start, end) {
      const rows = (await windowOf("r.j", start, end)).map((j) => JSON.parse(j as string) as Row);
      // A formula still being filled in (alterIndex) is worked out for the rows asked, so they show it at once.
      const shown = withoutHidden(hidden, rows);
      const filled = filling ? computeRows(schema, shown).rows : shown;
      // Cells' own formulas (D52): their results aren't kept, and are worked out as their rows are read.
      return (await cellsHere()) ? withCellResults(db, n, schema, filled) : filled;
    },
    async ids(start, end) {
      return (await windowOf("r.id", start, end)) as string[];
    },
    async placeOf(id) {
      if (groupAt === null) {
        const rank = await rankOf(id, null, []);
        return rank === null ? -1 : rank - 1;
      }
      const cell = await db.all(`select ${groupColumn} as g from r${n} r ${and("r.id = ?")}`, [...whereParams, id]);
      if (!cell[0]) return -1;
      const bucket = (await loadBuckets()).find((b) => b.key === keyOf((typeof cell[0]!.g === "bigint" ? Number(cell[0]!.g) : cell[0]!.g) as SqlValue));
      if (!bucket) return -1;
      const within = inBucket(bucket);
      const rank = await rankOf(id, within.sql, within.params);
      return rank === null ? -1 : bucket.start + rank - 1;
    },
    async row(id) {
      const found = await db.all(`select r.j as j from r${n} r ${and("r.id = ?")}`, [...whereParams, id]);
      if (!found[0]) return undefined;
      const row = JSON.parse(found[0].j as string) as Row;
      const [shown] = withoutHidden(hidden, [row]);
      const filled = filling ? computeRows(schema, [shown!]).rows[0]! : shown!;
      return (await cellsHere()) ? (await withCellResults(db, n, schema, [filled]))[0] : filled;
    },
    totals: () => (totals ??= loadTotals()),
    groups: async () => (await loadBuckets()).map(({ key, start, count }) => ({ key, start, count })),
  };
}

/**
 * Rows of a table whose index is being built, in file order, from those in
 * so far: for showing a large table as it is read. Asked on the connection
 * that is building, it sees the rows the build has put in and not yet
 * committed. `start` and `end` are places among the rows in, which for a
 * build are their positions. Empty when there is no such table yet.
 */
export async function rowsBeingBuilt(db: SqlDriver, name: string, start: number, end: number): Promise<Row[]> {
  const from = Math.max(0, start);
  if (end <= from) return [];
  const n = await tableNumber(db, name, false);
  if (n === null) return [];
  try {
    const found = await db.all(`select j from r${n} where pos > ? order by pos limit ?`, [from, end - from]);
    return found.map((r) => JSON.parse(r.j as string) as Row);
  } catch {
    // Its table isn't made yet.
    return [];
  }
}

/** Say what the source is now, after a save: the index is fresh for that content. */
export async function setIndexKey(db: SqlDriver, name: string, key: string): Promise<void> {
  const n = await tableNumber(db, name, false);
  if (n === null) throw new Error(`no index for ${name}`);
  await db.run("update _tables set key = ? where n = ?", [key, n]);
}

/**
 * A table's rows out of its index as `rows.ndjson` text, in file order, a
 * piece at a time: saving a large table never holds all of it. Computed
 * fields are left out, as serializeRows leaves them.
 */
export async function* storedRows(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; batchSize?: number; /** Keys left out of every row: fields the table no longer has. */ omit?: string[] },
): AsyncIterable<string> {
  const n = await tableNumber(db, options.name, false);
  if (n === null) throw new Error(`no index for ${options.name}`);
  const size = options.batchSize ?? BATCH;
  // And the fields a fill has still to take out of rows' JSON.
  const computed = [...options.schema.fields.filter((f) => f.computed).map((f) => f.name), ...(options.omit ?? []), ...(await hiddenOf(db, n))];
  let after = -1;
  for (;;) {
    const found = await db.all(`select pos, j from r${n} where pos > ? order by pos limit ?`, [after, size]);
    if (found.length === 0) return;
    after = found[found.length - 1]!.pos as number;
    let text = "";
    for (const r of found) {
      if (computed.length === 0) text += `${r.j as string}\n`;
      else {
        const row = JSON.parse(r.j as string) as Row;
        for (const field of computed) delete row[field];
        text += `${JSON.stringify(row)}\n`;
      }
    }
    yield text;
  }
}

/**
 * The same rows as storedRows gives, a batch at a time, each with its place
 * in the file order: for a writer that puts each row back in the rows file
 * it came from (SPEC section 3, D51).
 */
export async function* storedRowLines(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; batchSize?: number; omit?: string[] },
): AsyncIterable<{ pos: number; line: string }[]> {
  const n = await tableNumber(db, options.name, false);
  if (n === null) throw new Error(`no index for ${options.name}`);
  const size = options.batchSize ?? BATCH;
  const leave = [...options.schema.fields.filter((f) => f.computed).map((f) => f.name), ...(options.omit ?? []), ...(await hiddenOf(db, n))];
  let after = -1;
  for (;;) {
    const found = await db.all(`select pos, j from r${n} where pos > ? order by pos limit ?`, [after, size]);
    if (found.length === 0) return;
    after = found[found.length - 1]!.pos as number;
    yield found.map((r) => {
      if (leave.length === 0) return { pos: r.pos as number, line: r.j as string };
      const row = JSON.parse(r.j as string) as Row;
      for (const field of leave) delete row[field];
      return { pos: r.pos as number, line: JSON.stringify(row) };
    });
  }
}

/** A parsed table's rows as the index holds them: handy for the apps' first build. */
export function indexSource(table: ParsedTable, name: string, key: string): BuildOptions {
  return { name, schema: table.schema, rows: table.rows, bodies: table.bodies, key };
}
