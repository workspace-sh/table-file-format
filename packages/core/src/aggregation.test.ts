// Reading across rows and tables (D36, #96): column, lookup, linked, and
// the aggregates over them. The expected values were first pinned, worked
// out by hand, as todo tests; now the formulas in the fixtures produce them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FormulaError } from "./expr.js";
import { computeRows } from "./workbook.js";
import { fixtureBundles, fixtureTable } from "./test-fixtures.js";
import type { ParsedTable, Row, TableSchema } from "./types.js";

const fixture = fixtureTable;

/** The CRM bundle's tables: relations resolve within it (D37). */
async function crm(): Promise<Record<string, ParsedTable>> {
  return (await fixtureBundles()).crm!.tables;
}
const byId = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

test("rollup: a company's open pipeline sums the open deals that link to it", async () => {
  const tables = await crm();
  const { rows } = computeRows(tables.companies!.schema, tables.companies!.rows, { tables, self: "companies" });
  const pipeline = Object.fromEntries(rows.map((r) => [r.id, r.open_pipeline]));
  assert.deepEqual(pipeline, {
    "co-northwind": 64000,
    "co-lumen": 22000,
    "co-atlas": 430000,
    "co-quill": 0,
    "co-tidal": 104000,
    "co-fern": 4800,
  });
  assert.equal(byId(rows, "co-atlas").deal_count, 2);
  assert.equal(byId(rows, "co-quill").deal_count, 1);
});

test("lookup: a deal shows its company's industry", async () => {
  const tables = await crm();
  const { rows } = computeRows(tables.deals!.schema, tables.deals!.rows, { tables, self: "deals" });
  assert.equal(byId(rows, "dl-1").industry, "Logistics");
  assert.equal(byId(rows, "dl-4").industry, "Energy");
});

test("column total: the pipeline's total value", async () => {
  const deals = await fixture("deals");
  const schema: TableSchema = {
    fields: [...deals.schema.fields, { name: "total", type: "number", computed: { expr: '(sum (column "value"))', dialect: "table-expr-v1" } }],
  };
  assert.equal(computeRows(schema, deals.rows).rows[0]!.total, 732800);
});

test("sheet: each line's share of the quarter's total spending", async () => {
  const budget = await fixture("budget");
  const { rows } = computeRows(budget.schema, budget.rows);
  const schema: TableSchema = {
    fields: [...budget.schema.fields, { name: "total", type: "number", computed: { expr: '(sum (column "spend"))', dialect: "table-expr-v1" } }],
  };
  assert.equal(computeRows(schema, budget.rows).rows[0]!.total, 8313);
  assert.equal(Math.round(Number(byId(rows, "rent").of_spending) * 1000) / 1000, 0.523);
  // Income isn't spending: its share is left empty.
  assert.equal(byId(rows, "income").of_spending, undefined);
});

test("count and average skip blanks, and take lists as spreadsheets take ranges", () => {
  const schema: TableSchema = {
    fields: [
      { name: "n", type: "number" },
      { name: "c", type: "number", computed: { expr: '(count (column "n"))', dialect: "table-expr-v1" } },
      { name: "a", type: "number", computed: { expr: '(average (column "n"))', dialect: "table-expr-v1" } },
      { name: "bad", type: "number", computed: { expr: '(+ 1 (column "n"))', dialect: "table-expr-v1" } },
    ],
  };
  const { rows } = computeRows(schema, [{ id: "x", n: 2 }, { id: "y" }, { id: "z", n: 6 }]);
  assert.equal(rows[0]!.c, 2);
  assert.equal(rows[0]!.a, 4);
  assert.ok(rows[0]!.bad instanceof FormulaError);
  assert.equal((rows[0]!.bad as FormulaError).code, "#VALUE!");
});

test("without the other tables, lookup and linked say so (#REF!), they don't guess", async () => {
  const deals = await fixture("deals");
  const { rows } = computeRows(deals.schema, deals.rows);
  const v = byId(rows, "dl-1").industry;
  assert.ok(v instanceof FormulaError);
  assert.equal((v as FormulaError).code, "#REF!");
});

