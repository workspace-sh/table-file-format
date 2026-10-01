import { test } from "node:test";
import assert from "node:assert/strict";

import { pageSave } from "./pageEdit.ts";

test("typing is saved; unchanged text isn't", () => {
  assert.equal(pageSave("# Plan", "# Plan!"), "save");
  assert.equal(pageSave("# Plan", "# Plan"), "none");
  assert.equal(pageSave("", "First words"), "save");
});

test("wiping a page asks rather than deleting it as you type", () => {
  assert.equal(pageSave("# Plan", ""), "ask");
  assert.equal(pageSave("# Plan", "  \n"), "ask");
});

test("a new page left empty saves nothing and asks nothing", () => {
  assert.equal(pageSave("", ""), "none");
  assert.equal(pageSave("", "  "), "save");
});
