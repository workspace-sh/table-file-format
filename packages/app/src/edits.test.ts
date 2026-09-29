import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { tables } from "@workspace.sh/table-fixtures";
import {
  onTable,
  rowTitleFor,
  withBody,
  withCell,
  withChoice,
  withField,
  withFieldMoved,
  withFieldPatch,
  withoutRow,
  withoutView,
  withRow,
  withRowAt,
  withViewPatch,
} from "./edits.ts";

const tasks = tables["tasks"]!;
const ledger = tables["ledger"]!;
const version = (t: ParsedTable) => (t.schema["schema-version"] as number | undefined) ?? 1;

test("an edit returns a new table and leaves the one it was given alone", () => {
  const edited = withCell(tasks, "t1", "title", "Renamed");
  assert.equal(edited.rows.find((r) => r.id === "t1")!.title, "Renamed");
  assert.equal(tasks.rows.find((r) => r.id === "t1")!.title, "Land .table extension");
  assert.equal(edited.rows.length, tasks.rows.length);
});

test("a new row is an id at the end; deleting one takes its body with it", () => {
  const added = withRow(tasks, "new1");
  assert.deepEqual(added.rows.at(-1), { id: "new1" });
  const withPage = withBody(added, "new1", "# Notes");
  assert.equal(withPage.bodies?.["new1"], "# Notes");
  const gone = withoutRow(withPage, "new1");
  assert.equal(gone.rows.some((r) => r.id === "new1"), false);
  assert.equal(gone.bodies?.["new1"], undefined);
  assert.equal(withBody(withPage, "new1", "").bodies?.["new1"], undefined);
});

test("a row goes above or below another in a Sheet view's file order", () => {
  const first = ledger.rows[0]!.id;
  const below = withRowAt(ledger, "as-entered", first, "below", "ins");
  assert.equal(below.rows[1]!.id, "ins");
  const above = withRowAt(ledger, "as-entered", first, "above", "ins");
  assert.equal(above.rows[0]!.id, "ins");
});

test("a field's title is cosmetic; its constraints, formula or relation bump the schema version", () => {
  assert.equal(version(withFieldPatch(tasks, "title", { title: "Task" })), version(tasks));
  assert.equal(version(withFieldPatch(tasks, "priority", { constraints: { minimum: 1 } })), version(tasks) + 1);
  assert.equal(version(withFieldPatch(tasks, "priority", { computed: { expr: "1" } } as never)), version(tasks) + 1);
});

test("a choice is added once, whether the schema writes it as a string or an object", () => {
  // Deals' stages are objects ({ value, label, color }).
  const deals = tables["deals"]!;
  assert.equal(withChoice(deals, "stage", "won"), deals);
  const status = tasks.schema.fields.find((f) => f.name === "status")!;
  const first = status.constraints!.enum![0]!;
  const existing = typeof first === "string" ? first : first.value;
  assert.equal(withChoice(tasks, "status", existing), tasks);
  const added = withChoice(tasks, "status", "blocked");
  assert.equal(added.schema.fields.find((f) => f.name === "status")!.constraints!.enum!.length, status.constraints!.enum!.length + 1);
  assert.equal(version(added), version(tasks) + 1);
});

test("fields move one place, not past either end", () => {
  const moved = withFieldMoved(tasks, "project", -1);
  assert.deepEqual(moved.schema.fields.slice(0, 2).map((f) => f.name), ["project", "title"]);
  assert.equal(withFieldMoved(tasks, "title", -1), tasks);
});

test("a new field joins the view it was added from, when that view lists its fields", () => {
  const listing = withViewPatch(withViewPatch(tasks, "v1", { fields: ["title"] }), "v2", { fields: ["title", "status"] });
  const added = withField(listing, { name: "notes", type: "string" }, "v1");
  assert.deepEqual(added.views.find((v) => v.id === "v1")!.fields, ["title", "notes"]);
  assert.deepEqual(added.views.find((v) => v.id === "v2")!.fields, ["title", "status"]);
  assert.equal(withField(added, { name: "notes", type: "string" }, "v1"), added);
});

test("the last view is never removed", () => {
  const one = withoutView(tasks, "v2");
  assert.equal(one.views.length, 1);
  assert.equal(withoutView(one, "v1"), one);
});

test("onTable edits one table in an app's map and leaves the rest", () => {
  const all = { "projects/tasks": tasks, "household-budget/ledger": ledger };
  const next = onTable(all, "projects/tasks", (t) => withCell(t, "t1", "priority", 9));
  assert.equal(next["household-budget/ledger"], ledger);
  assert.equal(next["projects/tasks"]!.rows[0]!.priority, 9);
  assert.equal(onTable(all, "nope/none", (t) => t), all);
});

test("a row is named by its first text field", () => {
  assert.equal(rowTitleFor(tasks, "t1"), "Land .table extension");
  assert.equal(rowTitleFor(tasks, "missing"), "missing");
});