test("tables that look each other up don't loop", () => {
  const a: ParsedTable = {
    path: "a",
    schema: {
      fields: [
        { name: "b", type: "string", relation: { table: "b", field: "id" } },
        { name: "n", type: "number" },
        { name: "from_b", type: "number", computed: { expr: '(lookup "b" "from_a")', dialect: "table-expr-v1" } },
      ],
    },
    rows: [{ id: "a1", b: "b1", n: 5 }],
    views: [],
    meta: {},
  };
  const b: ParsedTable = {
    path: "b",
    schema: {
      fields: [
        { name: "a", type: "string", relation: { table: "a", field: "id" } },
        { name: "from_a", type: "number", computed: { expr: '(lookup "a" "n")', dialect: "table-expr-v1" } },
      ],
    },
    rows: [{ id: "b1", a: "a1" }],
    views: [],
    meta: {},
  };
  const tables = { a, b };
  const { rows } = computeRows(a.schema, a.rows, { tables, self: "a" });
  // b's formula reads a as stored (a is being computed), so it sees n = 5.
  assert.equal(rows[0]!.from_b, 5);
});

/** Two or three small tables, each a relation and some fields. */
function table(path: string, fields: TableSchema["fields"], rows: Row[]): ParsedTable {
  return { path, schema: { fields }, rows, views: [], meta: {} };
}
const f = (expr: string) => ({ computed: { expr, dialect: "table-expr-v1" } });

test("a lookup of another table's rollup of this table computes (#123)", async () => {
  // Deals looks up its company's open pipeline, which totals the open
  // deals: Deals depends on Companies depends on Deals, field by field,
  // but no field depends on itself.
  const tables = await crm();
  const { rows } = computeRows(tables.deals!.schema, tables.deals!.rows, { tables, self: "deals" });
  assert.equal(byId(rows, "dl-1").company_pipeline, 430000);
  assert.equal(byId(rows, "dl-4").company_pipeline, 104000);
});

test("a real loop across two tables is #REF!, not a hang", () => {
  const a = table(
    "a",
    [
      { name: "b", type: "string", relation: { table: "b", field: "id" } },
      { name: "x", type: "number", ...f('(lookup "b" "y")') },
    ],
    [{ id: "a1", b: "b1" }],
  );
  const b = table(
    "b",
    [
      { name: "a", type: "string", relation: { table: "a", field: "id" } },
      { name: "y", type: "number", ...f('(lookup "a" "x")') },
    ],
    [{ id: "b1", a: "a1" }],
  );
  const { rows } = computeRows(a.schema, a.rows, { tables: { a, b }, self: "a" });
  const v = rows[0]!.x;
  assert.ok(v instanceof FormulaError, String(v));
  assert.equal((v as FormulaError).code, "#REF!");
});

test("a three-table chain computes, each value once", () => {
  // Orders total their lines; customers total their orders; each line
  // reads its customer's lifetime value back: a long way round, no loop.
  const lines = table(
    "lines",
    [
      { name: "order", type: "string", relation: { table: "orders", field: "id" } },
      { name: "amount", type: "number" },
      { name: "customer_value", type: "number", ...f('(lookup "order" "customer_value")') },
    ],
    [
      { id: "l1", order: "o1", amount: 10 },
      { id: "l2", order: "o1", amount: 5 },
      { id: "l3", order: "o2", amount: 7 },
    ],
  );
  const orders = table(
    "orders",
    [
      { name: "customer", type: "string", relation: { table: "customers", field: "id" } },
      { name: "total", type: "number", ...f('(sum (linked "lines" "order" "amount"))') },
      { name: "customer_value", type: "number", ...f('(lookup "customer" "value")') },
    ],
    [
      { id: "o1", customer: "c1" },
      { id: "o2", customer: "c1" },
    ],
  );
  const customers = table(
    "customers",
    [{ name: "value", type: "number", ...f('(sum (linked "orders" "customer" "total"))') }],
    [{ id: "c1" }],
  );
  const tables = { lines, orders, customers };
  const { rows } = computeRows(lines.schema, lines.rows, { tables, self: "lines" });
  assert.deepEqual(
    rows.map((r) => r.customer_value),
    [22, 22, 22],
  );
});
