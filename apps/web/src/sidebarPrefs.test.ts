import { test } from "node:test";
import assert from "node:assert/strict";

import { SIDEBAR_KEY, loadSidebarPrefs, saveSidebarPrefs } from "./sidebarPrefs.ts";
import type { KeyValueStore } from "./savedTables.ts";

function memory(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

test("the sidebar comes back as it was left", () => {
  const store = memory();
  saveSidebarPrefs(store, { collapsed: true, foldedFiles: ["crm"], foldedDisplay: true });
  assert.deepEqual(loadSidebarPrefs(store), { collapsed: true, foldedFiles: ["crm"], foldedDisplay: true });
});

test("nothing saved means open, with nothing folded", () => {
  assert.deepEqual(loadSidebarPrefs(memory()), {});
  assert.deepEqual(loadSidebarPrefs(null), {});
});

test("anything unexpected is dropped, not trusted", () => {
  for (const raw of ["nope", "null", '{"collapsed":"yes"}', '{"foldedFiles":[1,2]}', '{"foldedDisplay":1}']) {
    assert.deepEqual(loadSidebarPrefs(memory({ [SIDEBAR_KEY]: raw })), {}, raw);
  }
});
