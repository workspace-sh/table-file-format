// today, now and rand (D55): the clock and chance, read once for a whole
// computation, never remembered from one to the next.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compileFormula } from "./formula.js";
import { computeRows, rowLocal } from "./workbook.js";
import type { TableSchema } from "./types.js";

const c = (expr: string) => ({ expr, dialect: "table-expr-v1" });
const schema: TableSchema = {
  fields: [
    { name: "due", type: "date" },
    { name: "d", type: "date", computed: c("(today)") },
    { name: "t", type: "datetime", computed: c("(now)") },
    { name: "r", type: "number", computed: c("(rand)") },
    { name: "late", type: "boolean", computed: c("(< due (today))") },
  ],
};
const rows = [{ id: "a", due: "2026-10-01" }, { id: "b", due: "2026-12-01" }];

test("today is the reader's date, now the instant in UTC, rand a number from 0 up to 1, one moment for every row", () => {
  const out = computeRows(schema, rows, { now: new Date(Date.UTC(2026, 9, 23, 12, 0, 5)), random: () => 0.5 }).rows;
  assert.equal(out[0]!.d, out[1]!.d);
  assert.match(String(out[0]!.d), /^2026-10-2[234]$/);
  assert.equal(out[0]!.t, "2026-10-23T12:00:05Z");
  assert.equal(out[0]!.r, 0.5);
  assert.equal(out[0]!.late, true);
  assert.equal(out[1]!.late, false);
  assert.equal(String(computeRows({ fields: [{ name: "x", type: "date", computed: c("(today 1)") }] }, rows).rows[0]!.x), "#VALUE!");
});

test("never remembered: the same rows worked out at another moment give that moment's answer", () => {
  const first = computeRows(schema, rows, { now: new Date(Date.UTC(2026, 0, 1, 12)) }).rows[0]!.t;
  const later = computeRows(schema, rows, { now: new Date(Date.UTC(2027, 0, 1, 12)) }).rows[0]!.t;
  assert.notEqual(first, later);
  // Not row-local: a table that uses them is worked out whole, and isn't held in an index.
  assert.equal(rowLocal(schema, schema.fields.filter((f) => f.computed)), false);
});

test("typed as spreadsheets type them", () => {
  for (const [typed, stored] of [["=TODAY()", "(today)"], ["=NOW()", "(now)"], ["=RAND()", "(rand)"]] as const) {
    const r = compileFormula(typed);
    assert.ok(r.ok && r.stored === stored, typed);
  }
});
