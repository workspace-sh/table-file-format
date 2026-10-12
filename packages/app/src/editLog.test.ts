import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, EditChange, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";

import { initialAppState, tableApp, type AppAction, type AppState } from "./appState.ts";
import { fromBundle } from "./bundles.ts";
import { rowsChanges } from "./editLog.ts";
import type { Library } from "./library.ts";

const examples = (): Library => {
  const tables: Record<string, ParsedTable> = {};
  const bundles: Record<string, BundleMeta> = {};
  for (const [key, b] of Object.entries(fixtures)) {
    Object.assign(tables, fromBundle(key, b));
    bundles[key] = b.meta;
  }
  return { tables, bundles, paths: {}, problems: {} };
};

/** The examples, in an app that writes history. */
const start = (over: Partial<Parameters<typeof initialAppState>[0]> = {}): AppState => {
  const { tables, bundles } = examples();
  return initialAppState({ tables, bundles, writesHistory: true, ...over });
};
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(tableApp, state);
const KEY = "projects/projects";
const kept = (s: AppState, key = KEY): EditChange[] => s.editLog.pending[key] ?? [];
const rowOf = (s: AppState, id: string, key = KEY) => s.tables[key]!.rows.find((r) => r.id === id)!;

test("an app that doesn't write history keeps nothing, whatever is edited", () => {
  const { tables, bundles } = examples();
  const s = run(
    initialAppState({ tables, bundles }),
    { type: "updateRow", rowId: "p1", field: "owner", value: "sam" },
    { type: "addRow", id: "new-1" },
    { type: "updateBody", rowId: "p1", content: "Text" },
    { type: "pagesSettled" },
  );
  assert.deepEqual(s.editLog, { on: false, pending: {}, pages: {} });
});

test("a cell edited is one set, from what it held to what it holds; the same value again is nothing", () => {
  const before = start();
  const was = rowOf(before, "p1").owner;
  const s = run(before, { type: "updateRow", rowId: "p1", field: "owner", value: "sam" });
  assert.deepEqual(kept(s), [{ op: "set", row: "p1", field: "owner", from: was, to: "sam" }]);
  assert.equal(run(s, { type: "updateRow", rowId: "p1", field: "owner", value: "sam" }).editLog, s.editLog);
  // Cleared: no `to`.
  assert.deepEqual(kept(run(s, { type: "updateRow", rowId: "p1", field: "owner", value: null })).at(-1), { op: "set", row: "p1", field: "owner", from: "sam" });
  // Nothing was kept for any other table.
  assert.deepEqual(Object.keys(s.editLog.pending), [KEY]);
});

test("each edit is its own event, in the order made", () => {
  const s = run(
    start(),
    { type: "updateRow", rowId: "p1", field: "owner", value: "a" },
    { type: "updateRow", rowId: "p2", field: "owner", value: "b" },
    { type: "updateRow", rowId: "p1", field: "owner", value: "c" },
  );
  assert.deepEqual(
    kept(s).map((c) => (c.op === "set" ? [c.row, c.to] : null)),
    [
      ["p1", "a"],
      ["p2", "b"],
      ["p1", "c"],
    ],
  );
});

test("a row added is an insert with the row as it is written", () => {
  const s = run(start(), { type: "addRow", id: "new-1" });
  assert.deepEqual(kept(s), [{ op: "insert", row: "new-1", values: rowOf(s, "new-1") }]);
});

test("a row deleted is a delete with the whole row, once the question is answered; its page is said too", () => {
  const before = start();
  const row = rowOf(before, "p10");
  const page = before.tables[KEY]!.bodies!.p10!;
  assert.ok(page.length > 0);
  const asked = run(before, { type: "deleteRow", rowId: "p10" });
  assert.deepEqual(kept(asked), []);
  assert.deepEqual(kept(run(asked, { type: "answer", response: "cancel" })), []);
  const gone = run(asked, { type: "answer", response: "delete" });
  assert.deepEqual(kept(gone), [
    { op: "delete", row: "p10", values: row },
    { op: "page", row: "p10", from: page },
  ]);
  assert.deepEqual(gone.editLog.pages, {});
});

