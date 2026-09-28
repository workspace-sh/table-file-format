import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows, sheetGrid } from "./workbook.js";
import { parseExpr } from "./expr.js";
import type { Field, ParsedTable, Row, View } from "./types.js";

// Reading by place in a Sheet view (SPEC section 2, "References by place"; D41).

const byDate: View = { id: "by-date", name: "By date", layout: "table", coordinates: true, sort: [{ field: "date", direction: "asc" }] };

// File order isn't date order, so every answer here depends on the grid.
const ledger: Row[] = [
  { id: "l3", date: "2026-03-01", amount: 30, a: 1, b: 2, c: 3 },
  { id: "l1", date: "2026-01-01", amount: 10, a: 4, b: 5, c: 6 },
  { id: "l2", date: "2026-02-01", amount: 20, a: 7, b: 8, c: 9 },
];

const fields: Field[] = [
  { name: "date", type: "date" },
  { name: "amount", type: "number" },
  { name: "a", type: "number" },
  { name: "b", type: "number" },
  { name: "c", type: "number" },
];

function compute(expr: string, views: View[] = [byDate], rows: Row[] = ledger) {
  const schema = { fields: [...fields, { name: "out", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr } }] };
  const out = computeRows(schema, rows, { views }).rows;
  return Object.fromEntries(out.map((r) => [r.id, r.out instanceof Object && "code" in (r.out as object) ? String(r.out) : r.out]));
}

test("the row above, in the Sheet view's order", () => {
  assert.deepEqual(compute('(at "amount" -1 "by-date")'), { l1: undefined, l2: 10, l3: 20 });
});

test("a place off the grid reads as empty", () => {
  assert.deepEqual(compute('(at "amount" 1 "by-date")'), { l1: 20, l2: 30, l3: undefined });
});

test("a running balance runs down the Sheet view", () => {
  const schema = {
    fields: [...fields, { name: "balance", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "balance" -1 "by-date") amount)' } }],
  };
  const out = computeRows(schema, ledger, { views: [byDate] }).rows;
  assert.deepEqual(Object.fromEntries(out.map((r) => [r.id, r.balance])), { l1: 10, l2: 30, l3: 60 });
});

test("a range from a pinned row down to this row", () => {
  assert.deepEqual(compute('(sum (range "amount" "l1" "amount" 0 "by-date"))'), { l1: 10, l2: 30, l3: 60 });
});

test("a block across columns, like B2:D3", () => {
  // Rows 2 and 3 by date are l2 and l3; columns a to c.
  assert.equal(compute('(sum (range "a" "l2" "c" "l3" "by-date"))').l1, 7 + 8 + 9 + 1 + 2 + 3);
  // Corners either way round name the same block.
  assert.equal(compute('(sum (range "c" "l3" "a" "l2" "by-date"))').l1, 30);
});

test("a whole column, like C:C", () => {
  assert.deepEqual(compute('(sum (range "amount" nil "amount" nil "by-date"))'), { l1: 60, l2: 60, l3: 60 });
  assert.deepEqual(compute('(count (range "amount" nil "amount" -1 "by-date"))'), { l1: 0, l2: 1, l3: 2 });
});

test("row and rows read where, never what", () => {
  assert.deepEqual(compute('(row (at "amount" 0 "by-date"))'), { l1: 1, l2: 2, l3: 3 });
  assert.deepEqual(compute('(rows (range "amount" nil "amount" nil "by-date"))'), { l1: 3, l2: 3, l3: 3 });
  assert.deepEqual(compute('(rows (range "amount" -1 "amount" 0 "by-date"))'), { l1: 2, l2: 2, l3: 2 });
  // "The top down to the row above" has no rows in row 1.
  assert.deepEqual(compute('(rows (range "amount" nil "amount" -1 "by-date"))'), { l1: 0, l2: 1, l3: 2 });
  assert.equal(compute('(row (range "amount" nil "amount" -1 "by-date"))').l1, "#REF!");
  assert.equal(compute('(row (at "amount" -1 "by-date"))').l1, "#REF!");
  assert.equal(compute("(row amount)").l1, "#VALUE!");
});

