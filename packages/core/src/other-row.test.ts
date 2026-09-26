// A formula that reads another row (D34): how a coordinate like =B7 is
// stored, as the field plus the row's id, so no sort or filter moves it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows, FormulaError, parseExpr } from "./expr.js";
import { compileFormula, formulaFields, formulaRefs, printFormula } from "./formula.js";
import { applyView } from "./query.js";
import type { ParsedTable, Row, TableSchema } from "./types.js";

const schema: TableSchema = {
  fields: [
    { name: "item", type: "string" },
    { name: "q1", type: "number" },
    { name: "share", type: "number", computed: { expr: '(/ q1 (field "q1" "income"))', dialect: "table-expr-v1" } },
  ],
};
const rows: Row[] = [
  { id: "rent", item: "Rent", q1: 3000 },
  { id: "food", item: "Food", q1: 1200 },
  { id: "income", item: "Income", q1: 12000 },
];
const shareOf = (out: Row[], id: string) => out.find((r) => r.id === id)!.share;

test("a formula reads another row's field by that row's id", () => {
  const { rows: out } = computeRows(schema, rows);
  assert.equal(shareOf(out, "rent"), 0.25);
  assert.equal(shareOf(out, "food"), 0.1);
  assert.equal(shareOf(out, "income"), 1);
});

test("sorting or filtering rows never changes what it reads", () => {
  const table: ParsedTable = { path: "t", schema, rows, views: [], meta: {} };
  const sorted = applyView(table, { id: "v", name: "v", layout: "table", sort: [{ field: "q1", direction: "asc" }] });
  assert.deepEqual(sorted.map((r) => r.id), ["food", "rent", "income"]);
  assert.equal(shareOf(sorted, "rent"), 0.25);
  const filtered = applyView(table, { id: "v", name: "v", layout: "table", filter: [{ field: "item", operator: "neq", value: "Income" }] });
  // The income row is filtered out of view but still there to read.
  assert.equal(shareOf(filtered, "food"), 0.1);
});

test("a row that isn't there is #REF!, as a deleted row is in a spreadsheet", () => {
  const { rows: out } = computeRows(schema, rows.filter((r) => r.id !== "income"));
  const v = shareOf(out, "rent");
  assert.ok(v instanceof FormulaError);
  assert.equal((v as FormulaError).code, "#REF!");
});

test("a loop that runs across rows is #REF!, not a hang", () => {
  const looped: TableSchema = {
    fields: [
      { name: "a", type: "number", computed: { expr: '(+ 1 (field "a" "r2"))', dialect: "table-expr-v1" } },
    ],
  };
  const { rows: out } = computeRows(looped, [{ id: "r1" }, { id: "r2" }]);
  for (const r of out) {
    assert.ok(r.a instanceof FormulaError, JSON.stringify(r));
    assert.equal((r.a as FormulaError).code, "#REF!");
  }
});

test("another row's computed field is computed once and reused", () => {
  const chained: TableSchema = {
    fields: [
      { name: "n", type: "number" },
      { name: "double", type: "number", computed: { expr: "(* n 2)", dialect: "table-expr-v1" } },
      { name: "vs_base", type: "number", computed: { expr: '(- double (field "double" "base"))', dialect: "table-expr-v1" } },
    ],
  };
  const { rows: out } = computeRows(chained, [{ id: "base", n: 5 }, { id: "x", n: 8 }]);
  assert.equal(out.find((r) => r.id === "x")!.vs_base, 6);
  assert.equal(out.find((r) => r.id === "base")!.vs_base, 0);
});

test("typed as field(\"q1\", \"income\") or in the stored form, it's stored the same way", () => {
  const excel = compileFormula('=q1 / field("q1", "income")', { fields: ["q1"] });
  const stored = compileFormula('(/ q1 (field "q1" "income"))', { fields: ["q1"] });
  assert.ok(excel.ok && stored.ok);
  assert.equal(excel.stored, '(/ q1 (field "q1" "income"))');
  assert.equal(stored.stored, excel.stored);
  // q1 looks like a cell address (column Q, row 1), so it prints braced as a field.
  assert.equal(printFormula(excel.stored), '={q1} / field("q1", "income")');
});

test("a missing field in another row is warned about, as in this row", () => {
  const r = compileFormula('=field("qq", "income")', { fields: ["q1"] });
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, ["There is no field called “qq”, so the result will show #NAME?."]);
});

test("formulaRefs says which row each input is in", () => {
  const r = parseExpr('(/ q1 (field "q1" "income"))');
  assert.ok(r.ok);
  assert.deepEqual(formulaRefs(r.expr), [{ field: "q1" }, { field: "q1", rowId: "income" }]);
  assert.deepEqual(formulaFields(r.expr), ["q1"]);
});
