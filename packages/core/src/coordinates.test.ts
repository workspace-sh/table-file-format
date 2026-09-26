// Coordinates (D29, D34): typed and shown against a grid, never stored.

import { test } from "node:test";
import assert from "node:assert/strict";

import { columnLetter, compileFormula, coordinateOf, printFormula, type Grid } from "./formula.js";

// A sheet: item | jan | feb | mar | quarter, rows in view order.
const columns = ["item", "jan", "feb", "mar", "quarter"];
const rows = ["rent", "food", "travel", "fun", "savings", "other", "income"];
const inRow = (here: string): Grid => ({ columns, rows, here });
const header: Grid = { columns, rows };

test("columns are lettered as a spreadsheet letters them", () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter), ["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  assert.equal(coordinateOf("feb", "food", header), "C2");
  assert.equal(coordinateOf("feb", "gone", header), null);
});

test("coordinates in the row being edited become field names: fill-down", () => {
  const r = compileFormula("=B2+C2+D2", { fields: columns, grid: inRow("food") });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.stored, "(+ jan feb mar)");
});

test("a coordinate in another row is stored as that row's id, so it's absolute", () => {
  const r = compileFormula("=E2/E7", { fields: columns, grid: inRow("food") });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.stored, '(/ quarter (field "quarter" "income"))');
});

test("in a column header there's no row being edited, so every coordinate is absolute", () => {
  const r = compileFormula("=E7", { fields: columns, grid: header });
  assert.ok(r.ok);
  assert.equal(r.stored, '(field "quarter" "income")');
});

test("shown back as coordinates, wherever the rows are now", () => {
  const stored = '(/ quarter (field "quarter" "income"))';
  assert.equal(printFormula(stored, { grid: inRow("food") }), "=E2 / E7");
  // Sorted: income is now first, food third. Same formula, new coordinates.
  const sorted: Grid = { columns, rows: ["income", "rent", "food", "travel", "fun", "savings", "other"], here: "food" };
  assert.equal(printFormula(stored, { grid: sorted }), "=E3 / E1");
  // The header shows names for this row, coordinates for another.
  assert.equal(printFormula(stored, { grid: header }), "=quarter / E7");
  // Filtered out of view: named instead, so it stays editable.
  assert.equal(printFormula(stored, { grid: { columns, rows: ["food"], here: "food" } }), '=E1 / field("quarter", "income")');
});

test("what's typed and what's shown round-trip", () => {
  for (const typed of ["=B2+C2+D2", "=E2 / E7", "=round(E2 / E7, 2)"]) {
    const grid = inRow("food");
    const r = compileFormula(typed, { fields: columns, grid });
    assert.ok(r.ok, typed);
    const back = compileFormula(printFormula(r.stored, { grid }), { fields: columns, grid });
    assert.ok(back.ok);
    assert.equal(back.stored, r.stored, typed);
  }
});

test("a coordinate outside the sheet is refused, with the sheet's extent", () => {
  const r = compileFormula("=H2", { fields: columns, grid: inRow("food") });
  assert.ok(!r.ok);
  assert.match(r.message, /^H2 is outside this sheet, which runs from A1 to E7\.$/);
  assert.ok(!compileFormula("=B8", { fields: columns, grid: inRow("food") }).ok);
});

test("without a grid a coordinate is refused, as before", () => {
  const r = compileFormula("=B2", { fields: columns });
  assert.ok(!r.ok);
  assert.match(r.message, /looks like a cell address/);
});

test("a field that happens to be named like a cell is still the field", () => {
  const r = compileFormula("=q1 * 2", { fields: ["q1"], grid: { columns: ["q1"], rows: ["a"], here: "a" } });
  assert.ok(r.ok);
  assert.equal(r.stored, "(* q1 2)");
});
