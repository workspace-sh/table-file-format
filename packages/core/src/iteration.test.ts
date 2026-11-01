// Loops worked out by iteration, when a table asks for it (D60).
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyView } from "./query.js";
import { computeRows } from "./workbook.js";
import type { ParsedTable, TableSchema } from "./types.js";

const c = (expr: string) => ({ expr, dialect: "table-expr-v1" });
// Interest on a total that includes the interest: a loop that means to be one.
const schema: TableSchema = {
  fields: [
    { name: "deposit", type: "number" },
    { name: "interest", type: "number", computed: c("(* total 0.1)") },
    { name: "total", type: "number", computed: c("(+ deposit interest)") },
  ],
};
const rows = [{ id: "a", deposit: 900 }];

test("without iteration a loop is #REF!", () => {
  assert.equal(String(computeRows(schema, rows).rows[0]!.total), "#REF!");
});

test("with it, the loop settles where a spreadsheet's does", () => {
  const out = computeRows(schema, rows, { iteration: { max: 100, change: 0.001 } }).rows[0]!;
  assert.ok(Math.abs((out.total as number) - 1000) < 0.01, String(out.total));
  assert.ok(Math.abs((out.interest as number) - 100) < 0.01, String(out.interest));
});

test("at most `max` passes: one that hasn't settled shows where it got to", () => {
  const out = computeRows(schema, rows, { iteration: { max: 2, change: 0 } }).rows[0]!;
  assert.ok(typeof out.total === "number" && (out.total as number) < 1000);
});

test("a table asks for it in its meta, and a view works it out so", () => {
  const table: ParsedTable = { schema, rows, views: [{ id: "v", name: "All", layout: "table" }], meta: { iteration: { max: 100, change: 0.001 } } };
  assert.ok(Math.abs((applyView(table, table.views[0]!)[0]!.total as number) - 1000) < 0.01);
});
