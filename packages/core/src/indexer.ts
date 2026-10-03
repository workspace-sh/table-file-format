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
import type { Field, ParsedTable, Row, TableSchema, ViewFilter, ViewSort } from "./types.js";
import { enumValues } from "./types.js";
import type { RowSource } from "./row-source.js";
import { computeRows, rowLocal } from "./workbook.js";

export type SqlValue = string | number | null;

/** What the index needs of a SQLite binding. */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all(sql: string, params?: SqlValue[]): Promise<Record<string, SqlValue>[]>;
  /** Runs one statement for many parameter lists, if the binding can do that faster than `run` in a loop. */
  batch?(sql: string, params: SqlValue[][]): Promise<void>;
}

/** Structured query: the view's filter and sort, a manual order, and free text (SPEC section 8). Never raw SQL. */
export interface IndexQuery {
  filter?: ViewFilter[];
  sort?: ViewSort[];
  /** A view's manual order: the rows named come first in this order, the rest follow in file order, and `sort` is ignored (as applyView does). */
  order?: string[];
  /** Case-insensitive substring over string, date and datetime fields, the row id and the page: searchRows' scope. */
  search?: string;
}

/** The rows a query matches, as a list reads them: a count and any window (a RowSource). */
export type IndexedRows = RowSource & { rows(start: number, end: number): Promise<Row[]> };

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
}

export const INDEX_FORMAT = 1;

const SEP = "\u0001";
const BATCH = 5000;
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

