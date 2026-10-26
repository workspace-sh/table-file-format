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
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" },
    { type: "addRow", id: "new-1" },
    { type: "updateBody", rowId: "xsdxifzn73ohismzm8q5uri8fe", content: "Text" },
    { type: "pagesSettled" },
  );
  assert.deepEqual(s.editLog, { on: false, pending: {}, pages: {} });
});

test("a cell edited is one set, from what it held to what it holds; the same value again is nothing", () => {
  const before = start();
  const was = rowOf(before, "xsdxifzn73ohismzm8q5uri8fe").owner;
  const s = run(before, { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" });
  assert.deepEqual(kept(s), [{ op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: was, to: "sam" }]);
  assert.equal(run(s, { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" }).editLog, s.editLog);
  // Cleared: no `to`.
  assert.deepEqual(kept(run(s, { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: null })).at(-1), { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "sam" });
  // Nothing was kept for any other table.
  assert.deepEqual(Object.keys(s.editLog.pending), [KEY]);
});

test("each edit is its own event, in the order made", () => {
  const s = run(
    start(),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "a" },
    { type: "updateRow", rowId: "1h38m5st7rwanz3hyjb6dy8igr", field: "owner", value: "b" },
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "c" },
  );
  assert.deepEqual(
    kept(s).map((c) => (c.op === "set" ? [c.row, c.to] : null)),
    [
      ["xsdxifzn73ohismzm8q5uri8fe", "a"],
      ["1h38m5st7rwanz3hyjb6dy8igr", "b"],
      ["xsdxifzn73ohismzm8q5uri8fe", "c"],
    ],
  );
});

test("a row added is an insert with the row as it is written", () => {
  const s = run(start(), { type: "addRow", id: "new-1" });
  assert.deepEqual(kept(s), [{ op: "insert", row: "new-1", values: rowOf(s, "new-1") }]);
});

test("a row deleted is a delete with the whole row, once the question is answered; its page is said too", () => {
  const before = start();
  const row = rowOf(before, "ryumw55g4nqi7ytmzrudb7fyru");
  const page = before.tables[KEY]!.bodies!["ryumw55g4nqi7ytmzrudb7fyru"]!;
  assert.ok(page.length > 0);
  const asked = run(before, { type: "deleteRow", rowId: "ryumw55g4nqi7ytmzrudb7fyru" });
  assert.deepEqual(kept(asked), []);
  assert.deepEqual(kept(run(asked, { type: "answer", response: "cancel" })), []);
  const gone = run(asked, { type: "answer", response: "delete" });
  assert.deepEqual(kept(gone), [
    { op: "delete", row: "ryumw55g4nqi7ytmzrudb7fyru", values: row },
    { op: "page", row: "ryumw55g4nqi7ytmzrudb7fyru", from: page },
  ]);
  assert.deepEqual(gone.editLog.pages, {});
});

test("undo is a new event that sets the cell back, and redo one that sets it again", () => {
  const before = start();
  const was = rowOf(before, "xsdxifzn73ohismzm8q5uri8fe").owner;
  const s = run(before, { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" }, { type: "undo" }, { type: "redo" });
  assert.deepEqual(kept(s), [
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: was, to: "sam" },
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "sam", to: was },
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: was, to: "sam" },
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
  const page = before.tables[KEY]!.bodies!["ryumw55g4nqi7ytmzrudb7fyru"]!;
  const typing = run(
    before,
    { type: "openPage", rowId: "ryumw55g4nqi7ytmzrudb7fyru" },
    { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "One" },
    { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "One two" },
    { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "One two three" },
  );
  // Each save of it is not an event.
  assert.deepEqual(kept(typing), []);
  assert.deepEqual(typing.editLog.pages, { [KEY]: { "ryumw55g4nqi7ytmzrudb7fyru": page } });
  const closed = run(typing, { type: "openPage", rowId: null });
  // As the page's file holds each: ending in a newline.
  assert.deepEqual(kept(closed), [{ op: "page", row: "ryumw55g4nqi7ytmzrudb7fyru", from: page.endsWith("\n") ? page : page + "\n", to: "One two three\n" }]);
  assert.deepEqual(closed.editLog.pages, {});
});

test("a page left as it began says nothing; one opened and not changed says nothing", () => {
  const before = start();
  const page = before.tables[KEY]!.bodies!["ryumw55g4nqi7ytmzrudb7fyru"]!;
  const s = run(
    before,
    { type: "openPage", rowId: "ryumw55g4nqi7ytmzrudb7fyru" },
    { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "Changed" },
    { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: page },
    { type: "openPage", rowId: null },
  );
  assert.deepEqual(kept(s), []);
  assert.deepEqual(s.editLog.pages, {});
  assert.deepEqual(kept(run(before, { type: "openPage", rowId: "ryumw55g4nqi7ytmzrudb7fyru" }, { type: "openPage", rowId: null })), []);
});

test("a page's stretch also ends when another page opens, when another table shows, and when the app says typing has been still", () => {
  const typing = run(start(), { type: "openPage", rowId: "ryumw55g4nqi7ytmzrudb7fyru" }, { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "New text" });
  for (const end of [
    { type: "openPage", rowId: "jqujockyrs4yw6k6uue9h97tp1" },
    { type: "showTable", key: "crm/deals" },
    { type: "pagesSettled" },
  ] as AppAction[]) {
    const s = run(typing, end);
    assert.deepEqual(
      kept(s).map((c) => [c.op, c.row]),
      [["page", "ryumw55g4nqi7ytmzrudb7fyru"]],
      end.type,
    );
    assert.deepEqual(s.editLog.pages, {}, end.type);
  }
  // Said while still open, the next change starts a new stretch from there.
  const again = run(typing, { type: "pagesSettled" }, { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "Newer text" }, { type: "openPage", rowId: null });
  const pages = kept(again).filter((c) => c.op === "page");
  assert.equal(pages.length, 2);
  assert.equal(pages[1]!.op === "page" && pages[1]!.from, pages[0]!.op === "page" && pages[0]!.to);
});

test("a page saved after its row's page was left (its last save landing late) is said at once", () => {
  const s = run(start(), { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "Late", table: KEY });
  assert.deepEqual(
    kept(s).map((c) => [c.op, c.row]),
    [["page", "ryumw55g4nqi7ytmzrudb7fyru"]],
  );
});

test("the app says what it has written, and those leave; what was edited meanwhile stays", () => {
  const s = run(
    start(),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "a" },
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "b" },
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "c" },
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
  const edited = run(start(), { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" });
  assert.equal(kept(edited).length, 1);
  const { [KEY]: _gone, ...others } = examples().tables;
  const without = run(edited, { type: "reset", fresh: { ...examples(), tables: others } }, { type: "answer", response: "reset" });
  assert.equal(KEY in without.tables, false);
  assert.deepEqual(without.editLog.pending, {});
  // Reset to the examples as they shipped, after an edit: the rows go back, and that isn't an edit to say.
  const reset = run(edited, { type: "editsWritten", key: KEY, count: 1 }, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.notEqual(rowOf(reset, "xsdxifzn73ohismzm8q5uri8fe").owner, "sam");
  assert.deepEqual(reset.editLog.pending, {});
  // An edit not yet written when they are reset, and a page being typed, go too: the files are new.
  const unwritten = run(edited, { type: "openPage", rowId: "ryumw55g4nqi7ytmzrudb7fyru" }, { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "Typing" }, { type: "reset", fresh: examples() }, { type: "answer", response: "reset" });
  assert.deepEqual(unwritten.editLog, { on: true, pending: {}, pages: {} });
  // Cancelled, they stay.
  const cancelled = run(edited, { type: "reset", fresh: examples() }, { type: "answer", response: "cancel" });
  assert.equal(kept(cancelled).length, 1);
});

// Tables held in the index: the rows aren't in the state, so each edit is said when the app has made it.

const indexedStart = (writesHistory = true): AppState => {
  const { tables, bundles } = examples();
  return initialAppState({ tables: { ...tables, [KEY]: { ...tables[KEY]!, rows: [], indexed: { count: 17, version: 0 } } }, bundles, writesHistory });
};

test("an indexed table's cell edit is said once the index has made it, from what the index held", () => {
  const queued = run(indexedStart(), { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" });
  // Not before: only the index knows what it replaced.
  assert.deepEqual(kept(queued), []);
  const made = run(queued, { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "leslie" } } });
  assert.deepEqual(kept(made), [{ op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "leslie", to: "sam" }]);
  // A cell that was empty has no from; one cleared has no to.
  const filled = run(queued, { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: null } } });
  assert.deepEqual(kept(filled), [{ op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", to: "sam" }]);
  const cleared = run(
    indexedStart(),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: null },
    { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "leslie" } } },
  );
  assert.deepEqual(kept(cleared), [{ op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "leslie" }]);
});

test("an indexed table's edit that changed nothing says nothing; one not yet made waits", () => {
  const s = run(
    indexedStart(),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "leslie" },
    { type: "updateRow", rowId: "1h38m5st7rwanz3hyjb6dy8igr", field: "owner", value: "sam" },
    { type: "updateRow", rowId: "4csppbyqkcmq3kf4y7zbxeeumg", field: "owner", value: "kim" },
    // The first two are made: the first changed nothing, so the index says nothing undoes it.
    { type: "indexed", key: KEY, count: 17, done: 2, back: { 2: { kind: "cell", rowId: "1h38m5st7rwanz3hyjb6dy8igr", field: "owner", value: "leslie" } } },
  );
  assert.deepEqual(
    kept(s).map((c) => [c.op, c.row]),
    [["set", "1h38m5st7rwanz3hyjb6dy8igr"]],
  );
  const later = run(s, { type: "indexed", key: KEY, count: 17, done: 3, back: { 3: { kind: "cell", rowId: "4csppbyqkcmq3kf4y7zbxeeumg", field: "owner", value: "sam" } } });
  assert.deepEqual(
    kept(later).map((c) => [c.op, c.row]),
    [
      ["set", "1h38m5st7rwanz3hyjb6dy8igr"],
      ["set", "4csppbyqkcmq3kf4y7zbxeeumg"],
    ],
  );
});

test("an indexed table's row added is an insert, and one removed a delete with the row the index held, and its page", () => {
  const added = run(indexedStart(), { type: "addRow", id: "new-1" }, { type: "indexed", key: KEY, count: 18, done: 1, back: { 1: { kind: "remove", rowId: "new-1" } } });
  assert.deepEqual(kept(added), [{ op: "insert", row: "new-1", values: { id: "new-1" } }]);
  const before = indexedStart();
  const page = before.tables[KEY]!.bodies!["ryumw55g4nqi7ytmzrudb7fyru"]!;
  const row = { id: "ryumw55g4nqi7ytmzrudb7fyru", title: "Plugin SDK", owner: "claude" };
  const asked = run(before, { type: "deleteRow", rowId: "ryumw55g4nqi7ytmzrudb7fyru" }, { type: "answer", response: "delete" });
  // Its page is the state's, and said at once; the row waits for the index.
  assert.deepEqual(kept(asked), [{ op: "page", row: "ryumw55g4nqi7ytmzrudb7fyru", from: page }]);
  const removed = run(asked, { type: "indexed", key: KEY, count: 16, done: 1, back: { 1: { kind: "restore", rowId: "ryumw55g4nqi7ytmzrudb7fyru", row, at: 9 } } });
  assert.deepEqual(kept(removed), [
    { op: "page", row: "ryumw55g4nqi7ytmzrudb7fyru", from: page },
    { op: "delete", row: "ryumw55g4nqi7ytmzrudb7fyru", values: row },
  ]);
  // Two added, one made so far: only that one is said.
  const one = run(indexedStart(), { type: "addRow", id: "new-1" }, { type: "addRow", id: "new-2" }, { type: "indexed", key: KEY, count: 18, done: 1, back: { 1: { kind: "remove", rowId: "new-1" } } });
  assert.deepEqual(
    kept(one).map((c) => c.row),
    ["new-1"],
  );
  // No such row in the index: nothing was removed, and nothing is said.
  const nothing = run(indexedStart(), { type: "deleteRow", rowId: "nope" }, { type: "answer", response: "delete" }, { type: "indexed", key: KEY, count: 17, done: 1 });
  assert.deepEqual(kept(nothing), []);
});

test("undo and redo of an indexed table's edits are new events, as any table's", () => {
  const edited = run(
    indexedStart(),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" },
    { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "leslie" } } },
  );
  // (The queue was empty again, so the undo's edit is counted from one.)
  const undone = run(edited, { type: "undo" }, { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" } } });
  assert.deepEqual(kept(undone), [
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "leslie", to: "sam" },
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", from: "sam", to: "leslie" },
  ]);
  // A row removed, then put back by undo: a delete, then an insert with the whole row.
  const row = { id: "4csppbyqkcmq3kf4y7zbxeeumg", title: "X" };
  const removed = run(
    indexedStart(),
    { type: "deleteRow", rowId: "4csppbyqkcmq3kf4y7zbxeeumg" },
    { type: "answer", response: "delete" },
    { type: "indexed", key: KEY, count: 16, done: 1, back: { 1: { kind: "restore", rowId: "4csppbyqkcmq3kf4y7zbxeeumg", row, at: 2 } } },
    { type: "undo" },
    { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "remove", rowId: "4csppbyqkcmq3kf4y7zbxeeumg" } } },
  );
  assert.deepEqual(
    kept(removed).filter((c) => c.op !== "page"),
    [
      { op: "delete", row: "4csppbyqkcmq3kf4y7zbxeeumg", values: row },
      { op: "insert", row: "4csppbyqkcmq3kf4y7zbxeeumg", values: row },
    ],
  );
});

