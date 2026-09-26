// The shop fixture (shop.table, D37): four linked tables, with formulas
// reading across them, up to two tables deep. The expected values were
// worked out independently of the evaluator, from the fixture's own rows,
// when the fixture was written.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows } from "./expr.js";
import { fixtureBundles } from "./test-fixtures.js";
import type { ParsedTable, Row } from "./types.js";

async function shop(): Promise<Record<string, ParsedTable>> {
  return (await fixtureBundles()).shop!.tables;
}

function computed(tables: Record<string, ParsedTable>, name: string): Row[] {
  const { rows, diagnostics } = computeRows(tables[name]!.schema, tables[name]!.rows, { tables, self: name });
  assert.deepEqual(diagnostics, [], name);
  return rows;
}

const by = (rows: Row[], field: string) => Object.fromEntries(rows.map((r) => [r.id, r[field]]));

test("an order line looks up its product's price and works out its total", async () => {
  const lines = computed(await shop(), "lines");
  const first = lines.find((r) => r.id === "li-01")!;
  assert.equal(first.unit_price, 8.5);
  assert.equal(first.line_total, 17);
});

test("an order totals its lines, then adds shipping", async () => {
  const orders = computed(await shop(), "orders");
  assert.deepEqual(by(orders, "total"), {"or-1001": 32.5, "or-1002": 100.0, "or-1003": 22.0, "or-1004": 52.5, "or-1005": 29.0, "or-1006": 31.5, "or-1007": 46.0, "or-1008": 78.0, "or-1009": 84.0, "or-1010": 31.5, "or-1011": 19.5, "or-1012": 21.5, "or-1013": 65.0, "or-1014": 85.0});
  assert.deepEqual(by(orders, "items"), {"or-1001": 3, "or-1002": 3, "or-1003": 3, "or-1004": 1, "or-1005": 3, "or-1006": 3, "or-1007": 4, "or-1008": 2, "or-1009": 3, "or-1010": 4, "or-1011": 2, "or-1012": 2, "or-1013": 6, "or-1014": 3});
  assert.equal(orders.find((r) => r.id === "or-1001")!.city, "Manchester");
});

test("a customer's lifetime value sums their orders' totals, two tables deep", async () => {
  const customers = computed(await shop(), "customers");
  assert.deepEqual(by(customers, "lifetime_value"), {"cu-ada": 116.5, "cu-ben": 43.5, "cu-chloe": 211.0, "cu-dev": 114.0, "cu-ewa": 31.5, "cu-finn": 78.0, "cu-grace": 84.0, "cu-hugo": 19.5});
  assert.deepEqual(by(customers, "order_count"), {"cu-ada": 3, "cu-ben": 2, "cu-chloe": 3, "cu-dev": 2, "cu-ewa": 1, "cu-finn": 1, "cu-grace": 1, "cu-hugo": 1});
});

test("a product's units sold and revenue come from every line for it", async () => {
  const products = computed(await shop(), "products");
  assert.deepEqual(by(products, "units_sold"), {"pr-decaf": 3, "pr-earl": 4, "pr-ethiopia": 5, "pr-grinder": 3, "pr-house": 10, "pr-kettle": 2, "pr-mug": 7, "pr-sencha": 3, "pr-tote": 3, "pr-v60": 2});
  assert.deepEqual(by(products, "revenue"), {"pr-decaf": 27.0, "pr-earl": 22.0, "pr-ethiopia": 55.0, "pr-grinder": 195.0, "pr-house": 85.0, "pr-kettle": 98.0, "pr-mug": 84.0, "pr-sencha": 19.5, "pr-tote": 28.5, "pr-v60": 48.0});
});

test("the shop's orders and its customers agree on the grand total", async () => {
  const tables = await shop();
  const sum = (rows: Row[], f: string) => rows.reduce((a, r) => a + (r[f] as number), 0);
  assert.equal(sum(computed(tables, "orders"), "total"), 698.0);
  assert.equal(sum(computed(tables, "customers"), "lifetime_value"), 698.0);
});
