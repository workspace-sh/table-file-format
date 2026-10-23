// A Sheet view's merged cells (SPEC section 4, D58).
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergedBlocks, mergeOfRange, mergeOver, withMerge } from "./merged.js";
import type { ViewMerge } from "./types.js";

const columns = ["a", "b", "c", "d"];
const rows = ["r1", "r2", "r3", "r4"];
const m = (f1: string, r1: string, f2: string, r2: string): ViewMerge => ({ from: { field: f1, row: r1 }, to: { field: f2, row: r2 } });
const sheet = (merged: ViewMerge[]) => ({ coordinates: true, merged });

test("a block is placed in the columns and rows shown, either corner first, showing its top-left cell", () => {
  assert.deepEqual(mergedBlocks(sheet([m("c", "r3", "b", "r2")]), columns, rows), [{ column: 1, columns: 2, row: 1, rows: 2, field: "b", rowId: "r2", index: 0 }]);
});

test("not drawn: outside a Sheet view, a single cell, a corner not shown, one overlapping another, one across the frozen split", () => {
  assert.deepEqual(mergedBlocks({ merged: [m("a", "r1", "b", "r1")] }, columns, rows), []);
  assert.deepEqual(mergedBlocks(sheet([m("a", "r1", "a", "r1")]), columns, rows), []);
  assert.deepEqual(mergedBlocks(sheet([m("a", "r1", "zz", "r2")]), columns, rows), []);
  const two = mergedBlocks(sheet([m("a", "r1", "b", "r2"), m("b", "r2", "c", "r3"), m("c", "r1", "d", "r1")]), columns, rows);
  assert.deepEqual(two.map((b) => b.field + b.rowId), ["ar1", "cr1"]);
  assert.deepEqual(mergedBlocks(sheet([m("a", "r1", "b", "r1")]), columns, rows, rows, 1), []);
  assert.equal(mergedBlocks(sheet([m("b", "r1", "c", "r1")]), columns, rows, rows, 1).length, 1);
});

test("rows a reader's own sort pulls apart aren't drawn merged; rows a filter takes out of the middle aren't either", () => {
  const block = sheet([m("a", "r1", "a", "r2")]);
  // The reader sorted r3 between them.
  assert.deepEqual(mergedBlocks(block, columns, ["r1", "r3", "r2", "r4"], rows), []);
  // r2 is hidden, so r1 and r3 are next to each other on screen but not in the grid.
  assert.deepEqual(mergedBlocks(sheet([m("a", "r1", "a", "r3")]), columns, ["r1", "r3", "r4"], rows), []);
  assert.equal(mergedBlocks(block, columns, rows, rows).length, 1);
});

test("a range typed as B2:C3 is a merge by field and row; one cell, or a corner off the grid, isn't", () => {
  assert.deepEqual(mergeOfRange(" b2:$C$3 ", columns, rows), m("b", "r2", "c", "r3"));
  assert.equal(mergeOfRange("B2:B2", columns, rows), null);
  assert.equal(mergeOfRange("B2:Z3", columns, rows), null);
  assert.equal(mergeOfRange("B2", columns, rows), null);
});

test("a merge added takes the blocks it overlaps; the merge over a cell is found by its place", () => {
  const view = sheet([m("a", "r1", "b", "r1"), m("c", "r3", "d", "r4")]);
  assert.deepEqual(withMerge(view, m("b", "r1", "b", "r2"), columns, rows), [m("c", "r3", "d", "r4"), m("b", "r1", "b", "r2")]);
  assert.equal(mergeOver(view, "d", "r4", columns, rows), 1);
  assert.equal(mergeOver(view, "c", "r1", columns, rows), -1);
});
