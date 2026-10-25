import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtures } from "@workspace.sh/table-fixtures";

import { initialAppState, tableApp, type AppAction, type AppState } from "./appState.ts";
import { fromBundle } from "./bundles.ts";
import { departedText } from "./departed.ts";

const BOOKS = "library/books";

const start = (): AppState => {
  const tables: Record<string, ParsedTable> = {};
  const bundles: Record<string, BundleMeta> = {};
  for (const [key, b] of Object.entries(fixtures)) {
    Object.assign(tables, fromBundle(key, b));
    bundles[key] = b.meta;
  }
  return tableApp(initialAppState({ tables, bundles }), { type: "showView", key: BOOKS, viewId: "eho3sibxpturhakhgqn8zdnsza" });
};

const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(tableApp, state);
const unread = (s: AppState) => s.tables[BOOKS]!.rows.filter((r) => r.read === false);
const read = (rowId: string): AppAction => ({ type: "updateRow", rowId, field: "read", value: true });

test("Ticking Read in To read counts the row that left, named by its title", () => {
  const s = start();
  const [first] = unread(s);
  const after = run(s, read(first!.id));
  assert.equal(after.departed?.rows.length, 1);
  assert.deepEqual(after.departed?.rows[0], { rowId: first!.id, field: "read", was: false });
  const text = departedText(after.departed!, after.tables[BOOKS]!, "To read");
  assert.equal(text.label, `“${first!.title}” left To read`);
});

test("More ticks count on in one toast, and the count leads", () => {
  const s = start();
  const [a, b, c] = unread(s);
  const after = run(s, read(a!.id), read(b!.id), read(c!.id));
  assert.equal(after.departed?.rows.length, 3);
  assert.equal(after.departed?.n, 3);
  const text = departedText(after.departed!, after.tables[BOOKS]!, "To read");
  assert.equal(text.lead, "3");
  assert.equal(text.rest, " books left To read");
});

test("Put back returns every counted row as one step, which undo takes back and redo makes again", () => {
  const s = start();
  const [a, b, c] = unread(s);
  const ticked = run(s, read(a!.id), read(b!.id), read(c!.id));
  const steps = ticked.undo[BOOKS]!.past.length;
  const back = run(ticked, { type: "putBackDeparted" });
  assert.equal(back.departed, null);
  assert.deepEqual(unread(back).map((r) => r.id), unread(s).map((r) => r.id));
  assert.equal(back.undo[BOOKS]!.past.length, steps + 1);
  assert.equal(back.undo[BOOKS]!.past.at(-1)!.name, "Put Back 3 Rows");
  const undone = run(back, { type: "undo" });
  assert.equal(unread(undone).length, unread(s).length - 3);
  const redone = run(undone, { type: "redo" });
  assert.equal(unread(redone).length, unread(s).length);
});

test("An edit between two ticks isn't undone by the put back", () => {
  const s = start();
  const [a, b] = unread(s);
  const after = run(s, read(a!.id), { type: "updateRow", rowId: "ik9jdn1jye4ajepnxiimo3xc6a", field: "rating", value: 5 }, read(b!.id));
  // A typed value ends the toast: only the tick after it is counted.
  assert.deepEqual(after.departed?.rows.map((r) => r.rowId), [b!.id]);
  const back = run(after, { type: "putBackDeparted" });
  assert.equal(back.tables[BOOKS]!.rows.find((r) => r.id === "ik9jdn1jye4ajepnxiimo3xc6a")!.rating, 5);
  assert.equal(back.tables[BOOKS]!.rows.find((r) => r.id === a!.id)!.read, true);
  assert.equal(back.tables[BOOKS]!.rows.find((r) => r.id === b!.id)!.read, false);
});

test("A discrete edit that keeps the row in view counts nothing, and the toast's rows stay", () => {
  const s = start();
  const [a, b] = unread(s);
  const after = run(s, read(a!.id), { type: "updateRow", rowId: b!.id, field: "genre", value: "history" });
  assert.deepEqual(after.departed?.rows.map((r) => r.rowId), [a!.id]);
});

test("Another view or the toast's end clears it", () => {
  const s = start();
  const [a] = unread(s);
  const ticked = run(s, read(a!.id));
  assert.equal(run(ticked, { type: "showView", key: BOOKS, viewId: "9gcz9d8ctoqamitkgwfhiu7sru" }).departed, null);
  assert.equal(run(ticked, { type: "departedDone" }).departed, null);
});

test("In a view without a filter, ticking takes nothing out", () => {
  const s = run(start(), { type: "showView", key: BOOKS, viewId: "9gcz9d8ctoqamitkgwfhiu7sru" });
  const [a] = unread(s);
  assert.equal(run(s, read(a!.id)).departed, null);
});
