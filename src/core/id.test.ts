import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "./id.js";

test("newId returns a non-empty string", () => {
  const id = newId();
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
});

test("newId produces unique values across many calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) ids.add(newId());
  assert.equal(ids.size, 1000);
});
