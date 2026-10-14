import { test } from "node:test";
import assert from "node:assert/strict";
import { pageScrollOver } from "./pageScroll.ts";

test("a page made with a lock holds still and lets go through it", () => {
  const calls: boolean[] = [];
  const page = pageScrollOver({ current: null }, { lock: (on) => calls.push(on) });
  page.pageScroll.lock?.(true);
  page.pageScroll.lock?.(false);
  assert.deepEqual(calls, [true, false]);
});

test("a page made without one has no lock, so nothing tries to hold it", () => {
  const page = pageScrollOver({ current: null });
  assert.equal(page.pageScroll.lock, undefined);
});