test("a Sheet view that isn't there, or isn't a Sheet view, is #REF!", () => {
  assert.equal(compute('(at "amount" -1 "gone")').l2, "#REF!");
  assert.equal(compute('(at "amount" -1 "by-date")', [{ ...byDate, coordinates: false }]).l2, "#REF!");
});

test("a range's fields must be the Sheet view's columns", () => {
  assert.equal(compute('(sum (range "a" 0 "c" 0 "by-date"))', [{ ...byDate, fields: ["date", "a"] }]).l1, "#REF!");
  // One column needn't be shown to be read.
  assert.equal(compute('(sum (range "c" 0 "c" 0 "by-date"))', [{ ...byDate, fields: ["date"] }]).l1, 6);
});

test("forms that aren't written out are #VALUE!", () => {
  assert.equal(compute('(at "amount" 1.5 "by-date")').l1, "#VALUE!");
  assert.equal(compute('(at "amount" nil "by-date")').l1, "#VALUE!");
  assert.equal(compute('(range "amount" 0 "by-date")').l1, "#VALUE!");
});

test("filters hide rows, but a hidden row is still read", () => {
  const filtered = { ...byDate, filter: [{ field: "amount", operator: "gt" as const, value: 15 }] };
  assert.deepEqual(compute('(at "amount" -1 "by-date")', [filtered]), { l1: undefined, l2: 10, l3: 20 });
});

test("grouped rows are numbered straight through, so the row above can be in the group before", () => {
  const grouped: View = { id: "g", name: "G", layout: "table", coordinates: true, group: { field: "a" }, sort: [{ field: "date", direction: "asc" }] };
  // Groups come in the order they first appear by date: a=4 (l1), a=7 (l2), a=1 (l3).
  assert.deepEqual(compute('(at "amount" -1 "g")', [grouped]), { l1: undefined, l2: 10, l3: 20 });
});

test("references by row id ignore the sort", () => {
  assert.deepEqual(compute('(field "amount" "l1")', [byDate]), compute('(field "amount" "l1")', []));
});

