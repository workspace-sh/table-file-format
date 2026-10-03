import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGE_MAX_SPEED, EDGE_ZONE_PX, edgeSpeed } from "./internal/edgeSpeed";

test("nothing scrolls away from the edges", () => {
  assert.equal(edgeSpeed(500, 0, 1000), 0);
  assert.equal(edgeSpeed(EDGE_ZONE_PX, 0, 1000), 0);
  assert.equal(edgeSpeed(1000 - EDGE_ZONE_PX, 0, 1000), 0);
});

test("it speeds up towards the edge, in the direction of the edge", () => {
  const shallow = edgeSpeed(EDGE_ZONE_PX / 2, 0, 1000);
  assert.ok(shallow < 0 && shallow > -EDGE_MAX_SPEED);
  assert.equal(edgeSpeed(0, 0, 1000), -EDGE_MAX_SPEED);
  assert.equal(edgeSpeed(1000, 0, 1000), EDGE_MAX_SPEED);
  assert.ok(edgeSpeed(1000 - 10, 0, 1000) > edgeSpeed(1000 - 40, 0, 1000));
});

test("past the edge is as fast as the edge, whichever side", () => {
  assert.equal(edgeSpeed(-300, 0, 1000), -EDGE_MAX_SPEED);
  assert.equal(edgeSpeed(1400, 0, 1000), EDGE_MAX_SPEED);
});

test("a small container gives each edge a quarter, and an empty one none", () => {
  assert.equal(edgeSpeed(30, 0, 100), 0);
  assert.equal(edgeSpeed(70, 0, 100), 0);
  assert.ok(edgeSpeed(10, 0, 100) < 0);
  assert.equal(edgeSpeed(5, 0, 0), 0);
});
