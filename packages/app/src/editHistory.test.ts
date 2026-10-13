import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEditLog, stampEdits, type EditEvent } from "@workspace.sh/table-core";
import type { TableFs } from "@workspace.sh/table-core/io";
import { appendFolderHistory, appendStoredHistory, clearStoredHistory, HISTORY_KEY, storedHistory } from "./editHistory.ts";
import type { KeyValueStore } from "./savedTables.ts";

const memory = (): KeyValueStore & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
};

const event = (id: string, row: string, value: string): EditEvent =>
  stampEdits([{ op: "set", row, field: "title", to: value }], { id: () => id, at: new Date("2026-10-13T10:00:00Z") })[0]!;

test("a stored table's history is added to, and read back as the events written", () => {
  const store = memory();
  appendStoredHistory(store, "projects/projects", [event("e1", "r1", "a")]);
  appendStoredHistory(store, "projects/projects", [event("e2", "r2", "b"), event("e3", "r1", "c")]);
  appendStoredHistory(store, "shop/orders", [event("e4", "o1", "d")]);
  const text = storedHistory(store, "projects/projects");
  assert.ok(text.endsWith("\n"));
  assert.equal(text.trim().split("\n").length, 3);
  assert.deepEqual(
    parseEditLog(text).events.map((e) => e.id),
    ["e1", "e2", "e3"],
  );
  assert.equal(storedHistory(store, "shop/orders").trim().split("\n").length, 1);
  assert.equal(storedHistory(store, "crm/deals"), "");
});

test("nothing to append writes nothing", () => {
  const store = memory();
  appendStoredHistory(store, "projects/projects", []);
  assert.equal(store.items.has(HISTORY_KEY), false);
});

test("Reset Demo Data forgets every stored history", () => {
  const store = memory();
  appendStoredHistory(store, "projects/projects", [event("e1", "r1", "a")]);
  clearStoredHistory(store);
  assert.equal(storedHistory(store, "projects/projects"), "");
  clearStoredHistory(null);
});

test("something unreadable in the store starts a new history", () => {
  const store = memory();
  store.setItem(HISTORY_KEY, "not json");
  appendStoredHistory(store, "projects/projects", [event("e1", "r1", "a")]);
  assert.equal(parseEditLog(storedHistory(store, "projects/projects")).events.length, 1);
});

test("a folder's history.ndjson is added to, and given a line end first when it has none", async () => {
  const files = new Map<string, string>([["b.table/tables/t/history.ndjson", '{"v":1}']]);
  const fs = {
    readText: async (p: string) => files.get(p) ?? null,
    writeText: async (p: string, c: string) => void files.set(p, c),
  } as unknown as TableFs;
  await appendFolderHistory(fs, "b.table/tables/t", [event("e1", "r1", "a")]);
  const text = files.get("b.table/tables/t/history.ndjson")!;
  assert.ok(text.startsWith('{"v":1}\n{'));
  await appendFolderHistory(fs, "b.table/tables/new", [event("e2", "r2", "b")]);
  assert.equal(files.get("b.table/tables/new/history.ndjson")!.trim().split("\n").length, 1);
});
