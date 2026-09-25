import { test } from "node:test";
import assert from "node:assert/strict";

import { clearSaved, loadSaved, save, STORAGE_KEY, type KeyValueStore } from "./savedTables.ts";
import type { ParsedTable } from "@workspace.sh/table-core";

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

const table: ParsedTable = {
  path: "fixtures/projects.table",
  schema: { fields: [{ name: "title", type: "string" }] } as ParsedTable["schema"],
  rows: [{ id: "abc", title: "Edited" }],
  views: [{ id: "v1", name: "All", layout: "table" }] as ParsedTable["views"],
  meta: { title: "Projects" } as ParsedTable["meta"],
  bodies: { abc: "# Notes" },
};

test("what is saved comes back as it was", () => {
  const store = memory();
  save(store, { projects: table });
  assert.deepEqual(loadSaved(store), { projects: table });
});

test("nothing saved, or no storage at all, means start from the fixtures", () => {
  assert.equal(loadSaved(memory()), null);
  assert.equal(loadSaved(null), null);
});

test("anything unreadable is discarded rather than trusted", () => {
  const bad = [
    "not json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ projects: { ...table, views: [] } }),
    JSON.stringify({ projects: { ...table, rows: "nope" } }),
    JSON.stringify({ projects: { ...table, schema: {} } }),
    JSON.stringify({ projects: { ...table, meta: undefined } }),
  ];
  for (const raw of bad) {
    assert.equal(loadSaved(memory({ [STORAGE_KEY]: raw })), null, raw.slice(0, 40));
  }
});

test("a store that throws is treated as no store", () => {
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(loadSaved(throwing), null);
  save(throwing, { projects: table });
  clearSaved(throwing);
});

test("reset forgets what was saved", () => {
  const store = memory();
  save(store, { projects: table });
  clearSaved(store);
  assert.equal(loadSaved(store), null);
});
