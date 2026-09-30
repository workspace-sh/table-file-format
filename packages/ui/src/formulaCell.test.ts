import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows, sheetOrder } from "@workspace.sh/table-core";
import { tables } from "@workspace.sh/table-fixtures";
import { explainFormula, formulaDraftOf, formulaInputCells, formulaStatus, viewGrid } from "./formulaCell";

const budget = tables["budget"]!;
const ledger = tables["ledger"]!;
const field = (t: typeof budget, name: string) => t.schema.fields.find((f) => f.name === name)!;
const shown = (t: typeof budget, id: string) => computeRows(t.schema, t.rows, {}).rows.find((r) => r.id === id)!;

test("a formula lists what it read in this row and, by name, in another", () => {
  const rent = shown(budget, budget.rows[0]!.id);
  const income = budget.rows.find((r) => r.category === "Income")!;
  const e = explainFormula({ field: field(budget, "share"), row: rent, fields: budget.schema.fields, draft: "", editable: false, allRows: budget.rows });
  assert.equal(e.compiled, null);
  assert.deepEqual(e.thisRow.map((i) => i.field), ["quarter"]);
  assert.equal(e.otherRows.length, 1);
  assert.equal(e.otherRows[0]!.rowId, income.id);
  assert.equal(e.otherRows[0]!.value, shown(budget, income.id).quarter);
  assert.match(e.otherRows[0]!.label, /of row/);
  // Naming its own row by id is still this row.
  const own = explainFormula({ field: field(budget, "share"), row: rent, fields: budget.schema.fields, draft: `(field "jan" "${rent.id}")`, editable: true });
  assert.deepEqual(own.thisRow.map((i) => i.field), ["jan"]);
  assert.equal(own.otherRows.length, 0);
});

test("a changed formula previews this row's value and says what saving stores", () => {
  const rent = shown(budget, budget.rows[0]!.id);
  const f = field(budget, "quarter");
  const e = explainFormula({ field: f, row: rent, fields: budget.schema.fields, draft: "(* jan 3)", editable: true, allRows: budget.rows });
  assert.equal(e.changed, true);
  assert.equal(e.preview?.value, (rent.jan as number) * 3);
  assert.deepEqual(e.save, { computed: { expr: "(* jan 3)", dialect: "table-expr-v1" } });
  const same = explainFormula({ field: f, row: rent, fields: budget.schema.fields, draft: formulaDraftOf(f, undefined, "stored"), editable: true });
  assert.equal(same.changed, false);
  assert.equal(same.save, undefined);
});

test("a formula that doesn't compile says why; one that does shows its stored form when typed differently", () => {
  const e = explainFormula({ field: field(budget, "quarter"), row: shown(budget, budget.rows[0]!.id), fields: budget.schema.fields, draft: "(+ jan", editable: true });
  assert.equal(e.status?.kind, "error");
  assert.equal(e.save, undefined);
  const ok = explainFormula({ field: field(budget, "quarter"), row: shown(budget, budget.rows[0]!.id), fields: budget.schema.fields, draft: "=jan+feb", editable: true });
  assert.deepEqual(formulaStatus(ok.compiled!, "=jan+feb"), { kind: "ok", warnings: [], storedAs: "(+ jan feb)" });
});

test("by place in a Sheet view, the row above's balance is outlined for this row", () => {
  const view = ledger.views.find((v) => v.id === "by-date")!;
  const order = sheetOrder(ledger, "by-date")!.ids;
  const second = order[1]!;
  const cells = formulaInputCells(field(ledger, "balance"), second, view, view.fields!, order);
  assert.ok(cells.has(`${order[0]}\u0000balance`), [...cells].join(", "));
  assert.ok(cells.has(`${second}\u0000amount`));
  const grid = viewGrid(view, view.fields!, [], { order, sheets: [] });
  assert.equal(grid?.rows[0], order[0]);
  assert.equal(viewGrid({ ...view, coordinates: undefined }, view.fields!, []), undefined);
});
