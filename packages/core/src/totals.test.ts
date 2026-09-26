// A view's totals footer (SPEC section 4, `totals`).

import { test } from "node:test";
import assert from "node:assert/strict";

import { viewTotal } from "./query.js";
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