test("undo is a new event that sets the cell back, and redo one that sets it again", () => {
  const before = start();
  const was = rowOf(before, "p1").owner;
  const s = run(before, { type: "updateRow", rowId: "p1", field: "owner", value: "sam" }, { type: "undo" }, { type: "redo" });
  assert.deepEqual(kept(s), [
    { op: "set", row: "p1", field: "owner", from: was, to: "sam" },
    { op: "set", row: "p1", field: "owner", from: "sam", to: was },
    { op: "set", row: "p1", field: "owner", from: was, to: "sam" },
  ]);
  // A row added, then undone: an insert and a delete.
  const added = run(before, { type: "addRow", id: "new-1" }, { type: "undo" });
  assert.deepEqual(
    kept(added).map((c) => [c.op, c.row]),
    [
      ["insert", "new-1"],
      ["delete", "new-1"],
    ],
  );
});

test("a page typed in is one event when it is closed: the text before the first change, and the text at the end", () => {
  const before = start();
  const page = before.tables[KEY]!.bodies!.p10!;
  const typing = run(
    before,
    { type: "openPage", rowId: "p10" },
    { type: "updateBody", rowId: "p10", content: "One" },
    { type: "updateBody", rowId: "p10", content: "One two" },
    { type: "updateBody", rowId: "p10", content: "One two three" },
  );
  // Each save of it is not an event.
  assert.deepEqual(kept(typing), []);
  assert.deepEqual(typing.editLog.pages, { [KEY]: { p10: page } });
  const closed = run(typing, { type: "openPage", rowId: null });
  assert.deepEqual(kept(closed), [{ op: "page", row: "p10", from: page, to: closed.tables[KEY]!.bodies!.p10 }]);
  assert.match(closed.tables[KEY]!.bodies!.p10!, /^One two three/);
  assert.deepEqual(closed.editLog.pages, {});
});

test("a page left as it began says nothing; one opened and not changed says nothing", () => {
  const before = start();
  const page = before.tables[KEY]!.bodies!.p10!;
  const s = run(
    before,
    { type: "openPage", rowId: "p10" },
    { type: "updateBody", rowId: "p10", content: "Changed" },
    { type: "updateBody", rowId: "p10", content: page },
    { type: "openPage", rowId: null },
  );
  assert.deepEqual(kept(s), []);
  assert.deepEqual(s.editLog.pages, {});
  assert.deepEqual(kept(run(before, { type: "openPage", rowId: "p10" }, { type: "openPage", rowId: null })), []);
});

test("a page's stretch also ends when another page opens, when another table shows, and when the app says typing has been still", () => {
  const typing = run(start(), { type: "openPage", rowId: "p10" }, { type: "updateBody", rowId: "p10", content: "New text" });
  for (const end of [
    { type: "openPage", rowId: "p13" },
    { type: "showTable", key: "crm/deals" },
    { type: "pagesSettled" },
  ] as AppAction[]) {
    const s = run(typing, end);
    assert.deepEqual(
      kept(s).map((c) => [c.op, c.row]),
      [["page", "p10"]],
      end.type,
    );
    assert.deepEqual(s.editLog.pages, {}, end.type);
  }
  // Said while still open, the next change starts a new stretch from there.
  const again = run(typing, { type: "pagesSettled" }, { type: "updateBody", rowId: "p10", content: "Newer text" }, { type: "openPage", rowId: null });
  const pages = kept(again).filter((c) => c.op === "page");
  assert.equal(pages.length, 2);
  assert.equal(pages[1]!.op === "page" && pages[1]!.from, pages[0]!.op === "page" && pages[0]!.to);
});

test("a page saved after its row's page was left (its last save landing late) is said at once", () => {
  const s = run(start(), { type: "updateBody", rowId: "p10", content: "Late", table: KEY });
  assert.deepEqual(
    kept(s).map((c) => [c.op, c.row]),
    [["page", "p10"]],
  );
});

