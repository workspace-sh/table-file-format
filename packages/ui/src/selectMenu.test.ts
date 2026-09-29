import { test } from "node:test";
import assert from "node:assert/strict";

import { ITEM_HEIGHT, MENU_MAX, MENU_PADDING, placeMenu } from "./internal/selectMenu.ts";

const screen = { width: 1200, height: 800 };
const button = { top: 100, left: 200, width: 90, height: 28 };

test("opens just below its button, lined up with it", () => {
  const m = placeMenu(button, ["Table", "Board"], screen);
  assert.equal(m.top, 132);
  assert.equal(m.left, 200);
  assert.equal(m.height, 2 * ITEM_HEIGHT + 2 * MENU_PADDING);
});

test("is at least as wide as its button, and wide enough for its longest option", () => {
  assert.equal(placeMenu({ ...button, width: 400 }, ["A"], screen).width, 400);
  const long = placeMenu(button, ["Table", "Calendar (needs a date field)"], screen);
  assert.ok(long.width >= 29 * 7, `width ${long.width}`);
  assert.equal(placeMenu(button, ["A"], screen).width, 180);
});

test("moves up, not off the bottom, near the foot of the screen", () => {
  const m = placeMenu({ ...button, top: 760 }, ["A", "B", "C"], screen);
  assert.equal(m.top + m.height, screen.height - 8);
});

test("moves left, not off the right edge", () => {
  const m = placeMenu({ ...button, left: 1150 }, ["Somewhat long option"], screen);
  assert.equal(m.left + m.width, screen.width - 8);
});

test("a long list scrolls within a capped height, and never taller than the screen", () => {
  const codes = Array.from({ length: 160 }, (_, i) => `C${i}`);
  assert.equal(placeMenu(button, codes, screen).height, MENU_MAX);
  const short = placeMenu(button, codes, { width: 1200, height: 200 });
  assert.equal(short.height, 200 - 16);
  assert.equal(short.top, 8);
});

test("never wider than the screen", () => {
  const m = placeMenu(button, ["x".repeat(400)], { width: 300, height: 800 });
  assert.equal(m.width, 300 - 16);
  assert.equal(m.left, 8);
});
