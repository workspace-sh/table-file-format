import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable, Row, View } from "@workspace.sh/table-core";
import { formulaRefs, parseExpr } from "@workspace.sh/table-core";
import { canInsertAt, insertRowAt, placeCells, sheetDependents, sheetDirectory } from "./sheets.ts";

const rows: Row[] = [
  { id: "a", date: "2026-03-01", kind: "food", amount: 3 },
  { id: "b", date: "2026-01-01", kind: "rent", amount: 1 },
  { id: "c", date: "2026-02-01", kind: "food", amount: 2 },
];
const byDate: View = { id: "by-date", name: "By date", layout: "table", coordinates: true, sort: [{ field: "date", direction: "asc" }] };
const plain: View = { id: "all", name: "All", layout: "table" };
const ledger: ParsedTable = {
  schema: {
    fields: [
      { name: "date", type: "date" },
      { name: "kind", type: "string" },
      { name: "amount", type: "number" },
      { name: "balance", type: "number", computed: { dialect: "table-expr-v1", expr: '(sum (at "balance" -1 "by-date") amount)' } },
    ],
  },
  rows,
  views: [plain, byDate],
  meta: { title: "Ledger" },
};
const deals: ParsedTable = {
  schema: { fields: [{ name: "value", type: "number" }, { name: "total", type: "number", computed: { dialect: "table-expr-v1", expr: '(sum (range "amount" nil "amount" nil "by-date" "ledger"))' } }] },
  rows: [{ id: "d1", value: 5 }],
  views: [{ id: "pipeline", name: "Pipeline", layout: "table", coordinates: true }],
  meta: {},
};
const bundle = { ledger, deals };

test("every Sheet view, named as a formula in this table names it", () => {
  const dir = sheetDirectory(bundle, "ledger");
  assert.deepEqual(dir.map((s) => [s.name, s.view, s.table]), [["By date", "by-date", undefined], ["deals: Pipeline", "pipeline", "deals"]]);
  // Rows in the grid's order as saved: by date.
  assert.deepEqual(dir[0]!.rows, ["b", "c", "a"]);
  assert.deepEqual(dir[0]!.columns, ["date", "kind", "amount", "balance"]);
  // From the other table, the ledger's sheet carries its title.
  assert.equal(sheetDirectory(bundle, "deals")[0]!.name, "Ledger: By date");
});

test("the formulas that read a sheet by place, in any table", () => {
  assert.deepEqual(sheetDependents(bundle, "ledger", "by-date"), [
    { table: "ledger", field: "balance" },
    { table: "deals", field: "total" },
  ]);
  assert.deepEqual(sheetDependents(bundle, "deals", "pipeline"), []);
});

test("a row goes on the line above or below; a sort decides for itself", () => {
  const unsorted = { ...byDate, sort: undefined };
  assert.deepEqual(insertRowAt(rows, unsorted, "b", "above", { id: "n" })!.rows.map((r) => r.id), ["a", "n", "b", "c"]);
  assert.deepEqual(insertRowAt(rows, unsorted, "b", "below", { id: "n" })!.rows.map((r) => r.id), ["a", "b", "n", "c"]);
  assert.equal(canInsertAt(byDate), false);
  assert.equal(insertRowAt(rows, byDate, "b", "above", { id: "n" }), null);
});

test("in a manual order the row joins the order; in a group it joins the group", () => {
  const ordered: View = { ...plain, order: ["c", "a"], sort: [{ field: "date", direction: "asc" }] };
  assert.equal(canInsertAt(ordered), true);
  const placed = insertRowAt(rows, ordered, "a", "above", { id: "n" })!;
  assert.deepEqual(placed.order, ["c", "n", "a"]);
  assert.equal(placed.rows.at(-1)!.id, "n");
  const grouped: View = { ...plain, group: { field: "kind" } };
  assert.equal(insertRowAt(rows, grouped, "c", "below", { id: "n" })!.rows[3]!.kind, "food");
});

test("the cells a place covers, for outlining", () => {
  const order = ["b", "c", "a"];
  const columns = ["date", "kind", "amount"];
  const refs = (expr: string) => {
    const r = parseExpr(expr);
    assert.ok(r.ok);
    return formulaRefs(r.expr);
  };
  const [above] = refs('(at "amount" -1 "by-date")');
  assert.deepEqual(placeCells(above!, "by-date", "a", order, columns), [{ field: "amount", rowId: "c" }]);
  assert.deepEqual(placeCells(above!, "by-date", "b", order, columns), []);
  const [block] = refs('(sum (range "kind" nil "amount" 0 "by-date"))');
  assert.equal(placeCells(block!, "by-date", "c", order, columns).length, 4);
  // Another sheet's cells aren't in this one.
  assert.deepEqual(placeCells(above!, "other", "a", order, columns), []);
});
