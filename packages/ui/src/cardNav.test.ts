import { test } from "node:test";
import assert from "node:assert/strict";

import { moveInColumns, moveInGrid, nudge } from "./cardNav.ts";

const board = [["a1", "a2", "a3"], [], ["c1"], ["d1", "d2"]];

test("board: up and down stay in the column, stopping at its ends", () => {
  assert.equal(moveInColumns(board, "a1", "ArrowDown"), "a2");
  assert.equal(moveInColumns(board, "a3", "ArrowDown"), "a3");
  assert.equal(moveInColumns(board, "a1", "ArrowUp"), "a1");
  assert.equal(moveInColumns(board, "a2", "End"), "a3");
});

test("board: across skips empty columns and keeps the position it can", () => {
  assert.equal(moveInColumns(board, "a3", "ArrowRight"), "c1");
  assert.equal(moveInColumns(board, "c1", "ArrowRight"), "d1");
  assert.equal(moveInColumns(board, "d2", "ArrowLeft"), "c1");
  assert.equal(moveInColumns(board, "d2", "ArrowRight"), "d2");
  assert.equal(moveInColumns([["x1", "x2"], ["y1", "y2"]], "x2", "ArrowRight"), "y2");
});

test("gallery: across steps a card, up and down a row", () => {
  const ids = ["1", "2", "3", "4", "5"];
  assert.equal(moveInGrid(ids, 3, "3", "ArrowRight"), "4");
  assert.equal(moveInGrid(ids, 3, "2", "ArrowDown"), "5");
  assert.equal(moveInGrid(ids, 3, "3", "ArrowDown"), "3");
  assert.equal(moveInGrid(ids, 3, "5", "ArrowUp"), "2");
  assert.equal(moveInGrid(ids, 3, "1", "ArrowLeft"), "1");
});

test("unknown cards and keys stay put", () => {
  assert.equal(moveInColumns(board, "zz", "ArrowDown"), "zz");
  assert.equal(moveInGrid(["1"], 3, "1", "x"), "1");
});

test("nudge moves one place, never past the ends", () => {
  assert.deepEqual(nudge(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(nudge(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});
