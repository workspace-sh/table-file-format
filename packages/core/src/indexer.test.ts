import { test } from "node:test";
import assert from "node:assert/strict";
import { applyView, searchRows } from "./query.js";
import { arraySource } from "./row-source.js";
import { oo1Driver } from "./sqlite-wasm.js";
import { buildIndex, dropIndex, indexKey, isIndexStale, putRows, queryIndex, removeRows, type SqlDriver, type SqlValue } from "./indexer.js";
import type { ParsedTable, Row, TableSchema, View, ViewFilter } from "./types.js";

// node:sqlite arrived in Node 22.5 and has no types here; where it's missing the index is simply untested.
// INDEXER_DRIVER=wasm runs the same tests over SQLite WASM, the engine the web demo ships.
let sqlite: { DatabaseSync: new (path: string) => any } | null = null;
let wasm: { oo1: { DB: new (path: string) => any } } | null = null;
if (process.env.INDEXER_DRIVER === "wasm") {
  const init = (await import("@sqlite.org/sqlite-wasm" as string)).default as () => Promise<typeof wasm>;
  wasm = await init();
} else {
  try {
    sqlite = (await import("node:sqlite" as string)) as typeof sqlite;
  } catch {
    sqlite = null;
  }
}
const skip = sqlite || wasm ? false : "node:sqlite is not available";

function driver(): SqlDriver {
  if (wasm) return oo1Driver(new wasm.oo1.DB(":memory:"));
  const db = new sqlite!.DatabaseSync(":memory:");
  const cache = new Map<string, any>();
  const prepared = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      prepared(sql).run(...params);
    },
    async all(sql, params = []) {
      return prepared(sql).all(...params);
    },
  };
}

// A small seeded generator, so a failure replays.
function random(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]!;
  return { next, int, pick };
}

const schema: TableSchema = {
  fields: [
    { name: "name", type: "string" },
    { name: "n", type: "number" },
    { name: "flag", type: "boolean" },
    { name: "when", type: "datetime" },
    { name: "day", type: "date" },
    { name: "level", type: "string", constraints: { enum: ["low", "mid", "high"] } },
    { name: "tags", type: "array" },
    { name: "double", type: "number", computed: { dialect: "table-expr-v1", expr: "(* n 2)" } },
  ],
};

const names = ["Apple", "apple", "APPLE", "banana", "Ünï", "ünï", "İstanbul", "ǅ", "😀 smile", "Ａ", "a b", "ab", "z", "Z", "\u{10000}x", "xＡ", "a\u0001b", "needle in hay", "100%", "_x"];
const dates = ["2026-01-02T10:00:00+02:00", "2026-01-02T09:00:00Z", "2026-01-02T08:30:00Z", "2025-12-31T23:59:59Z", "2026-03-01T00:00:00-05:00"];
const days = ["2026-01-01", "2026-02-03", "2025-12-31"];
const tagPool: (string | number)[] = ["a", "b", "c", 1, 2, "", "A"];
const blankish: unknown[] = [undefined, null, ""];

function makeRows(seed: number, count: number): Row[] {
  const r = random(seed);
  const maybe = (make: () => unknown): unknown => (r.int(5) === 0 ? r.pick(blankish) : make());
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const row: Row = { id: `r${i}-${r.pick(["X", "y", "Q"])}` };
    const set = (k: string, v: unknown) => {
      if (v !== undefined) row[k] = v as never;
    };
    set("name", maybe(() => r.pick(names)));
    set("n", maybe(() => r.pick([-1, 0, 1, 2.5, 10, 100, 100, 7])));
    set("flag", maybe(() => r.int(2) === 0));
    set("when", maybe(() => r.pick(dates)));
    set("day", maybe(() => r.pick(days)));
    set("level", maybe(() => r.pick(["low", "mid", "high", "other"])));
    set("tags", maybe(() => Array.from({ length: r.int(3) }, () => r.pick(tagPool))));
    rows.push(row);
  }
  return rows;
}

function bodiesFor(rows: Row[], seed: number): Record<string, string> {
  const r = random(seed);
  const out: Record<string, string> = {};
  for (const row of rows) if (r.int(4) === 0) out[row.id] = r.pick(["Needle in the body", "ÜNÏ page", "plain", "x\nneedle"]);
  return out;
}

const ops = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty", "in", "not_in"] as const;

