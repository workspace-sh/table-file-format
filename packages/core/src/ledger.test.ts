// The household budget's ledger (D41): a running balance read by place
// down the "By date" Sheet view, while the rows sit in the file in the
// order they were entered. The expected balances were worked out by hand
// from the fixture's rows, in date order, when the fixture was written.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows, sheetGrid } from "./workbook.js";
import { fixtureBundles } from "./test-fixtures.js";

async function budget() {
  return (await fixtureBundles())["household-budget"]!.tables;
}

test("ledger balances run down by date, not as entered", async () => {
  const tables = await budget();
  const { rows, diagnostics } = computeRows(tables.ledger!.schema, tables.ledger!.rows, { tables, self: "ledger" });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.balance])), {
    opening: 1200,
    "salary-jan": 2798,
    "rent-jan": -250,
    "groceries-jan": -660,
    "energy-jan": -802,
    "rent-feb": 1348,
    "salary-feb": 4688,
    "transport-feb": 1183,
    "eating-feb": 1088,
    "savings-feb": 4188,
  });
});

test("the By date sheet numbers the rows by date", async () => {
  const tables = await budget();
  const grid = sheetGrid(tables.ledger!, "by-date", { tables, self: "ledger" })!;
  assert.deepEqual(grid.rows.map((r) => r.id), [
    "opening", "rent-jan", "groceries-jan", "energy-jan", "salary-jan",
    "rent-feb", "transport-feb", "eating-feb", "salary-feb", "savings-feb",
  ]);
  assert.equal(grid.rows.at(-1)!.balance, 4188);
  assert.equal(grid.loop, false);
});
