import { test } from "node:test";
import assert from "node:assert/strict";

import { nearest } from "./internal/nearest.ts";

test("a sideways scroll comes to rest on the nearest column start, or on the end", () => {
  const starts = [0, 180, 360, 540, 720];
  // A little into a column: back to its start. Most of the way through: on to the next.
  assert.equal(nearest(starts, 20, 600), 0);
  assert.equal(nearest(starts, 100, 600), 180);
  assert.equal(nearest(starts, 350, 600), 360);
  // Starts past the end can't be reached: the end stands in for them.
  assert.equal(nearest(starts, 590, 600), 600);
  assert.equal(nearest(starts, 560, 600), 540);
  // Nothing to scroll: it stays at the start.
  assert.equal(nearest(starts, 0, 0), 0);
  assert.equal(nearest([], 40, 200), 200);
});
