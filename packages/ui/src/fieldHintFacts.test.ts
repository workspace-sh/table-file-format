import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field, TableSchema } from "@workspace.sh/table-core";
import { fieldHint, fieldHintText } from "./fieldHintFacts";

const amount: Field = { name: "amount", title: "Amount", type: "number", format: "currency:GBP", description: "Money in is positive.", constraints: { required: true } };
const total: Field = { name: "total", type: "number", computed: { expr: "(* amount 2)", dialect: "table-expr-v1" } };
const schema: TableSchema = { fields: [amount, total] };

test("a column's facts: its kind, rules and format, its description, and its stored key", () => {
  const hint = fieldHint({ field: amount, name: "amount", schema, editable: true });
  assert.equal(hint.title, "Amount");
  assert.deepEqual(hint.facts, ["Number", "Required", "Currency (GBP)"]);
  assert.equal(hint.description, "Money in is positive.");
  assert.equal(hint.storedAs, "Stored as “amount”");
  assert.equal(hint.editHint, "Click to edit this column");
  assert.equal(hint.formula, undefined);
});

test("a formula column says so, and shows its formula as the reader types it", () => {
  const excel = fieldHint({ field: total, name: "total", schema, editable: false });
  assert.equal(excel.facts[0], "Formula");
  assert.equal(excel.formula, "=amount * 2");
  assert.equal(fieldHint({ field: total, name: "total", schema, editable: false, formulaSyntax: "stored" }).formula, "(* amount 2)");
  assert.equal(excel.storedAs, undefined);
  assert.equal(excel.editHint, undefined);
});

test("as text: a line each, in the rich hint's order, leaving out what isn't there", () => {
  assert.equal(
    fieldHintText(fieldHint({ field: amount, name: "amount", schema, editable: true })),
    "Amount\nNumber · Required · Currency (GBP)\nMoney in is positive.\nStored as “amount”\nClick to edit this column",
  );
  assert.equal(fieldHintText(fieldHint({ field: undefined, name: "ghost", schema, editable: false })), "ghost\nUnknown field");
});