function randomFilter(r: ReturnType<typeof random>): ViewFilter {
  const field = r.pick(["name", "n", "flag", "when", "day", "level", "tags", "double"]);
  const operator = r.pick(ops);
  const pool: unknown[] = [...names, ...dates, ...days, "low", "high", "a", "b", 1, 2, 10, 100, 2.5, -1, 0, true, false, "", "ap", "ünï", "p", "A"];
  const value =
    operator === "in" || operator === "not_in"
      ? Array.from({ length: r.int(4) }, () => r.pick(pool))
      : operator === "empty" || operator === "not_empty"
        ? undefined
        : r.pick(pool);
  return value === undefined ? { field, operator } : ({ field, operator, value } as ViewFilter);
}

const plain = (rows: Row[]) => JSON.parse(JSON.stringify(rows)) as Row[];

async function check(db: SqlDriver, table: ParsedTable, view: View, search: string | undefined, label: string): Promise<boolean> {
  const query = { filter: view.filter, sort: view.sort, order: view.order, search };
  const got = await queryIndex(db, { name: "t", schema: table.schema, query });
  if (!got) return false;
  let want = applyView(table, view);
  if (search) want = searchRows(want, search, { schema: table.schema, bodies: table.bodies });
  assert.equal(got.count, want.length, `${label}: count of ${JSON.stringify(query)}`);
  const rows = await got.rows(0, want.length);
  assert.deepEqual(
    rows.map((x) => x.id),
    want.map((x) => x.id),
    `${label}: order of ${JSON.stringify(query)}`,
  );
  assert.deepEqual(rows, plain(want), `${label}: rows of ${JSON.stringify(query)}`);
  return true;
}

function tableOf(rows: Row[], bodies?: Record<string, string>): ParsedTable {
  return { schema, rows, views: [], meta: {} as never, bodies };
}

test("the index answers what applyView and searchRows answer", { skip }, async () => {
  let compared = 0;
  let fell = 0;
  for (const seed of [1, 2, 3]) {
    const rows = makeRows(seed, 300);
    const bodies = bodiesFor(rows, seed);
    const table = tableOf(rows, bodies);
    const db = driver();
    await buildIndex(db, { name: "t", schema, rows, bodies, key: "k1", batchSize: 64 });
    const r = random(seed * 977);
    for (let q = 0; q < 700; q++) {
      const filter = Array.from({ length: r.int(3) }, () => randomFilter(r));
      const sorts = Array.from({ length: r.int(3) }, () => ({
        field: r.pick(["name", "n", "flag", "when", "day", "level", "double"]),
        direction: r.pick(["asc", "desc"] as const),
      }));
      const order = r.int(6) === 0 ? Array.from({ length: 1 + r.int(8) }, () => r.pick(rows).id) : undefined;
      const view: View = { id: "v", name: "v", layout: "table", filter, sort: sorts, order };
      const search = r.int(4) === 0 ? r.pick(["needle", " NEEDLE ", "ünï", "ap", "a b", "x", "r1", "ǅ", "Ａ", "😀", "100%", "_x", "a\u0001b", "zzz"]) : undefined;
      if (await check(db, table, view, search, `seed ${seed}`)) compared++;
      else fell++;
    }
  }
  // Most queries are answered by the index; the rest are said to be unanswerable, not guessed.
  assert.ok(compared > fell, `index answered ${compared}, fell back ${fell}`);
});

test("every operator is checked one at a time against each field", { skip }, async () => {
  const rows = makeRows(11, 200);
  const bodies = bodiesFor(rows, 11);
  const table = tableOf(rows, bodies);
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows, bodies, key: "k" });
  const r = random(5);
  let compared = 0;
  for (const operator of ops) {
    for (const field of ["name", "n", "flag", "when", "day", "level", "tags", "double"]) {
      for (let i = 0; i < 25; i++) {
        const f = randomFilter(r);
        const filter = { ...f, field, operator } as ViewFilter;
        if (operator === "in" || operator === "not_in") (filter as { value: unknown }).value = Array.isArray(f.value) ? f.value : [f.value];
        if (await check(db, table, { id: "v", name: "v", layout: "table", filter: [filter] }, undefined, `${operator} ${field}`)) compared++;
      }
    }
  }
  assert.ok(compared > 1000, `compared ${compared}`);
});