test("the app says what it has written, and those leave; what was edited meanwhile stays", () => {
  const s = run(
    start(),
    { type: "updateRow", rowId: "p1", field: "owner", value: "a" },
    { type: "updateRow", rowId: "p1", field: "owner", value: "b" },
    { type: "updateRow", rowId: "p1", field: "owner", value: "c" },
  );
  const some = run(s, { type: "editsWritten", key: KEY, count: 2 });
  assert.deepEqual(
    kept(some).map((c) => c.op === "set" && c.to),
    ["c"],
  );
  const all = run(some, { type: "editsWritten", key: KEY, count: 1 });
  assert.deepEqual(all.editLog.pending, {});
  assert.equal(tableApp(all, { type: "editsWritten", key: KEY, count: 3 }), all);
  assert.equal(tableApp(s, { type: "editsWritten", key: "crm/deals", count: 1 }), s);
});

test("changes to fields and views aren't recorded, nor what a field's change does to the rows", () => {
  const s = run(
    start(),
    { type: "updateField", name: "owner", patch: { title: "Lead" } },
    { type: "addChoice", name: "status", value: "blocked" },
    { type: "updateView", patch: { name: "Renamed" } },
    { type: "deleteField", name: "owner" },
    { type: "answer", response: "delete" },
  );
  assert.equal(s.tables[KEY]!.schema.fields.some((f) => f.name === "owner"), false);
  assert.deepEqual(s.editLog.pending, {});
  // Nor a field's change undone: the field is back and every row has its value again, and none of that is a cell edited.
  const undone = run(s, { type: "undo" });
  assert.equal(undone.tables[KEY]!.schema.fields.some((f) => f.name === "owner"), true);
  assert.ok(undone.tables[KEY]!.rows.some((r) => r.owner !== undefined));
  assert.deepEqual(undone.editLog.pending, {});
});

test("files opened and the examples reset aren't edits; what wasn't written for a table that has gone goes with it", () => {
  const edited = run(start(), { type: "updateRow", rowId: "p1", field: "owner", value: "sam" });
  assert.equal(kept(edited).length, 1);
  const { [KEY]: _gone, ...others } = examples().tables;
  const without = run(edited, { type: "reset", fresh: { ...examples(), tables: others } }, { type: "answer", response: "reset" });
  assert.equal(KEY in without.tables, false);
  assert.deepEqual(without.editLog.pending, {});
  // Reset to the examples as they shipped, after an edit: the rows go back, and that isn't an edit to say.
  const reset = run(edited, { type: "editsWritten", key: KEY, count: 1 }, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.notEqual(rowOf(reset, "p1").owner, "sam");
  assert.deepEqual(reset.editLog.pending, {});
});

test("a table held in the index: its pages are kept here as any table's, its rows aren't here to compare", () => {
  const { tables, bundles } = examples();
  const s0 = initialAppState({ tables: { ...tables, [KEY]: { ...tables[KEY]!, rows: [], indexed: { count: 17, version: 0 } } }, bundles, writesHistory: true });
  const s = run(s0, { type: "updateRow", rowId: "p1", field: "owner", value: "sam" }, { type: "addRow", id: "new-1" }, { type: "updateBody", rowId: "p10", content: "Text", table: KEY });
  assert.deepEqual(
    kept(s).map((c) => [c.op, c.row]),
    [["page", "p10"]],
  );
});

test("rowsChanges: rows are told apart by id, so a row moved is no change; formula fields aren't recorded", () => {
  const table = examples().tables[KEY]!;
  assert.deepEqual(rowsChanges(table, { ...table, rows: [...table.rows].reverse() }), []);
  assert.deepEqual(rowsChanges(table, table), []);
  const computed = table.schema.fields.find((f) => f.computed)!.name;
  const rows = table.rows.map((r, i) => (i === 0 ? { ...r, [computed]: 12345, owner: "x" } : r));
  assert.deepEqual(rowsChanges(table, { ...table, rows }), [{ op: "set", row: table.rows[0]!.id, field: "owner", from: table.rows[0]!.owner, to: "x" }]);
  // One gone, one new, one changed: in the order the rows are now, then what has gone.
  const next = [{ id: "new" }, ...table.rows.slice(1).map((r, i) => (i === 0 ? { ...r, owner: "y" } : r))];
  assert.deepEqual(
    rowsChanges(table, { ...table, rows: next }).map((c) => [c.op, c.row]),
    [
      ["insert", "new"],
      ["set", table.rows[1]!.id],
      ["delete", table.rows[0]!.id],
    ],
  );
});
