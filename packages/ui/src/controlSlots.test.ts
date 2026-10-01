import { test } from "node:test";
import assert from "node:assert/strict";

import { rowActions } from "./controlSlots.ts";

test("a row's actions: document, inserts, then delete last and destructive", () => {
  const done: string[] = [];
  const actions = rowActions("r1", {
    onOpenBody: (id) => done.push(`open ${id}`),
    hasBody: true,
    onInsertRow: (id, where) => done.push(`insert ${where} ${id}`),
    onDeleteRow: (id) => done.push(`delete ${id}`),
  });
  assert.deepEqual(actions.map((a) => a.id), ["open-document", "insert-above", "insert-below", "delete"]);
  assert.deepEqual(actions.map((a) => !!a.destructive), [false, false, false, true]);
  for (const a of actions) a.onSelect();
  assert.deepEqual(done, ["open r1", "insert above r1", "insert below r1", "delete r1"]);
});

test("only what the view can do: no document without a body, nothing at all for a read-only view", () => {
  assert.deepEqual(rowActions("r1", { onOpenBody: () => {}, hasBody: false, onDeleteRow: () => {} }).map((a) => a.id), ["delete"]);
  assert.deepEqual(rowActions("r1", {}), []);
});

test("each action names its symbol on both phones", () => {
  const actions = rowActions("r1", { onOpenBody: () => {}, hasBody: true, onInsertRow: () => {}, onDeleteRow: () => {} });
  for (const a of actions) assert.ok(a.symbol?.sf && a.symbol?.material, a.id);
});
