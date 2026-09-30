import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { commitDraft, currencySymbolOf, draftOf, editorKind, inputKind, listFromText, listText, listToggled } from "./cellEdit";

const count: Field = { name: "count", type: "integer" };
const due: Field = { name: "due", type: "date" };

test("each field gets its editor: none for a formula, a picker for choices", () => {
  assert.equal(editorKind({ name: "f", type: "number", computed: { expr: "1" } } as Field), "readonly");
  assert.equal(editorKind({ name: "b", type: "boolean" }), "boolean");
  assert.equal(editorKind({ name: "tags", type: "array" }), "list");
  // Related rows are picked, not typed as a list.
  assert.notEqual(editorKind({ name: "links", type: "array", relation: { table: "t", field: "id" } }), "list");
  assert.equal(editorKind({ name: "s", type: "string", constraints: { enum: ["a"] } }), "choice");
  assert.equal(editorKind({ name: "t", type: "string" }), "text");
  assert.equal(editorKind(undefined), "text");
  assert.equal(inputKind(count), "number");
  assert.equal(inputKind({ name: "d", type: "datetime" }), "datetime-local");
  assert.equal(inputKind({ name: "t", type: "string" }), "text");
});

test("an edit starts from the stored value, or nothing", () => {
  assert.equal(draftOf(12), "12");
  assert.equal(draftOf(null), "");
  assert.equal(draftOf(undefined), "");
});

test("a draft the column holds is saved; the same value is not saved again", () => {
  assert.deepEqual(commitDraft(count, 3, "4", "key", null), { kind: "save", value: 4 });
  assert.deepEqual(commitDraft(count, 4, "4", "key", null), { kind: "unchanged" });
});

test("a draft the column can't hold is refused with the reason, or dropped on leaving", () => {
  const refused = commitDraft(count, 3, "2.5", "key", null);
  assert.equal(refused.kind, "problem");
  assert.equal(refused.kind === "problem" && refused.check.message, "“2.5” isn't a whole number.");
  assert.deepEqual(commitDraft(count, 3, "2.5", "blur", null), { kind: "dropped" });
});

test("an early year is asked about once, then kept; leaving keeps it outright", () => {
  const asked = commitDraft(due, null, "0026-04-01", "key", null);
  assert.equal(asked.kind, "problem");
  const queried = asked.kind === "problem" ? asked.queried : null;
  assert.equal(queried, "0026-04-01");
  assert.deepEqual(commitDraft(due, null, "0026-04-01", "key", queried), { kind: "save", value: "0026-04-01" });
  assert.deepEqual(commitDraft(due, null, "0026-04-01", "blur", null), { kind: "save", value: "0026-04-01" });
});

test("a currency field's input shows its symbol", () => {
  assert.equal(currencySymbolOf({ name: "p", type: "number", format: "currency:GBP" }, "en-GB"), "£");
  assert.equal(currencySymbolOf({ name: "p", type: "number" }), null);
  assert.equal(currencySymbolOf({ name: "p", type: "number", format: "currency:ZZZZ" }), null);
});

test("a list is typed as comma-separated text, and read back from it", () => {
  assert.equal(listText(["a", "b"]), "a, b");
  assert.equal(listText(undefined), "");
  assert.deepEqual(listFromText(" a,, b ,"), ["a", "b"]);
  assert.equal(listFromText("  , "), undefined);
});

test("toggling a choice keeps the set in the schema's order; none left is no value", () => {
  const tags: Field = { name: "tags", type: "array", constraints: { enum: ["red", "green", "blue"] } };
  assert.deepEqual(listToggled(tags, ["blue"], "red"), ["red", "blue"]);
  assert.deepEqual(listToggled(tags, ["red", "blue"], "red"), ["blue"]);
  assert.equal(listToggled(tags, ["red"], "red"), undefined);
});