test("a field holding values its type doesn't is not answered by the index", { skip }, async () => {
  const rows: Row[] = [
    { id: "a", n: 1 },
    { id: "b", n: "two" as never },
    { id: "c", n: 3 },
  ];
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows, key: "k" });
  assert.equal(await queryIndex(db, { name: "t", schema, query: { filter: [{ field: "n", operator: "gt", value: 0 }] } }), null);
  assert.equal(await queryIndex(db, { name: "t", schema, query: { sort: [{ field: "n", direction: "asc" }] } }), null);
  // Other fields are fine.
  const ok = await queryIndex(db, { name: "t", schema, query: { filter: [{ field: "name", operator: "empty" }] } });
  assert.equal(ok?.count, 3);
  // Fixed by an edit, the field is answerable again.
  await putRows(db, { name: "t", schema, rows: [{ id: "b", n: 2 }], key: "k2" });
  assert.equal((await queryIndex(db, { name: "t", schema, query: { filter: [{ field: "n", operator: "gt", value: 0 }] } }))?.count, 3);
});

test("empty cells are neither greater nor less than anything", () => {
  const t = tableOf([{ id: "a", n: 0 }, { id: "b" }, { id: "c", n: null as never }, { id: "d", n: "" as never }, { id: "e", n: 5 }]);
  const ids = (operator: "gt" | "gte" | "lt" | "lte", value: number) =>
    applyView(t, { id: "v", name: "v", layout: "table", filter: [{ field: "n", operator, value }] }).map((r) => r.id);
  assert.deepEqual(ids("gte", 0), ["a", "e"]);
  assert.deepEqual(ids("lt", 5), ["a"]);
  assert.deepEqual(ids("lte", 100), ["a", "e"]);
  assert.deepEqual(ids("gt", -1), ["a", "e"]);
});

test("a stale, missing or dropped index says so", { skip }, async () => {
  const db = driver();
  assert.equal(await isIndexStale(db, "t", "k"), true);
  assert.equal(await queryIndex(db, { name: "t", schema }), null);
  await buildIndex(db, { name: "t", schema, rows: [{ id: "a" }], key: "k" });
  assert.equal(await isIndexStale(db, "t", "k"), false);
  assert.equal(await isIndexStale(db, "t", "other"), true);
  assert.equal(await indexKey(db, "t"), "k");
  // A changed schema is another table's index.
  const changed: TableSchema = { fields: [...schema.fields, { name: "extra", type: "string" }] };
  assert.equal(await queryIndex(db, { name: "t", schema: changed }), null);
  await dropIndex(db, "t");
  assert.equal(await isIndexStale(db, "t", "k"), true);
  assert.equal(await queryIndex(db, { name: "t", schema }), null);
});

test("several tables share one database", { skip }, async () => {
  const db = driver();
  await buildIndex(db, { name: "a", schema, rows: [{ id: "1", name: "one" }, { id: "2", name: "two" }], key: "ka" });
  await buildIndex(db, { name: "b", schema, rows: [{ id: "9", name: "nine" }], key: "kb" });
  assert.equal((await queryIndex(db, { name: "a", schema }))?.count, 2);
  assert.equal((await queryIndex(db, { name: "b", schema }))?.count, 1);
  await buildIndex(db, { name: "a", schema, rows: [{ id: "3", name: "three" }], key: "ka2" });
  assert.deepEqual((await (await queryIndex(db, { name: "a", schema }))!.rows(0, 10)).map((r) => r.id), ["3"]);
  await dropIndex(db, "a");
  assert.equal((await queryIndex(db, { name: "b", schema }))?.count, 1);
});

test("edits in place leave the index answering what a rebuild would", { skip }, async () => {
  const r = random(42);
  let rows = makeRows(21, 150);
  let bodies = bodiesFor(rows, 21);
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows, bodies, key: "k0" });
  for (let step = 1; step <= 40; step++) {
    const kind = r.int(4);
    if (kind === 0 && rows.length > 0) {
      const gone = r.pick(rows).id;
      rows = rows.filter((x) => x.id !== gone);
      const { [gone]: _, ...rest } = bodies;
      bodies = rest;
      await removeRows(db, { name: "t", schema, ids: [gone], key: `k${step}` });
    } else if (kind === 1) {
      const fresh = makeRows(1000 + step, 1)[0]!;
      fresh.id = `new${step}`;
      rows = [...rows, fresh];
      await putRows(db, { name: "t", schema, rows: [fresh], key: `k${step}` });
    } else if (kind === 2) {
      const at = r.int(rows.length);
      const edited = { ...rows[at]!, ...makeRows(2000 + step, 1)[0]!, id: rows[at]!.id };
      rows = rows.map((x, i) => (i === at ? edited : x));
      await putRows(db, { name: "t", schema, rows: [edited], key: `k${step}` });
    } else {
      const id = r.pick(rows).id;
      const body = r.pick(["", "fresh needle page", "ÜNÏ again"]);
      bodies = { ...bodies };
      if (body === "") delete bodies[id];
      else bodies[id] = body;
      await putRows(db, { name: "t", schema, rows: [rows.find((x) => x.id === id)!], bodies: { [id]: body }, key: `k${step}` });
    }
    const table = tableOf(rows, bodies);
    for (let q = 0; q < 12; q++) {
      const view: View = {
        id: "v",
        name: "v",
        layout: "table",
        filter: [randomFilter(r)],
        sort: [{ field: r.pick(["name", "n", "when", "level"]), direction: r.pick(["asc", "desc"] as const) }],
      };
      await check(db, table, view, r.pick([undefined, "needle", "ünï", "fresh"]), `step ${step}`);
    }
  }
  // The full-text index agrees with the rows it was edited along with.
  await db.run("insert into x1(x1, rank) values('integrity-check', 1)");
  // Rows added in place come last, as appended rows do; a rebuild of the same rows agrees.
  const fresh = driver();
  await buildIndex(fresh, { name: "t", schema, rows, bodies, key: "z" });
  const a = await (await queryIndex(db, { name: "t", schema }))!.rows(0, 1e6);
  const b = await (await queryIndex(fresh, { name: "t", schema }))!.rows(0, 1e6);
  assert.deepEqual(
    a.map((x) => x.id).sort(),
    b.map((x) => x.id).sort(),
  );
});

