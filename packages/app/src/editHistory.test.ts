import { test } from "node:test";
import assert from "node:assert/strict";

import { parseEditLog, readTableArchive, serializeEditEvents, stampEdits, type EditEvent, type ParsedTable } from "@workspace.sh/table-core";
import type { TableFs } from "@workspace.sh/table-core/io";
import { appendFolderHistory, appendStoredHistory, clearStoredHistory, HISTORY_KEY, keepArrivedHistories, storedHistory, withHistories } from "./editHistory.ts";
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

// A history and an archive

const held = (history?: string): ParsedTable => ({ path: "", schema: { fields: [{ name: "title", type: "string" }] }, rows: [{ id: "r1", title: "A" }], views: [], meta: {}, ...(history !== undefined ? { history } : {}) });

test("for an archive, each table goes out with the history the app keeps for it, and none goes out without", async () => {
  const store = memory();
  appendStoredHistory(store, "x/tasks", [event("e1", "r1", "a")]);
  const stale = serializeEditEvents([event("old", "r1", "z")]);
  const out = await withHistories({ "x/tasks": held(stale), "x/people": held(), "x/files": held(stale) }, (key) => storedHistory(store, key));
  // The app's own copy, not what the table arrived with.
  assert.equal(out["x/tasks"]!.history, storedHistory(store, "x/tasks"));
  assert.equal("history" in out["x/people"]!, false);
  // Arrived with one, and the app keeps none for it now (it was reset): none goes out.
  assert.equal("history" in out["x/files"]!, false);
  // Rows and the rest are as they were.
  assert.deepEqual(out["x/tasks"]!.rows, [{ id: "r1", title: "A" }]);
  // A history read from a file comes later than asked: it is waited for.
  const late = await withHistories({ "x/tasks": held() }, async () => "late\n");
  assert.equal(late["x/tasks"]!.history, "late\n");
});

test("an archive made that way reads back with the history, byte for byte", async () => {
  const { bundleToArchive } = await import("./tableFiles.ts");
  const { toBundle } = await import("./bundles.ts");
  const store = memory();
  appendStoredHistory(store, "x/tasks", [event("e1", "r1", "a"), event("e2", "r1", "b")]);
  const tables = await withHistories({ "x/tasks": held(), "x/people": held() }, (key) => storedHistory(store, key));
  const back = await readTableArchive(await bundleToArchive("x", toBundle(tables, { x: { title: "X" } }, "x")));
  assert.equal(back.tables.tasks!.history, storedHistory(store, "x/tasks"));
  assert.equal("history" in back.tables.people!, false);
});

test("opened from an archive into an app that keeps histories in its store: they are kept there, and the tables held without them", () => {
  const store = memory();
  const arrived = serializeEditEvents([event("e1", "r1", "a")]);
  const tables = keepArrivedHistories(store, { "y/tasks": held(arrived), "y/people": held() });
  assert.equal(storedHistory(store, "y/tasks"), arrived);
  assert.equal(storedHistory(store, "y/people"), "");
  assert.equal("history" in tables["y/tasks"]!, false);
  assert.deepEqual(tables["y/tasks"]!.rows, [{ id: "r1", title: "A" }]);
  // Edits made after are added to what arrived.
  appendStoredHistory(store, "y/tasks", [event("e2", "r1", "b")]);
  assert.deepEqual(
    parseEditLog(storedHistory(store, "y/tasks")).events.map((e) => e.id),
    ["e1", "e2"],
  );
});

test("a history the store already has is the app's own: an archive opened under the same key doesn't replace it", () => {
  const store = memory();
  appendStoredHistory(store, "y/tasks", [event("mine", "r1", "a")]);
  const before = storedHistory(store, "y/tasks");
  const tables = keepArrivedHistories(store, { "y/tasks": held(serializeEditEvents([event("theirs", "r1", "z")])) });
  assert.equal(storedHistory(store, "y/tasks"), before);
  assert.equal("history" in tables["y/tasks"]!, false);
});

test("with nothing arrived the tables are handed back as they are, and the store isn't written; with no store the histories are let go", () => {
  const store = memory();
  const tables = { "y/people": held() };
  assert.equal(keepArrivedHistories(store, tables), tables);
  assert.equal(store.items.has(HISTORY_KEY), false);
  const dropped = keepArrivedHistories(null, { "y/tasks": held("x\n") });
  assert.equal("history" in dropped["y/tasks"]!, false);
});

