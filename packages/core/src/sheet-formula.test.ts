// Typing and showing references by place in a Sheet view (D41): Excel's
// A1 and $A$1, ranges, and other sheets, stored as `at`, `range` or a row id.

import { test } from "node:test";
import assert from "node:assert/strict";

import { compileFormula, printFormula, type Grid, type SheetRef } from "./formula.js";
import { parseExpr } from "./expr.js";

// Sheet "budget": item | jan | feb | mar | quarter, rows in grid order.
const columns = ["item", "jan", "feb", "mar", "quarter"];
const rows = ["rent", "food", "travel", "fun", "savings", "other", "income"];
const byDate: SheetRef = { name: "By date", view: "by-date", columns, rows: [...rows].reverse() };
const pipeline: SheetRef = { name: "Deals: Pipeline", view: "pipeline", table: "deals", columns: ["name", "value"], rows: ["d1", "d2", "d3"] };
const sheets = [byDate, pipeline];
// Editing row 4 ("fun") of the budget sheet.
const cell: Grid = { columns, rows, here: "fun", sheet: "budget", sheets };
// A column's header editor: no row being edited.
const header: Grid = { columns, rows, sheet: "budget", sheets };

const stored = (typed: string, grid: Grid = cell) => {
  const r = compileFormula(typed, { fields: columns, grid });
  assert.ok(r.ok, `${typed}: ${JSON.stringify(r)}`);
  return r.stored;
};
const refused = (typed: string, grid: Grid = cell) => {
  const r = compileFormula(typed, { fields: columns, grid });
  assert.ok(!r.ok, `${typed} should be refused`);
  return r.message;
};

test("in a cell, a coordinate is relative to the row being edited", () => {
  assert.equal(stored("=E3"), '(at "quarter" -1 "budget")');
  assert.equal(stored("=E4"), "quarter");
  assert.equal(stored("=E5 + E3"), '(+ (at "quarter" 1 "budget") (at "quarter" -1 "budget"))');
});

test("$ on the row pins it, by id; $ on the column alone doesn't", () => {
  assert.equal(stored("=$E$3"), '(field "quarter" "travel")');
  assert.equal(stored("=E$3"), '(field "quarter" "travel")');
  assert.equal(stored("=$E3"), '(at "quarter" -1 "budget")');
  // This row, pinned, is pinned too: it stays on "fun" wherever it moves.
  assert.equal(stored("=$E$4"), '(field "quarter" "fun")');
});

test("a column's header editor pins every coordinate, as before", () => {
  assert.equal(stored("=E3", header), '(field "quarter" "travel")');
  assert.equal(stored("=sum(E2:E3)", header), '(sum (range "quarter" "food" "quarter" "travel" "budget"))');
});

test("ranges: relative, pinned at one end, whole columns, blocks", () => {
  assert.equal(stored("=sum(E2:E3)"), '(sum (range "quarter" -2 "quarter" -1 "budget"))');
  assert.equal(stored("=sum($E$1:E4)"), '(sum (range "quarter" "rent" "quarter" 0 "budget"))');
  assert.equal(stored("=sum(E:E)"), '(sum (range "quarter" nil "quarter" nil "budget"))');
  assert.equal(stored("=sum($E:$E)"), '(sum (range "quarter" nil "quarter" nil "budget"))');
  assert.equal(stored("=sum(B2:D3)"), '(sum (range "jan" -2 "mar" -1 "budget"))');
  assert.match(refused("=sum(E2:E)"), /two cells, like C2:C6, or two columns/);
});

test("another sheet is named and pinned", () => {
  // By date runs the other way: its row 1 is "income".
  assert.equal(stored("='By date'!E1"), '(at "quarter" "income" "by-date")');
  assert.equal(stored("='by DATE'!E1"), '(at "quarter" "income" "by-date")');
  assert.equal(stored("=sum('Deals: Pipeline'!B:B)"), '(sum (range "value" nil "value" nil "pipeline" "deals"))');
  assert.equal(stored("=sum('Deals: Pipeline'!B1:B2)"), '(sum (range "value" "d1" "value" "d2" "pipeline" "deals"))');
});

