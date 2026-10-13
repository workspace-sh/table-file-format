import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";

import { derive, initialAppState, tableApp, type AppAction, type AppState } from "./appState.ts";
import { bundleOf, fromBundle } from "./bundles.ts";
import { canClose, closePrompt } from "./closing.ts";
import type { Library } from "./library.ts";
import { withNewFixtures } from "./savedTables.ts";

const examples = (): Library => {
  const tables: Record<string, ParsedTable> = {};
  const bundles: Record<string, BundleMeta> = {};
  for (const [key, b] of Object.entries(fixtures)) {
    Object.assign(tables, fromBundle(key, b));
    bundles[key] = b.meta;
  }
  return { tables, bundles, paths: {}, problems: {} };
};

const start = (over: Partial<Parameters<typeof initialAppState>[0]> = {}): AppState => {
  const { tables, bundles } = examples();
  return initialAppState({ tables, bundles, ...over });
};

const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(tableApp, state);
const keysIn = (s: AppState, bundle: string) => Object.keys(s.tables).filter((k) => bundleOf(k) === bundle);

test("Close asks first, worded for a file the app keeps; Cancel keeps it", () => {
  const asked = run(start(), { type: "close", bundle: "crm" });
  assert.equal(asked.asking?.kind, "confirm");
  assert.deepEqual(asked.asking?.kind === "confirm" && asked.asking.confirm, closePrompt(asked.bundles.crm!.title ?? "crm", false));
  const kept = run(asked, { type: "answer", response: "cancel" });
  assert.ok(kept.bundles.crm);
  assert.equal(kept.asking, null);
});

test("Close of a folder from disk says the folder stays", () => {
  const asked = run(start({ opened: { crm: "/somewhere/crm.table" } }), { type: "close", bundle: "crm" });
  assert.match(asked.asking?.kind === "confirm" ? asked.asking.confirm.body : "", /folder stays/);
});

test("closing takes every trace of the file out, moves the screen off it, and marks it to write away", () => {
  const before = run(start({ opened: { crm: "/somewhere/crm.table" } }), { type: "showTable", key: "crm/deals" }, { type: "updateRow", rowId: "d1", field: "title", value: "Changed" });
  assert.ok(keysIn(before, "crm").length > 0);
  const s = run(before, { type: "close", bundle: "crm" }, { type: "answer", response: "close" });
  assert.equal(s.bundles.crm, undefined);
  assert.deepEqual(keysIn(s, "crm"), []);
  assert.equal(s.opened.crm, undefined);
  assert.ok(!Object.keys(s.undo).some((k) => bundleOf(k) === "crm"));
  assert.ok(!Object.keys(s.viewIds).some((k) => bundleOf(k) === "crm"));
  assert.ok(!Object.keys(s.editLog.pending).some((k) => bundleOf(k) === "crm"));
  assert.notEqual(bundleOf(s.active), "crm");
  assert.ok(s.tables[s.active]);
  assert.ok(s.dirty.includes("crm"));
  assert.deepEqual(s.closed, ["crm"]);
  // What's drawn has no trace of it either.
  assert.ok(!derive(s).sidebarTree.some((b) => b.bundle === "crm"));
});

test("closing a file not on screen leaves the screen where it is", () => {
  const before = run(start(), { type: "showTable", key: "crm/deals" });
  const other = Object.keys(before.bundles).find((b) => b !== "crm")!;
  const s = run(before, { type: "close", bundle: other }, { type: "answer", response: "close" });
  assert.equal(s.active, "crm/deals");
});

test("the last file open can't be closed", () => {
  let s = start();
  for (const bundle of Object.keys(s.bundles).slice(1)) s = run(s, { type: "close", bundle }, { type: "answer", response: "close" });
  const last = Object.keys(s.bundles);
  assert.equal(last.length, 1);
  assert.equal(canClose(s.bundles, last[0]!), false);
  assert.equal(run(s, { type: "close", bundle: last[0]! }), s);
  assert.equal(derive(s).sidebarTree[0]!.closable, false);
});

test("a file opened again is no longer closed, and Reset Demo Data brings every example back", () => {
  const closed = run(start(), { type: "close", bundle: "crm" }, { type: "answer", response: "close" });
  const crm = examples();
  const reopened = run(closed, {
    type: "opened",
    library: { tables: Object.fromEntries(Object.entries(crm.tables).filter(([k]) => bundleOf(k) === "crm")), bundles: { crm: crm.bundles.crm! }, paths: {}, problems: {} },
  });
  assert.deepEqual(reopened.closed, []);
  const reset = run(closed, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.deepEqual(reset.closed, []);
  assert.ok(reset.bundles.crm);
});

test("an example closed stays out of the next launch's", () => {
  const all = examples();
  const s = run(start(), { type: "close", bundle: "crm" }, { type: "answer", response: "close" });
  const merged = withNewFixtures({ tables: s.tables, bundles: s.bundles, closed: s.closed }, all);
  assert.equal(merged.bundles.crm, undefined);
  assert.ok(withNewFixtures({ tables: s.tables, bundles: s.bundles }, all).bundles.crm);
});

test("an app that knows where the file lives says so, whatever `opened` holds", () => {
  // Every file of the app is a folder on disk, though the state has no path for this one.
  const folder = run(start(), { type: "close", bundle: "crm", fromFolder: true });
  assert.deepEqual(folder.asking?.kind === "confirm" && folder.asking.confirm, closePrompt(folder.bundles.crm!.title ?? "crm", true));
  // And the other way: opened from a path, but the app's own copy.
  const { tables, bundles } = examples();
  const own = run(initialAppState({ tables, bundles, opened: { crm: "/data/examples/crm.table" } }), { type: "close", bundle: "crm", fromFolder: false });
  assert.deepEqual(own.asking?.kind === "confirm" && own.asking.confirm, closePrompt(own.bundles.crm!.title ?? "crm", false));
});

