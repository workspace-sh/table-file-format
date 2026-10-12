import { test } from "node:test";
import assert from "node:assert/strict";

import { settledPlace } from "./listSettle.ts";

// A million rows of 45 points, laid out in 8,000,000, on an 874-point screen.
const laidOut = 8_000_000;
const more = 45_000_000 - laidOut;
const screen = 874;
const range = laidOut - screen;

test("a list that fits is never moved", () => {
  assert.equal(settledPlace(1000, screen, 5000, 0, 0), null);
});

test("in the middle, the page goes to where the rows on screen are in the whole list", () => {
  // The rows half way down the whole list, drawn from a page scrolled 1,000 points.
  const start = (45_000_000 - screen) / 2;
  const settled = settledPlace(1000, screen, laidOut, more, start - 1000);
  assert.ok(settled);
  // The same rows stay on screen: the page's place plus the new shift is where they are.
  assert.ok(Math.abs(settled.to + settled.shift - start) < 1e-6);
  // And the page is about half way down.
  assert.ok(Math.abs(settled.to / range - 0.5) < 0.01);
});

test("above the list's top, the page is left on the title, whatever the shift", () => {
  assert.equal(settledPlace(-250, screen, laidOut, more, 0), null);
  assert.equal(settledPlace(-250, screen, laidOut, more, 3_000_000), null);
  assert.equal(settledPlace(0, screen, laidOut, more, 3_000_000), null);
});

test("at or past the list's end, the page is left on the last rows", () => {
  assert.equal(settledPlace(range, screen, laidOut, more, more), null);
  assert.equal(settledPlace(range + 120, screen, laidOut, more, more), null);
  assert.equal(settledPlace(range + 120, screen, laidOut, more, 1_000), null);
});

test("a move of under two points isn't made", () => {
  const at = 4_000_000;
  const to = at;
  const shift = to * (1 + more / range) - at;
  assert.equal(settledPlace(at, screen, laidOut, more, shift), null);
});
