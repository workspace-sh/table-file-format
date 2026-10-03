import { test } from "node:test";
import assert from "node:assert/strict";

import { movesBack, revertPatch } from "./revert.ts";

test("a field's changes since opening, put back", () => {
  const before = { name: "status", title: "Status", constraints: { enum: ["todo", "done"] } };
  const now = { name: "status", title: "State", constraints: { enum: ["todo", "done", "doing"] }, deprecated: true };
  const patch = revertPatch<Record<string, unknown>>(before, now);
  assert.deepEqual(Object.keys(patch).sort(), ["constraints", "deprecated", "title"]);
  assert.equal(patch.title, "Status");
  assert.deepEqual(patch.constraints, { enum: ["todo", "done"] });
  assert.equal(patch.deprecated, undefined);
  // As written: a key at undefined isn't.
  assert.equal(JSON.stringify({ ...now, ...patch }), JSON.stringify(before));
});

test("nothing changed, nothing to put back", () => {
  assert.deepEqual(revertPatch({ a: 1, b: [1] }, { a: 1, b: [1] }), {});
});

test("a field moved two places down moves two back up", () => {
  assert.deepEqual(movesBack(1, 3), [-1, -1]);
  assert.deepEqual(movesBack(3, 2), [1]);
  assert.deepEqual(movesBack(2, 2), []);
});
