import { test } from "node:test";
import assert from "node:assert/strict";

import { afterEdit, cellPicks, gridKey, type GridCell } from "./gridNav";

const text: GridCell = { editable: true, boolean: false, picks: false, computed: false };
const at = (row: number, col: number) => ({ row, col });
const key = (k: string, mods: { shift?: boolean; jump?: boolean; alt?: boolean } = {}) => ({ key: k, ...mods });

test("with nothing selected, a moving key selects the first cell; others are left alone", () => {
  assert.deepEqual(gridKey(null, 3, 4, key("ArrowDown"), text), { kind: "select", at: at(0, 0) });
  assert.deepEqual(gridKey(null, 3, 4, key("Tab"), text), { kind: "select", at: at(0, 0) });
  assert.equal(gridKey(null, 3, 4, key("a"), text), null);
  assert.equal(gridKey(at(0, 0), 0, 4, key("ArrowDown"), text), null);
});

test("arrows step and stop at the edges; with Ctrl or ⌘ they jump to them", () => {
  assert.deepEqual(gridKey(at(1, 1), 3, 4, key("ArrowDown"), text), { kind: "select", at: at(2, 1) });
  assert.deepEqual(gridKey(at(2, 1), 3, 4, key("ArrowDown"), text), { kind: "select", at: at(2, 1) });
  assert.deepEqual(gridKey(at(1, 1), 3, 4, key("ArrowLeft"), text), { kind: "select", at: at(1, 0) });
  assert.deepEqual(gridKey(at(1, 1), 3, 4, key("ArrowRight", { jump: true }), text), { kind: "select", at: at(1, 3) });
  assert.deepEqual(gridKey(at(1, 1), 3, 4, key("ArrowUp", { jump: true }), text), { kind: "select", at: at(0, 1) });
  assert.deepEqual(gridKey(at(1, 2), 3, 4, key("Home"), text), { kind: "select", at: at(1, 0) });
  assert.deepEqual(gridKey(at(1, 2), 3, 4, key("End", { jump: true }), text), { kind: "select", at: at(2, 3) });
});

test("Tab reads along the rows, and past either end lets the key go", () => {
  assert.deepEqual(gridKey(at(0, 3), 3, 4, key("Tab"), text), { kind: "select", at: at(1, 0) });
  assert.deepEqual(gridKey(at(1, 0), 3, 4, key("Tab", { shift: true }), text), { kind: "select", at: at(0, 3) });
  assert.deepEqual(gridKey(at(2, 3), 3, 4, key("Tab"), text), { kind: "leave" });
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Tab", { shift: true }), text), { kind: "leave" });
});

test("Enter opens; a character types over text, and opens a picker's", () => {
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Enter"), text), { kind: "open" });
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("x"), text), { kind: "open", text: "x" });
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("x"), { ...text, picks: true }), { kind: "open" });
  assert.equal(gridKey(at(0, 0), 3, 4, key("x", { jump: true }), text), null);
  assert.equal(gridKey(at(0, 0), 3, 4, key("x"), { ...text, editable: false }), null);
  // A formula can't be typed into, but Enter shows how it was worked out.
  const formula = { ...text, editable: false, computed: true };
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Enter"), formula), { kind: "open" });
  assert.equal(gridKey(at(0, 0), 3, 4, key("Delete"), formula), null);
});

test("a checkbox flips with Space or Enter and isn't cleared; Delete empties text; Escape deselects", () => {
  const box = { ...text, boolean: true };
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key(" "), box), { kind: "toggle" });
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Enter"), box), { kind: "toggle" });
  assert.equal(gridKey(at(0, 0), 3, 4, key("Delete"), box), null);
  assert.equal(gridKey(at(0, 0), 3, 4, key(" "), text), null);
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Backspace"), text), { kind: "clear" });
  assert.deepEqual(gridKey(at(0, 0), 3, 4, key("Escape"), text), { kind: "deselect" });
});

test("after an edit: Enter goes down, Tab along, anything else stays", () => {
  assert.deepEqual(afterEdit(at(0, 1), "enter", 3, 4), at(1, 1));
  assert.deepEqual(afterEdit(at(2, 1), "enter", 3, 4), at(2, 1));
  assert.deepEqual(afterEdit(at(0, 3), "tab", 3, 4), at(1, 0));
  assert.deepEqual(afterEdit(at(2, 3), "tab", 3, 4), at(2, 3));
  assert.deepEqual(afterEdit(at(1, 0), "shift-tab", 3, 4), at(0, 3));
  assert.deepEqual(afterEdit(at(1, 1), "escape", 3, 4), at(1, 1));
});

test("choices, lists and dates open a picker when typed on; text doesn't", () => {
  assert.equal(cellPicks({ name: "s", type: "string", constraints: { enum: ["a"] } }), true);
  assert.equal(cellPicks({ name: "d", type: "date" }), true);
  assert.equal(cellPicks({ name: "l", type: "array" }), true);
  assert.equal(cellPicks({ name: "t", type: "string" }), false);
});
