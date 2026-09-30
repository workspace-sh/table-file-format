import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field, TableSchema } from "@workspace.sh/table-core";
import {
  canUseLayout,
  filterOnField,
  filtersPatch,
  filterWithOperator,
  layoutOptions,
  layoutPatch,
  newFilter,
  newSort,
  picksChoice,
  sortsPatch,
  viewFieldChoices,
  filterValueFrom,
  filterValueText,
  layoutFieldFor,
  operatorsFor,
  takesValue,
} from "./viewEdit.ts";

const budget: Field = { name: "budget", type: "number" };
const status: Field = { name: "status", type: "string", constraints: { enum: ["todo", "doing", "done"] } };
const title: Field = { name: "title", type: "string" };
const done: Field = { name: "shipped", type: "boolean" };
const due: Field = { name: "due", type: "date" };

test("each field offers the operators that mean something for it", () => {
  assert.ok(operatorsFor(budget).includes("gt"));
  assert.ok(!operatorsFor(budget).includes("contains"));
  assert.ok(operatorsFor(title).includes("contains"));
  assert.ok(!operatorsFor(status).includes("contains"));
  assert.deepEqual(operatorsFor(done), ["eq", "neq", "empty", "not_empty"]);
  assert.ok(operatorsFor(due).includes("lt"));
});

test("typed values are stored as the field's type", () => {
  assert.equal(filterValueFrom(budget, "gt", " 10000 "), 10000);
  assert.equal(filterValueFrom(done, "eq", "true"), true);
  assert.equal(filterValueFrom(title, "contains", " Sync "), "Sync");
  assert.equal(filterValueFrom(due, "lt", "2026-04-01"), "2026-04-01");
  // Not a number yet: kept as typed, so nothing the person wrote is lost.
  assert.equal(filterValueFrom(budget, "gt", "10k"), "10k");
});

test("any of / none of take a comma-separated list", () => {
  assert.deepEqual(filterValueFrom(status, "in", "todo, doing,"), ["todo", "doing"]);
  assert.deepEqual(filterValueFrom(budget, "not_in", "1, 2"), [1, 2]);
  assert.equal(filterValueText(["todo", "doing"]), "todo, doing");
});

test("is empty and is not empty stand alone", () => {
  assert.equal(takesValue("empty"), false);
  assert.equal(filterValueFrom(title, "not_empty", "ignored"), undefined);
  assert.equal(filterValueText(undefined), "");
});

test("a layout starts from the field it needs, and isn't offered without one", () => {
  const schema: TableSchema = { fields: [title, budget, status, due] };
  assert.equal(layoutFieldFor("board", schema), "status");
  assert.equal(layoutFieldFor("calendar", schema), "due");
  const plain: TableSchema = { fields: [title] };
  assert.equal(layoutFieldFor("board", plain), "title");
  assert.equal(canUseLayout("calendar", plain), false);
  assert.equal(canUseLayout("table", plain), true);
  const deprecated: TableSchema = { fields: [{ ...due, deprecated: true }] };
  assert.equal(canUseLayout("calendar", deprecated), false);
});

test("a list field is asked about its items", () => {
  const tags: Field = { name: "tags", type: "array", constraints: { enum: ["emea", "priority"] } };
  assert.deepEqual(operatorsFor(tags), ["contains", "not_contains", "in", "not_in", "empty", "not_empty"]);
  assert.equal(filterValueFrom(tags, "contains", " emea "), "emea");
  assert.deepEqual(filterValueFrom(tags, "in", "emea, priority"), ["emea", "priority"]);
});


test("layouts the table can't use are offered disabled, with the reason", () => {
  const noDates = { fields: [{ name: "title", type: "string" as const }] };
  const cal = layoutOptions(noDates).find((o) => o.value === "calendar")!;
  assert.deepEqual(cal, { value: "calendar", label: "Calendar (needs a date field)", disabled: true });
  assert.equal(layoutOptions(noDates).find((o) => o.value === "board")!.disabled, false);
});

test("switching to a board or calendar starts from a field it can use, and keeps one already set", () => {
  const schema = { fields: [{ name: "title", type: "string" as const }, { name: "when", type: "date" as const }] };
  const view = { id: "v", name: "V", layout: "table" as const };
  assert.deepEqual(layoutPatch(view, schema, "calendar"), { layout: "calendar", calendar_field: "when" });
  assert.deepEqual(layoutPatch({ ...view, board_field: "x" }, schema, "board"), { layout: "board" });
  assert.deepEqual(layoutPatch({ ...view, calendar_field: "other" }, schema, "calendar"), { layout: "calendar" });
});

test("a sort drops a dragged order; no filters or sorts is none at all", () => {
  assert.deepEqual(sortsPatch([{ field: "a", direction: "asc" }]), { sort: [{ field: "a", direction: "asc" }], order: undefined });
  assert.deepEqual(sortsPatch([]), { sort: undefined, order: undefined });
  assert.deepEqual(filtersPatch([]), { filter: undefined });
});

test("new filters and sorts start on a field; a sort never repeats one", () => {
  const live = [{ name: "a", type: "string" as const }, { name: "n", type: "number" as const }];
  assert.equal(newFilter(live)!.field, "a");
  assert.equal(newFilter([]), null);
  assert.deepEqual(newSort(live, [{ field: "a", direction: "asc" }]), { field: "n", direction: "asc" });
  assert.equal(newSort(live, [{ field: "a", direction: "asc" }, { field: "n", direction: "desc" }]), null);
});

test("a filter keeps its operator on a field that has it, and carries a typed value to a new operator", () => {
  const text = { name: "t", type: "string" as const };
  const num = { name: "n", type: "number" as const };
  assert.equal(filterOnField({ field: "t", operator: "contains", value: "x" }, text).operator, "contains");
  const moved = filterOnField({ field: "t", operator: "starts_with", value: "x" }, num);
  assert.deepEqual(moved, { field: "n", operator: operatorsFor(num)[0] });
  assert.deepEqual(filterWithOperator({ field: "n", operator: "eq" }, num, "gt", "5"), { field: "n", operator: "gt", value: 5 });
  assert.deepEqual(filterWithOperator({ field: "n", operator: "eq", value: 5 }, num, "empty", "5"), { field: "n", operator: "empty" });
});

test("a choice field's value is picked for is, is not, contains; typed otherwise", () => {
  const status = { name: "s", type: "string" as const, constraints: { enum: ["a", "b"] } };
  assert.equal(picksChoice(status, "eq"), true);
  assert.equal(picksChoice(status, "starts_with"), false);
  assert.equal(picksChoice({ name: "t", type: "string" }, "eq"), false);
  const link = { name: "l", type: "string" as const, relation: { table: "t", field: "id" } };
  const { board, date, group, live } = viewFieldChoices({ fields: [status, link, { name: "d", type: "date" }, { name: "f", type: "number", computed: { expr: "1" } } as never, { name: "old", type: "string", deprecated: true }] });
  assert.deepEqual(live.map((f) => f.name), ["s", "l", "d", "f"]);
  // A relation's values are ids: no board columns from those.
  assert.deepEqual(board.map((f) => f.name), ["s"]);
  assert.deepEqual(date.map((f) => f.name), ["d"]);
  assert.deepEqual(group.map((f) => f.name), ["s", "l", "d"]);
});
