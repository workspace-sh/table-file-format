import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { columnActions, rowActions } from "./controlSlots.ts";

test("a row's actions: page, inserts, then delete last and destructive", () => {
  const done: string[] = [];
  const actions = rowActions("r1", {
    onOpenBody: (id) => done.push(`open ${id}`),
    hasBody: true,
    onInsertRow: (id, where) => done.push(`insert ${where} ${id}`),
    onDeleteRow: (id) => done.push(`delete ${id}`),
  });
  assert.deepEqual(actions.map((a) => a.id), ["open-page", "insert-above", "insert-below", "delete"]);
  assert.deepEqual(actions.map((a) => !!a.destructive), [false, false, false, true]);
  for (const a of actions) a.onSelect();
  assert.deepEqual(done, ["open r1", "insert above r1", "insert below r1", "delete r1"]);
});

test("a row's height: fit always, reset only for a resized row, both before delete", () => {
  const done: string[] = [];
  const actions = rowActions("r1", {
    onInsertRow: () => {},
    onFitRow: (id) => done.push(`fit ${id}`),
    onResetRowHeight: (id) => done.push(`reset ${id}`),
    onDeleteRow: () => {},
  });
  assert.deepEqual(actions.map((a) => a.id), ["insert-above", "insert-below", "fit-row", "reset-row-height", "delete"]);
  assert.deepEqual(actions.slice(2, 4).map((a) => a.label), ["Fit Row to Content", "Reset Row Height"]);
  actions[2]!.onSelect();
  actions[3]!.onSelect();
  assert.deepEqual(done, ["fit r1", "reset r1"]);
  assert.deepEqual(rowActions("r1", { onFitRow: () => {} }).map((a) => a.id), ["fit-row"]);
});

test("a row without a page offers to add one, opened the same way", () => {
  const opened: string[] = [];
  const actions = rowActions("r1", { onOpenBody: (id) => opened.push(id), hasBody: false, onDeleteRow: () => {} });
  assert.deepEqual(actions.map((a) => [a.id, a.label]), [["add-page", "Add Page"], ["delete", "Delete Row"]]);
  actions[0]!.onSelect();
  assert.deepEqual(opened, ["r1"]);
});

test("only what the view can do: nothing at all for a read-only view", () => {
  assert.deepEqual(rowActions("r1", { hasBody: true, onDeleteRow: () => {} }).map((a) => a.id), ["delete"]);
  assert.deepEqual(rowActions("r1", {}), []);
});

test("labels are title case", () => {
  const actions = rowActions("r1", { onOpenBody: () => {}, hasBody: true, onInsertRow: () => {}, onDeleteRow: () => {} });
  assert.deepEqual(actions.map((a) => a.label), ["Open Page", "Insert Row Above", "Insert Row Below", "Delete Row"]);
});

test("each action names its symbol on both phones", () => {
  const actions = rowActions("r1", { onOpenBody: () => {}, hasBody: true, onInsertRow: () => {}, onDeleteRow: () => {} });
  for (const a of actions) assert.ok(a.symbol?.sf && a.symbol?.material, a.id);
});

test("every Material Symbol a menu names is drawn on Android (internal/material)", () => {
  const all = { onOpenBody: () => {}, onInsertRow: () => {}, onFitRow: () => {}, onResetRowHeight: () => {}, onDeleteRow: () => {}, onCellNote: () => {}, onHideRow: () => {} };
  const actions = [
    ...rowActions("r1", { ...all, hasBody: true }),
    ...rowActions("r1", { ...all, hasBody: false, onMergeCells: () => {} }),
    ...rowActions("r1", { ...all, onUnmergeCells: () => {} }),
    ...columnActions("status", { onAbout: () => {}, onInsertField: () => {}, onResetWidth: () => {}, onDeleteField: () => {} }),
  ];
  // The menu's own map (RowActions.android), which Metro bundles: each name in it, with its drawable.
  const menu = readFileSync(new URL("./internal/RowActions.android.tsx", import.meta.url), "utf8");
  for (const a of actions) {
    const material = a.symbol?.material;
    assert.ok(material, a.id);
    assert.ok(existsSync(new URL(`./internal/material/${material}.xml`, import.meta.url)), `${a.id}: ${material}.xml`);
    assert.ok(menu.includes(`${material}: require("./material/${material}.xml")`), `${a.id}: ${material} in RowActions.android's symbols`);
  }
});

test("a column's actions: insert either side, reset a resized width, delete last", () => {
  const done: string[] = [];
  const can = {
    onInsertField: (name: string, side: "before" | "after") => done.push(`insert ${side} ${name}`),
    onResetWidth: (name: string) => done.push(`reset ${name}`),
    onDeleteField: (name: string) => done.push(`delete ${name}`),
  };
  const actions = columnActions("status", can);
  assert.deepEqual(actions.map((a) => a.id), ["insert-left", "insert-right", "reset-width", "delete-field"]);
  assert.deepEqual(actions.map((a) => !!a.destructive), [false, false, false, true]);
  for (const a of actions) a.onSelect();
  assert.deepEqual(done, ["insert before status", "insert after status", "reset status", "delete status"]);
  // Right to left, the column on the left comes after it.
  done.length = 0;
  for (const a of columnActions("status", { ...can, rtl: true }).slice(0, 2)) a.onSelect();
  assert.deepEqual(done, ["insert after status", "insert before status"]);
  // Nothing it can't do: a width never set has nothing to reset.
  assert.deepEqual(columnActions("status", { onInsertField: can.onInsertField }).map((a) => a.id), ["insert-left", "insert-right"]);
});

test("a Sheet view's selected cell offers Merge Cells…, or Unmerge Cells when it's in a merged block, never both (D58)", () => {
  const ids = (can: Parameters<typeof rowActions>[1]) => rowActions("r1", can).map((a) => a.id);
  assert.deepEqual(ids({ onMergeCells: () => {} }), ["merge-cells"]);
  assert.deepEqual(ids({ onMergeCells: () => {}, onUnmergeCells: () => {} }), ["unmerge-cells"]);
});

test("About This Field comes first in a column's menu, where it's offered", () => {
  const ids = columnActions("status", { onAbout: () => {}, onInsertField: () => {}, onDeleteField: () => {} }).map((a) => a.id);
  assert.deepEqual(ids, ["about-field", "insert-left", "insert-right", "delete-field"]);
  assert.ok(!columnActions("status", { onInsertField: () => {} }).some((a) => a.id === "about-field"));
});