test("rows can be streamed in", { skip }, async () => {
  const rows = makeRows(8, 500);
  async function* stream() {
    for (const row of rows) yield row;
  }
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows: stream(), key: "k", batchSize: 100 });
  const table = tableOf(rows);
  assert.ok(await check(db, table, { id: "v", name: "v", layout: "table", sort: [{ field: "name", direction: "asc" }] }, undefined, "stream"));
});

test("a page of rows is a window onto the same order", { skip }, async () => {
  const rows = makeRows(4, 120);
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows, key: "k" });
  const all = await queryIndex(db, { name: "t", schema, query: { sort: [{ field: "n", direction: "desc" }] } });
  const whole = await all!.rows(0, 120);
  const part = await all!.rows(30, 45);
  assert.deepEqual(part, whole.slice(30, 45));
  assert.deepEqual(await all!.rows(10, 10), []);
});

test("formulas that read other rows are not indexed", { skip }, async () => {
  const lookup: TableSchema = {
    fields: [
      { name: "n", type: "number" },
      { name: "total", type: "number", computed: { dialect: "table-expr-v1", expr: "(sum (column n))" } },
    ],
  };
  const rows: Row[] = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  const db = driver();
  await buildIndex(db, { name: "t", schema: lookup, rows, key: "k" });
  assert.equal(await queryIndex(db, { name: "t", schema: lookup, query: { sort: [{ field: "total", direction: "asc" }] } }), null);
  assert.equal((await queryIndex(db, { name: "t", schema: lookup, query: { sort: [{ field: "n", direction: "desc" }] } }))?.count, 2);
  await assert.rejects(putRows(db, { name: "t", schema: lookup, rows: [{ id: "c", n: 3 }], key: "k2" }), /rebuild/);
});

test("a sort is indexed the first time it is asked for, and again after a rebuild", { skip }, async () => {
  const db = driver();
  const sorted = { sort: [{ field: "n", direction: "desc" as const }] };
  const indexes = async () => (await db.all("select name from sqlite_master where type = 'index' and name like 'r1_o%'")).map((r) => r.name);
  await buildIndex(db, { name: "t", schema, rows: makeRows(3, 50), key: "k" });
  assert.deepEqual(await indexes(), []);
  await queryIndex(db, { name: "t", schema, query: sorted });
  assert.deepEqual(await indexes(), ["r1_o1d"]);
  await buildIndex(db, { name: "t", schema, rows: makeRows(4, 50), key: "k2" });
  assert.deepEqual(await indexes(), []);
  await queryIndex(db, { name: "t", schema, query: sorted });
  assert.deepEqual(await indexes(), ["r1_o1d"]);
});

test("a RowSource over memory and one over the index give the same windows", { skip }, async () => {
  const rows = makeRows(6, 40);
  const db = driver();
  await buildIndex(db, { name: "t", schema, rows, key: "k" });
  const indexed = (await queryIndex(db, { name: "t", schema }))!;
  const memory = arraySource(plain(applyView(tableOf(rows), { id: "v", name: "v", layout: "table" })));
  assert.equal(memory.count, indexed.count);
  for (const [a, b] of [[0, 10], [35, 60], [5, 5], [-3, 2]] as const) {
    assert.deepEqual(await indexed.rows(Math.max(a, 0), b), memory.rows(a, b));
  }
});