async function dropTables(db: SqlDriver, n: number): Promise<void> {
  await db.exec(`drop table if exists x${n}; drop table if exists r${n};`);
  await db.exec("create table if not exists _bad(n integer, fld integer, bad integer, primary key(n, fld))");
  await db.run("delete from _bad where n = ?", [n]);
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
  await db.exec("begin");
  try {
    await createTables(db, n, plan);
    const computed = schema.fields.filter((f) => f.computed);
    // Formulas that read other rows are computed over every row at once; others, a batch at a time.
    const across = computed.length > 0 && !rowLocal(schema, computed);
    if (across && !Array.isArray(rows)) throw new Error("formulas that read other rows need the rows as an array");
    const source = Array.isArray(rows) && across ? computeRows(schema, rows).rows : rows;
    const perBatch = computed.length > 0 && !across;
    const size = options.batchSize ?? BATCH;
    const bad = new Map<number, number>();
    for (const f of plan.never) bad.set(f, NEVER);
    const sql = `insert into r${n}(id, j, s, ${plan.columns.join(", ")}) values(?, ?, ?, ${plan.columns.map(() => "?").join(", ")})`;
    const flush = async (chunk: Row[]) => {
      if (chunk.length === 0) return;
      const shown = perBatch ? computeRows(schema, chunk).rows : chunk;
      const lists = shown.map((row) => {
        const e = encode(plan, row, bodies?.[row.id]);
        for (const f of e.bad) bad.set(f, (bad.get(f) ?? 0) + 1);
        return [String(row.id), JSON.stringify(row), e.search, ...e.values] as SqlValue[];
      });
      if (db.batch) await db.batch(sql, lists);
      else for (const params of lists) await db.run(sql, params);
    };
    let chunk: Row[] = [];
    for await (const row of source) {
      chunk.push(row);
      if (chunk.length >= size) {
        await flush(chunk);
        chunk = [];
      }
    }
    await flush(chunk);
    await db.exec(
      `create virtual table x${n} using fts5(s, content='r${n}', content_rowid='pos', tokenize='trigram'); insert into x${n}(x${n}) values('rebuild');`,
    );
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
    throw error;
  }
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
 * given without an entry keeps its page.
 */
export async function putRows(
  db: SqlDriver,
  options: { name: string; schema: TableSchema; rows: Row[]; bodies?: Record<string, string>; key: string },
): Promise<void> {
  const { name, schema, rows, bodies, key } = options;
  const plan = planOf(schema);
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) throw new Error(`no index for ${name}`);
  if (plan.never.size > 0) throw new Error("formulas that read other rows can't be edited in place: rebuild the index");
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(schema)) throw new Error("the schema changed: rebuild the index");
  const computed = schema.fields.some((f) => f.computed);
  const cols = plan.columns;
  await db.exec("begin");
  try {
    for (const raw of rows) {
      const row = computed ? computeRows(schema, [raw]).rows[0]! : raw;
      const old = (await db.all(`select pos, j, s from r${n} where id = ?`, [String(row.id)]))[0];
      const priorBody = old ? bodyOf(old.s as string) : "";
      const body = bodies && row.id in bodies ? bodies[row.id]!.toLowerCase() : priorBody;
      const e = encode(plan, row, body === "" ? undefined : body);
      if (old) {
        const was = encode(plan, JSON.parse(old.j as string) as Row, undefined);
        await shiftBad(db, n, was.bad, -1);
        await db.run(`insert into x${n}(x${n}, rowid, s) values('delete', ?, ?)`, [old.pos as number, old.s as string]);
        await db.run(
          `update r${n} set j = ?, s = ?, ${cols.map((c) => `${c} = ?`).join(", ")} where pos = ?`,
          [JSON.stringify(row), e.search, ...e.values, old.pos as number],
        );
        await db.run(`insert into x${n}(rowid, s) values(?, ?)`, [old.pos as number, e.search]);
      } else {
        await db.run(
          `insert into r${n}(id, j, s, ${cols.join(", ")}) values(?, ?, ?, ${cols.map(() => "?").join(", ")})`,
          [String(row.id), JSON.stringify(row), e.search, ...e.values],
        );
        const pos = (await db.all(`select pos from r${n} where id = ?`, [String(row.id)]))[0]!.pos as number;
        await db.run(`insert into x${n}(rowid, s) values(?, ?)`, [pos, e.search]);
      }
      await shiftBad(db, n, e.bad, 1);
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

/** Remove rows by id, and their pages. */
export async function removeRows(db: SqlDriver, options: { name: string; schema: TableSchema; ids: string[]; key: string }): Promise<void> {
  const { name, schema, ids, key } = options;
  const plan = planOf(schema);
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) throw new Error(`no index for ${name}`);
  await db.exec("begin");
  try {
    for (const id of ids) {
      const old = (await db.all(`select pos, j, s from r${n} where id = ?`, [id]))[0];
      if (!old) continue;
      await shiftBad(db, n, encode(plan, JSON.parse(old.j as string) as Row, undefined).bad, -1);
      await db.run(`insert into x${n}(x${n}, rowid, s) values('delete', ?, ?)`, [old.pos as number, old.s as string]);
      await db.run(`delete from r${n} where pos = ?`, [old.pos as number]);
    }
    await db.run("update _tables set key = ?, built_at = ? where n = ?", [key, new Date().toISOString(), n]);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback").catch(() => {});
    throw error;
  }
}

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
function filterSql(kind: Kind, col: string, f: ViewFilter): Compiled {
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
      if (typeof value === "string" && WIDE.test(value)) return null;
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.operator];
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
  options: { name: string; schema: TableSchema; query?: IndexQuery },
): Promise<IndexedRows | null> {
  const { name, schema } = options;
  const query = options.query ?? {};
  const n = await tableNumber(db, name, false);
  if (n === null || (await indexKey(db, name)) === null) return null;
  const sig = (await db.all("select sig from _tables where n = ?", [n]))[0]?.sig;
  if (sig !== signature(schema)) return null;
  const plan = planOf(schema);
  const bad = await badFields(db, n);
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
    const compiled = filterSql(plan.kinds[i]!, `r.${plan.c[i]}`, f);
    if (!compiled) return null;
    where.push(compiled.sql);
    whereParams.push(...compiled.params);
  }

  const needle = (query.search ?? "").trim().toLowerCase();
  if (needle.length > 0) {
    if (needle.includes(SEP) || needle.includes("\u0002")) return null;
    // The trigram index finds candidates (it folds a little more than lower case does); instr is the exact test.
    if ([...needle].length >= 3) {
      where.push(`r.pos in (select rowid from x${n} where x${n} match ?)`);
      whereParams.push(`"${needle.replace(/"/g, '""')}"`);
    }
    where.push("instr(r.s, ?) > 0");
    whereParams.push(needle);
  }

  let join = "";
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
      if (at === 0) await sortIndex(db, n, sortTerms(plan, schema.fields[i]!, i, s.direction, "")!, `o${i}${s.direction === "desc" ? "d" : "a"}`);
      orderTerms.push(...terms);
    }
  }
  orderTerms.push("r.pos asc");

  const clause = where.length > 0 ? `where ${where.join(" and ")}` : "";
  const total = await db.all(`select count(*) as n from r${n} r ${clause}`, whereParams);
  const count = total[0]!.n as number;
  return {
    count,
    async rows(start, end) {
      if (end <= start) return [];
      const found = await db.all(
        `select r.j as j from r${n} r ${join} ${clause} order by ${orderTerms.join(", ")} limit ? offset ?`,
        [...joinParams, ...whereParams, end - start, start],
      );
      return found.map((r) => JSON.parse(r.j as string) as Row);
    },
  };
}

/** A parsed table's rows as the index holds them: handy for the apps' first build. */
export function indexSource(table: ParsedTable, name: string, key: string): BuildOptions {
  return { name, schema: table.schema, rows: table.rows, bodies: table.bodies, key };
}
