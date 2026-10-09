import { test } from "node:test";
import assert from "node:assert/strict";
import { rowLayout, type RowMark } from "./rowLayout.ts";

test("with nothing marked, every row is one height", () => {
  const l = rowLayout(1_000_000, 45);
  assert.equal(l.height, 45_000_000);
  assert.equal(l.topOf(0), 0);
  assert.equal(l.topOf(500_000), 22_500_000);
  assert.equal(l.at(0), 0);
  assert.equal(l.at(44.9), 0);
  assert.equal(l.at(45), 1);
  assert.equal(l.at(45_000_000), 1_000_000);
  assert.equal(rowLayout(0, 45).height, 0);
});

test("marked rows are where adding them up one at a time puts them", () => {
  let seed = 3;
  const next = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let round = 0; round < 50; round++) {
    const count = 1 + next(200);
    const marks: RowMark[] = Array.from({ length: next(30) }, () => ({
      place: next(count + 5) - 2,
      ...(next(2) ? { before: 33 } : {}),
      ...(next(2) ? { taller: 20 * (1 + next(4)) } : {}),
    }));
    const l = rowLayout(count, 45, marks);
    let y = 0;
    for (let i = 0; i < count; i++) {
      const mine = marks.filter((m) => m.place === i);
      const before = mine.reduce((a, m) => a + (m.before ?? 0), 0);
      const height = 45 + mine.reduce((a, m) => a + (m.taller ?? 0), 0);
      assert.equal(l.itemTop(i), y);
      assert.equal(l.topOf(i), y + before);
      assert.equal(l.heightOf(i), height);
      assert.equal(l.at(y + before), i);
      assert.equal(l.at(y + before + height - 0.5), i);
      y += before + height;
    }
    assert.equal(l.height, y);
    assert.equal(l.at(y), count);
  }
});
