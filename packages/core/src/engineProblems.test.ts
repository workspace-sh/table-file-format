// A held table's problems (#867, step 2b) are problemsOf's: the same problems, in the same order,
// with the same words, places, details and fixes, over seeded tables that break every rule.
import { test } from "node:test";
import assert from "node:assert/strict";

import { heldProblems, holdRows } from "./engineViews.js";
import { problemsOf, type ProblemCode } from "./problems.js";
import { problemRows, problemSchema, random } from "./viewCases.js";
import type { ParsedBundle, ParsedTable, TableSchema } from "./types.js";

const schema = problemSchema;
const rowsFor = problemRows;

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