test("nil is an open end; a field called nil is (field \"nil\")", () => {
  const r = parseExpr("nil");
  assert.deepEqual(r.ok && r.expr, { kind: "nil" });
  const schema = { fields: [{ name: "nil", type: "number" as const }, { name: "out", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(+ (field "nil") 1)' } }] };
  assert.equal(computeRows(schema, [{ id: "x", nil: 4 }]).rows[0]!.out, 5);
});

test("another table's Sheet view is read by row id or open ends", () => {
  const deals: ParsedTable = {
    schema: { fields: [{ name: "value", type: "number" }, { name: "stage", type: "string" }] },
    rows: [
      { id: "d1", value: 100, stage: "won" },
      { id: "d2", value: 250, stage: "open" },
    ],
    views: [{ id: "pipeline", name: "Pipeline", layout: "table", coordinates: true, sort: [{ field: "value", direction: "desc" }] }],
    meta: {},
  };
  const schema = {
    fields: [
      { name: "name", type: "string" as const },
      { name: "total", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (range "value" nil "value" nil "pipeline" "deals"))' } },
      { name: "top", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(row (at "value" "d2" "pipeline" "deals"))' } },
      { name: "offset", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(at "value" -1 "pipeline" "deals")' } },
    ],
  };
  const [row] = computeRows(schema, [{ id: "c1", name: "Acme" }], { tables: { deals }, self: "companies" }).rows;
  assert.equal(row!.total, 350);
  assert.equal(row!.top, 1);
  assert.equal(String(row!.offset), "#VALUE!");
});

// ---- loops (D41: a Sheet view sorted by its own places)

const loopSchema = {
  fields: [
    ...fields,
    { name: "balance", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "balance" -1 "by-bal") amount)' } },
  ],
};
const byBalance: View = { id: "by-bal", name: "By balance", layout: "table", coordinates: true, sort: [{ field: "balance", direction: "desc" }] };

test("a Sheet view sorted by its own running balance is #REF!, and numbered in file order", () => {
  const out = computeRows(loopSchema, ledger, { views: [byBalance] }).rows;
  assert.deepEqual(out.map((r) => String(r.balance)), ["#REF!", "#REF!", "#REF!"]);
  const g = sheetGrid({ schema: loopSchema, rows: ledger, views: [byBalance], meta: {} }, "by-bal")!;
  assert.equal(g.loop, true);
  assert.deepEqual(g.rows.map((r) => r.id), ["l3", "l1", "l2"]);
  assert.deepEqual(g.rows.map((r) => String(r.balance)), ["#REF!", "#REF!", "#REF!"]);
});

test("the loop is found whichever row asks first", () => {
  for (const start of [0, 1, 2]) {
    const rows = [...ledger.slice(start), ...ledger.slice(0, start)];
    const out = computeRows(loopSchema, rows, { views: [byBalance] }).rows;
    assert.deepEqual(out.map((r) => String(r.balance)), ["#REF!", "#REF!", "#REF!"], `starting at ${start}`);
  }
  // A single row sorted by its own place is still a loop.
  const one = computeRows(loopSchema, [ledger[0]!], { views: [byBalance] }).rows;
  assert.equal(String(one[0]!.balance), "#REF!");
});

test("two Sheet views sorted by each other's places both loop", () => {
  const schema = {
    fields: [
      ...fields,
      { name: "x", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "amount" -1 "w") 0)' } },
      { name: "y", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "amount" -1 "v") 0)' } },
    ],
  };
  const views: View[] = [
    { id: "v", name: "V", layout: "table", coordinates: true, sort: [{ field: "x", direction: "asc" }] },
    { id: "w", name: "W", layout: "table", coordinates: true, sort: [{ field: "y", direction: "asc" }] },
  ];
  const t = { schema, rows: ledger, views, meta: {} };
  assert.equal(sheetGrid(t, "v")!.loop, true);
  assert.equal(sheetGrid(t, "w")!.loop, true);
});

test("a sort that doesn't read its own places isn't a loop", () => {
  const g = sheetGrid({ schema: { fields: [...fields, loopSchema.fields.at(-1)!] }, rows: ledger, views: [{ ...byBalance, sort: [{ field: "date", direction: "desc" }] }], meta: {} }, "by-bal")!;
  assert.equal(g.loop, false);
  assert.deepEqual(g.rows.map((r) => [r.id, r.balance]), [["l3", 30], ["l2", 50], ["l1", 60]]);
});

// ---- long chains

function longLedger(n: number): Row[] {
  // File order is the reverse of date order, so the first row computed is
  // the last row of the grid: the whole chain below it at once.
  const rows: Row[] = [];
  for (let i = n - 1; i >= 0; i--) rows.push({ id: `r${i}`, date: `k${String(i).padStart(7, "0")}`, amount: 1 });
  return rows;
}

const chainSchema = {
  fields: [
    { name: "date", type: "string" as const },
    { name: "amount", type: "number" as const },
    { name: "balance", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "balance" -1 "by-date") amount)' } },
  ],
};

test("a 100,000-row running balance doesn't overflow the stack", () => {
  const rows = longLedger(100_000);
  const out = computeRows(chainSchema, rows, { views: [byDate] }).rows;
  assert.equal(out[0]!.balance, 100_000);
  assert.equal(out.at(-1)!.balance, 1);
});

test("a long chain reached from another table doesn't either", () => {
  const rows = longLedger(50_000);
  const ledgerTable: ParsedTable = { schema: chainSchema, rows, views: [byDate], meta: {} };
  const schema = {
    fields: [
      { name: "entry", type: "string" as const, relation: { table: "ledger" } },
      { name: "balance", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(lookup "entry" "balance")' } },
    ],
  };
  const [row] = computeRows(schema, [{ id: "s", entry: "r49999" }], { tables: { ledger: ledgerTable }, self: "summary" }).rows;
  assert.equal(row!.balance, 50_000);
});

test("a chain that reads the row below works bottom up", () => {
  const schema = {
    fields: [
      ...chainSchema.fields.slice(0, 2),
      { name: "left", type: "number" as const, computed: { dialect: "table-expr-v1" as const, expr: '(sum (at "left" 1 "by-date") amount)' } },
    ],
  };
  // In date order, so the first row computed needs every row below it.
  const out = computeRows(schema, longLedger(20_000).reverse(), { views: [byDate] }).rows;
  assert.equal(out[0]!.left, 20_000);
  assert.equal(out.at(-1)!.left, 1);
});