test("an indexed table's pages are kept as any table's, and nothing is kept by an app that doesn't write history", () => {
  const s = run(indexedStart(), { type: "updateBody", rowId: "ryumw55g4nqi7ytmzrudb7fyru", content: "Text", table: KEY }, { type: "indexed", key: KEY, count: 17, done: 1 });
  assert.deepEqual(
    kept(s).map((c) => [c.op, c.row]),
    [["page", "ryumw55g4nqi7ytmzrudb7fyru"]],
  );
  const off = run(
    indexedStart(false),
    { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" },
    { type: "indexed", key: KEY, count: 17, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "leslie" } } },
  );
  assert.deepEqual(off.editLog, { on: false, pending: {}, pages: {} });
  // Another table's edits, made in the same breath, aren't taken for this one's.
  const two = run(indexedStart(), { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "sam" }, { type: "indexed", key: "crm/deals", count: 5, done: 1, back: { 1: { kind: "cell", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "owner", value: "x" } } });
  assert.deepEqual(two.editLog.pending, {});
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

test("a cell given its own formula: its value goes, history says a set and a formula, undo puts both back, a value typed over it takes its place (D52)", () => {
  const before = start();
  const budget = rowOf(before, "xsdxifzn73ohismzm8q5uri8fe").budget;
  const s = run(before, { type: "setCellFormula", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: "(* 2 1000)" });
  assert.deepEqual(s.tables[KEY]!.cells, [{ id: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: "(* 2 1000)" }]);
  assert.equal("budget" in rowOf(s, "xsdxifzn73ohismzm8q5uri8fe"), false);
  assert.deepEqual(kept(s), [
    { op: "set", row: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", from: budget },
    { op: "formula", row: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", to: "(* 2 1000)" },
  ]);
  // Undone: the value back, the formula gone.
  const undone = run(s, { type: "undo" });
  assert.equal(rowOf(undone, "xsdxifzn73ohismzm8q5uri8fe").budget, budget);
  assert.equal(undone.tables[KEY]!.cells, undefined);
  // A value typed over it takes its place.
  const typed = run(s, { type: "updateRow", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", value: 5 });
  assert.equal(typed.tables[KEY]!.cells, undefined);
  assert.deepEqual(kept(typed).at(-1), { op: "formula", row: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", from: "(* 2 1000)" });
  // Taken away by itself.
  assert.equal(run(s, { type: "setCellFormula", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: null }).tables[KEY]!.cells, undefined);
});

test("a row deleted with a cell's own formula has it in its delete event", () => {
  const s = run(start(), { type: "setCellFormula", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: "1" }, { type: "deleteRow", rowId: "xsdxifzn73ohismzm8q5uri8fe" }, { type: "answer", response: "delete" });
  const gone = kept(s).find((c) => c.op === "delete")!;
  assert.deepEqual(gone.op === "delete" && gone.cells, { budget: { expr: "1" } });
  assert.equal(s.tables[KEY]!.cells, undefined);
});

test("a cell's note (D57): asked with the one it has, saved and said, kept when a formula comes and goes", () => {
  const s0 = start();
  const asked = run(s0, { type: "askCellNote", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget" });
  assert.equal(asked.asking?.kind, "name");
  assert.equal(asked.asking?.kind === "name" ? asked.asking.prompt.heading : "", "Note on Budget");
  const noted = run(asked, { type: "answer", response: "create", text: "Approved in March" });
  assert.deepEqual(noted.tables[KEY]!.cells, [{ id: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", note: "Approved in March" }]);
  assert.deepEqual(kept(noted).at(-1), { op: "note", row: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", to: "Approved in March" });
  // Asked again, it starts from the note.
  const again = run(noted, { type: "askCellNote", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget" });
  assert.equal(again.asking?.kind === "name" ? again.asking.prompt.value : "", "Approved in March");
  // A formula given and taken away: the note stays.
  const withFormula = run(noted, { type: "setCellFormula", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: "1" }, { type: "setCellFormula", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", expr: null });
  assert.deepEqual(withFormula.tables[KEY]!.cells, [{ id: "xsdxifzn73ohismzm8q5uri8fe", field: "budget", note: "Approved in March" }]);
  // Emptied: gone.
  const cleared = run(noted, { type: "askCellNote", rowId: "xsdxifzn73ohismzm8q5uri8fe", field: "budget" }, { type: "answer", response: "create", text: "" });
  assert.equal(cleared.tables[KEY]!.cells, undefined);
});

test("a table set to repeat its loops: its meta says so, the file is to be written, nothing goes in history, and undo takes it back (D60)", () => {
  const s = run(start(), { type: "setIteration", iteration: { max: 100, change: 0.001 } });
  assert.deepEqual(s.tables[KEY]!.meta?.iteration, { max: 100, change: 0.001 });
  assert.deepEqual(s.dirty, ["projects"]);
  assert.deepEqual(kept(s), []);
  assert.equal(run(s, { type: "undo" }).tables[KEY]!.meta?.iteration, undefined);
  assert.equal(run(s, { type: "setIteration", iteration: null }).tables[KEY]!.meta?.iteration, undefined);
});
