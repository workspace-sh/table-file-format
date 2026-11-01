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
    "z4bfkjkfy5csqpyjgrj8ctqz4o": 1200,
    "xzit1mrr1mgoiqo6ee5aon4c7f": 2798,
    "zc97gcrezrrayob3mtz7c6miqa": -250,
    "kwmndi1coeyj44ui3fba8xm1ya": -660,
    "3agkc9teunqagz4t4x63z8mphm": -802,
    "3k3n65mn4hi5p193ofrhrxk58d": 1348,
    "8qu3wjyhxcy94ow8ecekqjrrt3": 4688,
    "j6xmp5j9wkexyaesqa5uaiwqbb": 1183,
    "e5sjrefsnss7c8xgbjmcwtgeqy": 1088,
    "6834q711q9jsjuo5785dcq14sr": 4188,
  });
});

test("the By date sheet numbers the rows by date", async () => {
  const tables = await budget();
  const grid = sheetGrid(tables.ledger!, "87jkeekgwbfgr", { tables, self: "ledger" })!;
  assert.deepEqual(grid.rows.map((r) => r.id), [
    "z4bfkjkfy5csqpyjgrj8ctqz4o", "zc97gcrezrrayob3mtz7c6miqa", "kwmndi1coeyj44ui3fba8xm1ya", "3agkc9teunqagz4t4x63z8mphm", "xzit1mrr1mgoiqo6ee5aon4c7f",
    "3k3n65mn4hi5p193ofrhrxk58d", "j6xmp5j9wkexyaesqa5uaiwqbb", "e5sjrefsnss7c8xgbjmcwtgeqy", "8qu3wjyhxcy94ow8ecekqjrrt3", "6834q711q9jsjuo5785dcq14sr",
  ]);
  assert.equal(grid.rows.at(-1)!.balance, 4188);
  assert.equal(grid.loop, false);
});
