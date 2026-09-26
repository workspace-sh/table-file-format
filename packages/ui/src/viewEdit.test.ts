import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field, TableSchema } from "@workspace.sh/table-core";
import {
  canUseLayout,
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
