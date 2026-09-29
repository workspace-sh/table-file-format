import { test } from "node:test";
import assert from "node:assert/strict";

import type { View } from "@workspace.sh/table-core";
import {
  ARRANGEMENTS_KEY,
  arrange,
  arrangedView,
  forViews,
  isArranged,
  loadArrangements,
  reset,
  saveArrangements,
  savedPatch,
} from "./arrangements.ts";
import type { KeyValueStore } from "./savedTables.ts";

function memory(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const saved: View = {
  id: "v",
  name: "By date",
  layout: "table",
  coordinates: true,
  sort: [{ field: "date", direction: "asc" }],
  filter: [{ field: "amount", operator: "gt", value: 0 }],
  order: ["r2", "r1"],
};

test("nothing kept, or anything damaged, is no arrangement", () => {
  assert.deepEqual(loadArrangements(null), {});
  assert.deepEqual(loadArrangements(memory()), {});
  for (const raw of ["nope", "null", "[]", '{"t":{"v":{"sort":"yes"}}}', '{"t":{"v":{"sort":[{"field":"x","direction":"up"}]}}}', '{"t":7}']) {
    assert.deepEqual(loadArrangements(memory({ [ARRANGEMENTS_KEY]: raw })), {}, raw);
  }
});

test("kept per table and per view, and back after a reload", () => {
  const store = memory();
  let all = arrange({}, "home/budget", "v", { sort: [{ field: "amount", direction: "desc" }] });
  all = arrange(all, "home/budget", "w", { group: { field: "kind" } });
  saveArrangements(store, all);
  assert.deepEqual(loadArrangements(store), all);
  assert.equal(isArranged(all["home/budget"]!.v), true);
  assert.equal(isArranged(all["home/other"]?.v), false);
});

test("a personal sort replaces the saved sort and the dragged order, on screen only", () => {
  const all = arrange({}, "t", "v", { sort: [{ field: "amount", direction: "desc" }], order: undefined });
  const shown = arrangedView(saved, all.t!.v);
  assert.deepEqual(shown.sort, [{ field: "amount", direction: "desc" }]);
  assert.equal(shown.order, undefined);
  assert.deepEqual(shown.filter, saved.filter);
  // The saved view is untouched.
  assert.deepEqual(saved.sort, [{ field: "date", direction: "asc" }]);
});

test('"no sort, for me" hides a saved sort', () => {
  const all = arrange({}, "t", "v", { sort: undefined });
  assert.deepEqual(all.t!.v, { sort: null });
  assert.equal(arrangedView(saved, all.t!.v).sort, undefined);
  assert.deepEqual(arrangedView(saved, all.t!.v).filter, saved.filter);
});

test("only filters, sorts and grouping are personal", () => {
  const all = arrange({}, "t", "v", { name: "Renamed", filter: undefined });
  assert.deepEqual(all.t!.v, { filter: null });
});

test("Save for everyone writes the arrangement into the view, and a sort clears the dragged order", () => {
  const all = arrange({}, "t", "v", { sort: [{ field: "amount", direction: "desc" }], filter: undefined });
  assert.deepEqual(savedPatch(all.t!.v), { sort: [{ field: "amount", direction: "desc" }], filter: undefined, order: undefined });
  assert.deepEqual(savedPatch(arrange({}, "t", "v", { group: { field: "kind" } }).t!.v), { group: { field: "kind" } });
});

test("Reset drops it, leaving the others", () => {
  let all = arrange({}, "t", "v", { sort: undefined });
  all = arrange(all, "t", "w", { sort: undefined });
  assert.deepEqual(Object.keys(reset(all, "t", "v").t!), ["w"]);
  assert.deepEqual(reset(reset(all, "t", "v"), "t", "w"), {});
  assert.equal(reset(all, "t", "gone"), all);
});

test("arrangements of views that are gone are left behind", () => {
  let all = arrange({}, "t", "v", { sort: undefined });
  all = arrange(all, "t", "gone", { sort: undefined });
  all = arrange(all, "deleted-table", "v", { sort: undefined });
  assert.deepEqual(forViews(all, { t: { views: [saved] } }), { t: { v: { sort: null } } });
});
