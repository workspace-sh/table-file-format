// The cases every implementation of a view runs, over the same seeded rows: what the SQLite index
// (indexer.cases.ts) and a table the engine holds (engineViews.test.ts) answer must be what
// applyView, searchRows and memoryViewRows give in memory. Each may say it can't answer a view
// (null), for its caller to work out in memory; it may never answer it differently.

import { applyView, searchRows } from "./query.js";
import { memoryViewRows, type ViewRows } from "./row-source.js";
import type { IndexQuery } from "./indexer.js";
import type { ParsedTable, Row, TableSchema, View, ViewFilter } from "./types.js";
import type { CaseAssert, CaseTest } from "./indexer.cases.js";

// A small seeded generator, so a failure replays.
export function random(seed: number) {
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

export const schema: TableSchema = {
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

export const names = ["Apple", "apple", "APPLE", "banana", "Ünï", "ünï", "İstanbul", "ǅ", "😀 smile", "Ａ", "a b", "ab", "z", "Z", "\u{10000}x", "xＡ", "a\u0001b", "needle in hay", "100%", "_x"];
export const dates = ["2026-01-02T10:00:00+02:00", "2026-01-02T09:00:00Z", "2026-01-02T08:30:00Z", "2025-12-31T23:59:59Z", "2026-03-01T00:00:00-05:00"];
export const days = ["2026-01-01", "2026-02-03", "2025-12-31"];
export const tagPool: (string | number)[] = ["a", "b", "c", 1, 2, "", "A"];
export const blankish: unknown[] = [undefined, null, ""];

export function makeRows(seed: number, count: number): Row[] {
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

export function bodiesFor(rows: Row[], seed: number): Record<string, string> {
  const r = random(seed);
  const out: Record<string, string> = {};
  for (const row of rows) if (r.int(4) === 0) out[row.id] = r.pick(["Needle in the body", "ÜNÏ page", "plain", "x\nneedle"]);
  return out;
}

export const ops = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty", "in", "not_in"] as const;

export function randomFilter(r: ReturnType<typeof random>): ViewFilter {
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


export const plain = (rows: Row[]) => JSON.parse(JSON.stringify(rows)) as Row[];

/** What answers views of some rows, made once a case: a view, or null when it can't promise memory's answer. */
export type ViewSource = (rows: Row[], bodies: Record<string, string> | undefined, schema: TableSchema) => Promise<(query: IndexQuery) => Promise<ViewRows | null> | ViewRows | null>;

/**
 * The cases, registered with `test`, for `who` (named in each case). `options.schema` is the schema
 * the rows are read with, when `who` answers only some of it (a held table has no formulas yet).
 */
export function viewCases(test: CaseTest, assert: CaseAssert, who: string, source: ViewSource, options: { schema?: TableSchema } = {}): void {
  const used = options.schema ?? schema;
  const tableOf = (rows: Row[], bodies?: Record<string, string>): ParsedTable => ({ path: "", schema: used, rows, views: [], meta: {} as never, bodies });

  async function check(answer: (query: IndexQuery) => Promise<ViewRows | null> | ViewRows | null, table: ParsedTable, view: View, search: string | undefined, label: string): Promise<boolean> {
    const query: IndexQuery = { ...(view.filter ? { filter: view.filter } : {}), ...(view.sort ? { sort: view.sort } : {}), ...(view.order ? { order: view.order } : {}), ...(search ? { search } : {}) };
    const got = await answer(query);
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

  test(`${who} answers what applyView and searchRows answer`, async () => {
    let compared = 0;
    let fell = 0;
    for (const seed of [1, 2, 3]) {
      const rows = makeRows(seed, 300);
      const bodies = bodiesFor(rows, seed);
      const table = tableOf(rows, bodies);
      const answer = await source(rows, bodies, used);
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
        if (await check(answer, table, view, search, `seed ${seed}`)) compared++;
        else fell++;
      }
    }
    // Most queries are answered; the rest are said to be unanswerable, not guessed.
    assert.ok(compared > fell, `${who} answered ${compared}, fell back ${fell}`);
  });

  test(`every operator is checked one at a time against each field, by ${who}`, async () => {
    const rows = makeRows(11, 200);
    const bodies = bodiesFor(rows, 11);
    const table = tableOf(rows, bodies);
    const answer = await source(rows, bodies, used);
    const r = random(5);
    let compared = 0;
    for (const operator of ops) {
      for (const field of ["name", "n", "flag", "when", "day", "level", "tags", "double"]) {
        for (let i = 0; i < 25; i++) {
          const f = randomFilter(r);
          const filter = { ...f, field, operator } as ViewFilter;
          if (operator === "in" || operator === "not_in") (filter as { value: unknown }).value = Array.isArray(f.value) ? f.value : [f.value];
          if (await check(answer, table, { id: "v", name: "v", layout: "table", filter: [filter] }, undefined, `${operator} ${field}`)) compared++;
        }
      }
    }
    assert.ok(compared > 1000, `compared ${compared}`);
  });

  test(`groups, totals, ids and places are what the rows in memory give, by ${who}`, async () => {
    let compared = 0;
    let fell = 0;
    const totalKinds = ["sum", "average", "min", "max", "count", "count_empty"] as const;
    for (const seed of [11, 12]) {
      const rows = makeRows(seed, 300);
      // Fractions, which don't add up the same in any order.
      const f = random(seed);
      for (const row of rows) if (typeof row.n === "number" && f.int(3) === 0) row.n = f.pick([0.1, 0.2, 0.3, 1e16, -1e16, 1 / 3]);
      const bodies = bodiesFor(rows, seed);
      const table = tableOf(rows, bodies);
      const answer = await source(rows, bodies, used);
      const r = random(seed * 31);
      for (let q = 0; q < 300; q++) {
        const filter = Array.from({ length: r.int(2) }, () => randomFilter(r));
        const sort = Array.from({ length: r.int(3) }, () => ({ field: r.pick(["name", "n", "flag", "when", "day", "level"]), direction: r.pick(["asc", "desc"] as const) }));
        const order = r.int(8) === 0 ? Array.from({ length: 1 + r.int(8) }, () => r.pick(rows).id) : undefined;
        const group = r.int(4) === 0 ? undefined : r.pick(["name", "n", "flag", "when", "day", "level", "tags", "double", "nope"]);
        const totals = Object.fromEntries(
          Array.from({ length: r.int(4) }, () => [r.pick(["name", "n", "flag", "level", "tags", "double", "nope"]), r.pick(totalKinds)]),
        );
        const search = r.int(5) === 0 ? r.pick(["needle", "ap", "x", "r1"]) : undefined;
        const view: View = { id: "v", name: "v", layout: "table", filter, sort, order };
        const query = { filter, sort, order, search, group, totals };
        const label = `seed ${seed}: ${JSON.stringify(query)}`;
        const got = await answer(query);
        if (!got) {
          fell++;
          continue;
        }
        compared++;
        const inView = applyView(table, view);
        const shown = search ? searchRows(inView, search, { schema: used, bodies }) : inView;
        const want = memoryViewRows(plain(shown), { inView: inView.length, group, schema: used, totals });
        assert.equal(got.count, want.count, `count, ${label}`);
        assert.equal(got.inView, want.inView, `inView, ${label}`);
        assert.deepEqual(await got.groups(), want.groups(), `groups, ${label}`);
        assert.deepEqual(await got.ids(0, want.count), want.ids(0, want.count), `ids, ${label}`);
        const a = r.int(want.count + 1);
        const b = a + r.int(40);
        assert.deepEqual(await got.rows(a, b), want.rows(a, b), `rows ${a} to ${b}, ${label}`);
        assert.deepEqual(await got.totals(), want.totals(), `totals, ${label}`);
        for (const id of [r.pick(rows).id, r.pick(rows).id, "nobody"]) {
          assert.equal(await got.placeOf(id), want.placeOf(id), `place of ${id}, ${label}`);
          assert.deepEqual(await got.row(id), want.row(id), `row ${id}, ${label}`);
        }
      }
    }
    assert.ok(compared > fell, `${who} answered ${compared}, fell back ${fell}`);
  });
}

/** A schema whose rows break every rule a table can (#867, step 2b): problemRows makes them. */
export const problemSchema: TableSchema = {
  fields: [
    { name: "name", type: "string", constraints: { required: true, minLength: 2, maxLength: 8, unique: true } },
    { name: "n", type: "number", constraints: { minimum: 0, maximum: 100, exclusiveMaximum: 1000 } },
    { name: "k", type: "integer", constraints: { exclusiveMinimum: -5 } },
    { name: "y", type: "year" },
    { name: "d", type: "date", constraints: { minimum: "2026-01-01" } },
    { name: "dt", type: "datetime", constraints: { maximum: "2026-06-01T00:00:00Z" } },
    { name: "t", type: "time", constraints: { minimum: "09:00:00" } },
    { name: "ym", type: "yearmonth", constraints: { maximum: "2026-12" } },
    { name: "dur", type: "duration" },
    { name: "flag", type: "boolean" },
    { name: "status", type: "string", categories: [{ value: "open" }, { value: "done" }, { value: "blocked" }] },
    { name: "tags", type: "array", constraints: { enum: ["a", "b", "c"] } },
    { name: "point", type: "geopoint" },
    { name: "shape", type: "geojson" },
    { name: "anything", type: "any" },
    { name: "obj", type: "object" },
    { name: "link", type: "string", relation: { table: "other" } },
    { name: "links", type: "array", relation: { table: "other", cardinality: "many" } },
    { name: "file", type: "string", attachment: true },
    { name: "sku", type: "string" },
    { name: "region", type: "string" },
    { name: "person", type: "string" },
    { name: "week", type: "string" },
    { name: "calc", type: "number", computed: { dialect: "table-expr-v1", expr: "(* n 2)" } },
  ],
  primaryKey: ["sku", "region"],
  uniqueKeys: [["person", "week"]],
} as TableSchema;

const odd: unknown[] = ["", null, 7, -0, 1.5, 2 ** 53, "x", "ab", "a\nb", 'say "hi"', "🙂🙂🙂🙂🙂", true, false, [], ["a"], [1, "b"], { "2": 1, "1": 2, z: [null] }, { type: "Point" }];

/** Seeded rows of problemSchema, breaking its rules at random. */
export function problemRows(seed: number, count: number): Row[] {
  const r = random(seed);
  const pick = <T,>(xs: readonly T[]): T => r.pick(xs);
  const maybe = (good: () => unknown): unknown => (r.int(4) === 0 ? pick(odd) : r.int(6) === 0 ? undefined : good());
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const row: Row = { id: pick([`r${i}`, `${i}`, `row ${i} é`]) + (r.int(3) === 0 ? "" : `-${i}`) };
    const set = (k: string, v: unknown) => v !== undefined && (row[k] = v as never);
    set("name", maybe(() => pick(["ab", "abc", "a", "abcdefghijk", "Ünï", "same", "same"])));
    set("n", maybe(() => pick([-1, 0, 50, 100, 101, 999, 1000, 0.5])));
    set("k", maybe(() => pick([-6, -5, -4, 3, 2.5])));
    set("y", maybe(() => pick([2026, 1999.5])));
    set("d", maybe(() => pick(["2026-01-01", "2025-12-31", "2026-02-30", "soon"])));
    set("dt", maybe(() => pick(["2026-05-31T23:00:00Z", "2026-06-01T02:00:00+02:00", "2026-07-01T00:00:00Z", "2026-06-01"])));
    set("t", maybe(() => pick(["08:59:59", "09:00:00", "23:00:00.5", "9am"])));
    set("ym", maybe(() => pick(["2026-12", "2027-01", "2026-13"])));
    set("dur", maybe(() => pick(["PT1H", "P", "1 hour"])));
    set("flag", maybe(() => r.int(2) === 0));
    set("status", maybe(() => pick(["open", "done", "nope"])));
    set("tags", maybe(() => Array.from({ length: r.int(3) }, () => pick(["a", "b", "z", 1]))));
    set("point", maybe(() => pick([[0, 0], [200, 0], [1]])));
    set("shape", maybe(() => pick([{ type: "Point", coordinates: [0, 0] }, '{"type":"Point"}', { coordinates: [] }, "not json"])));
    set("anything", maybe(() => pick([1, "x", [1], { a: 1 }])));
    set("obj", maybe(() => pick([{ a: 1 }, [1], "x"])));
    set("link", maybe(() => pick(["o1", "o2", "gone"])));
    set("links", maybe(() => pick([["o1"], ["o2", "gone"], [1, "o1"], "o1"])));
    set("file", maybe(() => pick(["a.png", "b.png", "c.png"])));
    set("sku", maybe(() => pick(["s1", "s2"])));
    set("region", maybe(() => pick(["eu", "us"])));
    set("person", maybe(() => pick(["p1", "p2"])));
    set("week", maybe(() => pick(["w1", "w2"])));
    rows.push(row);
  }
  return rows;
}
