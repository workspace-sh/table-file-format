// A view's totals footer (SPEC section 4, `totals`).

import { test } from "node:test";
import assert from "node:assert/strict";

import { exactSum, viewTotal } from "./query.js";
import type { Row } from "./types.js";

const rows: Row[] = [
  { id: "a", value: 100, stage: "lead", tags: ["x"] },
  { id: "b", value: 50, stage: "", tags: [] },
  { id: "c", stage: "won" },
  { id: "d", value: "n/a", stage: "lost" },
];

test("sums and averages read the numbers, skipping everything else", () => {
  assert.equal(viewTotal(rows, "value", "sum"), 150);
  assert.equal(viewTotal(rows, "value", "average"), 75);
  assert.equal(viewTotal(rows, "value", "min"), 50);
  assert.equal(viewTotal(rows, "value", "max"), 100);
});

test("counts count values, or blanks, of any type", () => {
  assert.equal(viewTotal(rows, "stage", "count"), 3);
  assert.equal(viewTotal(rows, "stage", "count_empty"), 1);
  // An empty list is blank, as SPEC's "Empty values" says.
  assert.equal(viewTotal(rows, "tags", "count_empty"), 3);
});

test("nothing to total is nothing, not zero", () => {
  assert.equal(viewTotal(rows, "stage", "sum"), undefined);
  assert.equal(viewTotal([], "value", "count"), 0);
});

test("a sum is the same whatever order its rows are in", () => {
  const values = [0.1, 0.2, 0.3, 1e16, 1 / 3, -1e16, 2.5, 0.7, 1e-9, 123456.789];
  const want = exactSum(values);
  // Added one at a time, these give different answers in different orders.
  assert.notEqual([...values].reduce((a, b) => a + b, 0), [...values].reverse().reduce((a, b) => a + b, 0));
  let seed = 7;
  for (let round = 0; round < 200; round++) {
    const shuffled = [...values];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    assert.equal(exactSum(shuffled), want);
    assert.equal(viewTotal(shuffled.map((value, i) => ({ id: `r${i}`, value })), "value", "sum"), want);
  }
  // The large pair cancels, and what's left is not lost.
  assert.equal(exactSum([1e16, 1, -1e16]), 1);
  assert.equal(exactSum([]), 0);
  assert.equal(exactSum([1, 2, 3]), 6);
});
