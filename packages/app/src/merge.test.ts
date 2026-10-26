// Merging a Sheet view's cells (D58): asked as a range, from a cell; undone by Unmerge.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";

import { initialAppState, tableApp, type AppAction, type AppState } from "./appState.ts";
import { fromBundle } from "./bundles.ts";

const KEY = "household-budget/budget";
const start = (): AppState => {
  const tables: Record<string, ParsedTable> = {};
  const bundles: Record<string, BundleMeta> = {};
  for (const [key, b] of Object.entries(fixtures)) {
    Object.assign(tables, fromBundle(key, b));
    bundles[key] = b.meta;
  }
  return tableApp(initialAppState({ tables, bundles }), { type: "showView", key: KEY, viewId: "kifpjiq34nhz8k95rc3uezwqu5" });
};
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(tableApp, state);
const sheetOf = (s: AppState) => s.tables[KEY]!.views.find((v) => v.id === "kifpjiq34nhz8k95rc3uezwqu5")!;

test("Merge Cells asks for a range from the cell, and the block typed is the view's; Unmerge takes it back", () => {
  const asked = run(start(), { type: "askMerge", rowId: "yzqhrmxgwi1k3ur81b7epdbim5", field: "jan" });
  assert.equal(asked.asking?.kind, "name");
  assert.equal(asked.asking?.kind === "name" ? asked.asking.prompt.value : undefined, "C1:");
  const merged = run(asked, { type: "answer", response: "ok", text: "C1:D2" });
  assert.deepEqual(sheetOf(merged).merged, [{ from: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" }, to: { field: "feb", row: "f8o7dzw4cpk4zgd38togwz7n4w" } }]);
  assert.ok(merged.dirty.includes("household-budget"));
  // From any of its cells.
  assert.equal(sheetOf(run(merged, { type: "unmerge", rowId: "f8o7dzw4cpk4zgd38togwz7n4w", field: "feb" })).merged, undefined);
  assert.deepEqual(sheetOf(run(merged, { type: "undo" })).merged, undefined);
});

test("a range that isn't a block of the sheet says so and changes nothing", () => {
  const s = run(start(), { type: "askMerge", rowId: "yzqhrmxgwi1k3ur81b7epdbim5", field: "jan" }, { type: "answer", response: "ok", text: "C1" });
  assert.equal(sheetOf(s).merged, undefined);
  assert.match(s.telling?.heading ?? "", /isn't a block of cells/);
});
