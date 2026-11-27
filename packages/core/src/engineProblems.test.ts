// A held table's problems (#867, step 2b) are problemsOf's: the same problems, in the same order,
// with the same words, places, details and fixes, over seeded tables that break every rule.
import { test } from "node:test";
import assert from "node:assert/strict";

import { heldProblems, holdRows } from "./engineViews.js";
import { problemsOf, type ProblemCode } from "./problems.js";
import { random } from "./viewCases.js";
import type { ParsedBundle, ParsedTable, Row, TableSchema } from "./types.js";

const schema: TableSchema = {
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

function rowsFor(seed: number, count: number): Row[] {
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

test("a held table's problems are problemsOf's, in order, with their words, details and fixes", () => {
  let compared = 0;
  const seen = new Set<ProblemCode>();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rows = rowsFor(seed, 120);
    const r = random(seed * 13);
    const bodies: Record<string, string> = {};
    for (const id of [rows[0]!.id, rows[3]!.id, "10", "2", "gone page", "1"]) if (r.int(3) !== 0) bodies[id] = "a page";
    const table: ParsedTable = { path: "", schema, rows, views: [], meta: {} as never, bodies };
    const other: ParsedTable = { path: "", schema: { fields: [] }, rows: [{ id: "o1" }, { id: "o2" }], views: [], meta: {} as never };
    const bundle = { meta: {}, tables: { t: table, other }, path: "" } as ParsedBundle;
    const attachments = ["a.png", "b.png", "unused.png", "c.png"].filter(() => r.int(4) !== 0);
    const want = problemsOf(table, "t", { bundle, attachments });
    const held = holdRows(schema.fields.map((f) => f.name), rows);
    const got = heldProblems(held, table, "t", { bundle, attachments })!;
    assert.ok(got, `seed ${seed}: answered`);
    assert.equal(got.total, want.length, `seed ${seed}: how many`);
    const counts: Partial<Record<ProblemCode, number>> = {};
    for (const p of want) counts[p.code] = (counts[p.code] ?? 0) + 1;
    assert.deepEqual(got.counts, counts, `seed ${seed}: counted by code`);
    // In windows, as a list draws them, and whole.
    const windows = [];
    for (let from = 0; from < got.total; from += 37) windows.push(...got.problems(from, from + 37));
    assert.deepEqual(windows, want, `seed ${seed}: the problems`);
    assert.deepEqual(got.problems(0, got.total), want, `seed ${seed}: all at once`);
    compared += want.length;
    for (const p of want) seen.add(p.code);
  }
  assert.ok(compared > 2000, `compared ${compared} problems`);
  // Every kind the engine finds was found, and compared.
  const kinds: ProblemCode[] = ["value.required", "value.type", "value.choice", "value.minimum", "value.maximum", "value.exclusive-minimum", "value.exclusive-maximum", "value.min-length", "value.max-length", "value.unique", "key.primary", "key.unique", "body.orphaned", "relation.dangling", "choice.unused", "attachment.orphaned"];
  assert.deepEqual(kinds.filter((k) => !seen.has(k)), []);
});

test("a table the engine can't promise memory's answer for isn't answered", () => {
  const rows = [{ id: "a", name: "x" }];
  const held = holdRows(["name"], rows);
  const patterned: TableSchema = { fields: [{ name: "name", type: "string", constraints: { pattern: "^[a-z]+$" } }] };
  assert.equal(heldProblems(held, { schema: patterned }, "t"), null);
  const plain: TableSchema = { fields: [{ name: "name", type: "string" }] };
  assert.equal(heldProblems(held, { schema: plain, cells: [{ id: "a", field: "name", expr: "(+ 1 1)", dialect: "table-expr-v1" }] }, "t"), null);
  assert.equal(heldProblems(held, { schema: plain }, "t")?.total, 0);
});

test("counts come at once, with no problem made and no row read", () => {
  const rows = rowsFor(9, 2000);
  const held = holdRows(schema.fields.map((f) => f.name), rows);
  const got = heldProblems(held, { schema }, "t")!;
  assert.ok(got.total > 1000);
  assert.equal(Object.values(got.counts).reduce((a, b) => a + (b ?? 0), 0), got.total);
});
