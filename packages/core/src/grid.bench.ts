/**
 * How long a Sheet view's grid and a running total take (D41, #126).
 * Run: node --import tsx src/grid.bench.ts
 * Budget: under 1 s at 1,000,000 rows; target about 135 ms for the grid.
 */

import { computeRows, sheetGrid } from "./workbook.js";
import type { ParsedTable, Row, TableSchema, View } from "./types.js";

const view: View = { id: "by-date", name: "By date", layout: "table", coordinates: true, sort: [{ field: "date", direction: "asc" }] };

const plain: TableSchema = {
  fields: [
    { name: "date", type: "string" },
    { name: "amount", type: "number" },
  ],
};
const running: TableSchema = {
  fields: [
    ...plain.fields,
    { name: "balance", type: "number", computed: { dialect: "table-expr-v1", expr: '(sum (at "balance" -1 "by-date") amount)' } },
  ],
};

function rows(n: number): Row[] {
  // Shuffled, so the sort does real work.
  const out: Row[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `r${i}`, date: `d${String((i * 7919) % n).padStart(7, "0")}`, amount: i % 100 });
  return out;
}

function time(label: string, work: () => void): number {
  const start = performance.now();
  work();
  const ms = performance.now() - start;
  console.log(`${label.padEnd(40)} ${ms.toFixed(1).padStart(8)} ms`);
  return ms;
}

for (const n of [10_000, 50_000, 1_000_000]) {
  const data = rows(n);
  const table = (schema: TableSchema): ParsedTable => ({ schema, rows: data, views: [view], meta: {} });
  console.log(`\n${n.toLocaleString("en")} rows`);
  time("grid: sort and number (no formulas)", () => sheetGrid(table(plain), "by-date"));
  time("running balance down the grid", () => computeRows(running, data, { views: [view] }));
}