test("a sheet that isn't there, or two with one name, is refused", () => {
  assert.match(refused("='Gone'!A1"), /There's no sheet called 'Gone'/);
  const twice: Grid = { ...cell, sheets: [byDate, { ...byDate, view: "other" }] };
  assert.match(refused("='By date'!A1", twice), /More than one sheet is called 'By date'/);
  assert.match(refused("='By date'!Z1"), /outside 'By date', which runs from A1 to E7/);
});

test("shown back: renaming a sheet changes only how it's shown", () => {
  const s = '(at "quarter" "income" "by-date")';
  assert.equal(printFormula(s, { grid: cell }), "='By date'!E1");
  const renamed: Grid = { ...cell, sheets: [{ ...byDate, name: "Chronological" }] };
  assert.equal(printFormula(s, { grid: renamed }), "='Chronological'!E1");
  // Deleted: shown as what's stored, which reads as #REF!.
  assert.equal(printFormula(s, { grid: { ...cell, sheets: [] } }), '=at("quarter", "income", "by-date")');
});

test("shown back as it's typed: relative, $-pinned, ranges", () => {
  assert.equal(printFormula('(at "quarter" -1 "budget")', { grid: cell }), "=E3");
  assert.equal(printFormula('(field "quarter" "travel")', { grid: cell }), "=$E$3");
  assert.equal(printFormula('(field "quarter" "travel")', { grid: header }), "=E3");
  assert.equal(printFormula('(sum (range "quarter" "rent" "quarter" 0 "budget"))', { grid: cell }), "=sum($E$1:E4)");
  assert.equal(printFormula('(sum (range "quarter" nil "quarter" nil "budget"))', { grid: cell }), "=sum(E:E)");
  // What the grid can't show is shown as the function, which compiles back.
  assert.equal(printFormula('(at "quarter" -9 "budget")', { grid: cell }), '=at("quarter", -9, "budget")');
  assert.equal(printFormula('(at "quarter" -1 "budget")', { grid: header }), '=at("quarter", -1, "budget")');
  assert.equal(printFormula('(sum (range "quarter" nil "quarter" -1 "budget"))', { grid: cell }), '=sum(range("quarter", nil, "quarter", -1, "budget"))');
});

test("row and rows read where a cell is", () => {
  assert.equal(stored("=row()"), '(row (at "item" 0 "budget"))');
  assert.equal(stored("=row(E3)"), '(row (at "quarter" -1 "budget"))');
  assert.equal(stored("=row($E$1)"), '(row (at "quarter" "rent" "budget"))');
  assert.equal(stored("=rows(E:E)"), '(rows (range "quarter" nil "quarter" nil "budget"))');
});

test("Grist's $name is still a field", () => {
  const r = compileFormula("=$total * 2", { fields: ["total"], grid: { columns: ["total"], rows: ["a"], here: "a", sheet: "s" } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.stored, "(* total 2)");
});

test("every typed form round-trips through what's shown", () => {
  const forms = [
    "=E3", "=E4", "=E5", "=$E$3", "=E$3 + 1", "=sum(E2:E3)", "=sum($E$1:E4)", "=sum(E:E)", "=sum(B2:D3)",
    "='By date'!E1", "=sum('Deals: Pipeline'!B:B)", "=row()", "=rows(E:E)", "=round(E3 / $E$7, 2)",
    '=at("quarter", -9, "budget")', '=sum(range("quarter", nil, "quarter", -1, "budget"))',
  ];
  for (const grid of [cell, header]) {
    for (const typed of forms) {
      const r = compileFormula(typed, { fields: columns, grid });
      if (!r.ok) continue;
      const shown = printFormula(r.stored, { grid });
      const back = compileFormula(shown, { fields: columns, grid });
      assert.ok(back.ok, `${typed} → ${shown}: ${JSON.stringify(back)}`);
      assert.equal(back.stored, r.stored, `${typed} → ${shown}`);
      assert.ok(parseExpr(r.stored).ok);
    }
  }
});
