// A big table's edit works out one row, not all (#126): computed fields and
// validation are kept for a row object, and found again while the row is the
// same object. These check the answers stay right, and that the kept ones are
// used only where they can't go stale.

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRows } from "./workbook.js";
import { validate } from "./validator.js";
import type { Row, TableSchema } from "./types.js";

const local = {
  fields: [
    { name: "amount", type: "number" },
    { name: "rate", type: "number" },
    { name: "weighted", type: "number", computed: { dialect: "table-expr-v1", expr: "(* amount rate)" } },
  ],
} as TableSchema;
const rows: Row[] = [
  { id: "a", amount: 10, rate: 0.5 },
  { id: "b", amount: 20, rate: 0.25 },
  { id: "c", amount: 30, rate: 0.1 },
];

test("a formula on its own row's fields is kept for a row: the same row gives the same answer object", () => {
  const first = computeRows(local, rows).rows;
  const again = computeRows(local, rows).rows;
  assert.deepEqual(first.map((r) => r.weighted), [5, 5, 3]);
  first.forEach((r, i) => assert.equal(again[i], r));
});

test("an edit to one row is worked out; the other rows are the ones kept", () => {
  const first = computeRows(local, rows).rows;
  const edited = [rows[0]!, { ...rows[1]!, amount: 40 }, rows[2]!];
  const next = computeRows(local, edited).rows;
  assert.equal(next[1]!.weighted, 10);
  assert.equal(next[0], first[0]);
  assert.equal(next[2], first[2]);
});

test("changing the formula changes every answer: a new schema keeps nothing", () => {
  computeRows(local, rows);
  const changed = { fields: [local.fields[0]!, local.fields[1]!, { ...local.fields[2]!, computed: { dialect: "table-expr-v1", expr: "(+ amount rate)" } }] } as TableSchema;
  assert.deepEqual(computeRows(changed, rows).rows.map((r) => r.weighted), [10.5, 20.25, 30.1]);
});

test("a formula that reads other rows is worked out whole each time", () => {
  const sum = {
    fields: [
      { name: "amount", type: "number" },
      { name: "total", type: "number", computed: { dialect: "table-expr-v1", expr: '(sum (column "amount"))' } },
    ],
  } as TableSchema;
  const data: Row[] = [{ id: "a", amount: 1 }, { id: "b", amount: 2 }];
  assert.deepEqual(computeRows(sum, data).rows.map((r) => r.total), [3, 3]);
  // Row "a" is the same object, but its total moved because "b" did.
  const edited = [data[0]!, { id: "b", amount: 5 }];
  assert.deepEqual(computeRows(sum, edited).rows.map((r) => r.total), [6, 6]);
});

test("a formula that doesn't parse is still reported when every row is kept", () => {
  const broken = { fields: [{ name: "x", type: "number", computed: { dialect: "table-expr-v1", expr: "(+ 1" } }] } as TableSchema;
  const data: Row[] = [{ id: "a" }];
  assert.equal(computeRows(broken, data).diagnostics.length, 1);
  assert.equal(computeRows(broken, data).diagnostics.length, 1);
});

test("validation: an edit's row is checked afresh, and a duplicate id across rows is still found", () => {
  const schema = { fields: [{ name: "amount", type: "number", constraints: { required: true } }] } as TableSchema;
  const data: Row[] = [{ id: "a", amount: 1 }, { id: "b", amount: 2 }];
  assert.deepEqual(validate(schema, data), []);
  assert.deepEqual(validate(schema, data), []);
  const broken = [data[0]!, { id: "b" }];
  assert.deepEqual(validate(schema, broken).map((e) => [e.rowIndex, e.field]), [[1, "amount"]]);
  const dup = [data[0]!, { ...data[1]!, id: "a" }];
  assert.match(validate(schema, dup)[0]!.message, /duplicate system id/);
  // The same row object in a new position reports its own index.
  assert.deepEqual(validate(schema, [broken[1]!, data[0]!]).map((e) => e.rowIndex), [0]);
});
