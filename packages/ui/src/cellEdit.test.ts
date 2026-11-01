import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { commitDraft, currencySymbolOf, draftOf, editorKind, inputKind, listFromText, listText, listToggled, relatesMany, relationOptions, relationToggled } from "./cellEdit";

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
  assert.equal(editorKind({ name: "logo", type: "string", attachment: true } as Field), "attachment");
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

test("a draft the column can't hold is said once, then kept as typed; leaving keeps it outright (D65)", () => {
  const asked = commitDraft(count, 3, "2.5", "key", null);
  assert.equal(asked.kind, "problem");
  assert.equal(asked.kind === "problem" && asked.check.message, "“2.5” isn't a whole number. Press Enter again to keep it as typed.");
  assert.deepEqual(commitDraft(count, 3, "2.5", "key", asked.kind === "problem" ? asked.queried : null), { kind: "save", value: "2.5" });
  assert.deepEqual(commitDraft(count, 3, "2.5", "blur", null), { kind: "save", value: "2.5" });
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
  // An engine without formatToParts (Hermes on iOS) still gets the symbol.
  const own = Intl.NumberFormat.prototype.formatToParts;
  try {
    (Intl.NumberFormat.prototype as { formatToParts?: unknown }).formatToParts = undefined;
    assert.equal(currencySymbolOf({ name: "p", type: "number", format: "currency:GBP" }, "en-GB"), "£");
    assert.equal(currencySymbolOf({ name: "p", type: "number", format: "currency:USD" }, "en-GB"), "US$");
  } finally {
    Intl.NumberFormat.prototype.formatToParts = own;
  }
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

test("a relation is picked from its related table's rows, by their titles", async () => {
  const { tables } = await import("@workspace.sh/table-fixtures");
  const company = tables["deals"]!.schema.fields.find((f) => f.name === "company")!;
  const contacts = tables["deals"]!.schema.fields.find((f) => f.name === "contacts")!;
  const related = { companies: tables["companies"]!, contacts: tables["contacts"]! };
  assert.equal(editorKind(company), "relation");
  assert.equal(relatesMany(company), false);
  assert.equal(relatesMany(contacts), true);
  // A list of ids with no cardinality said is many too.
  assert.equal(relatesMany({ name: "x", type: "array", relation: { table: "t", field: "id" } }), true);
  const options = relationOptions(company, related);
  assert.equal(options.length, tables["companies"]!.rows.length);
  assert.deepEqual(options[0], { value: "znqnjiyryfpbdjfb57fzm6119k", label: "Northwind Traders" });
  assert.deepEqual(relationOptions(company, {}), []);
});

test("toggling a many-relation keeps the related table's order; dangling ids stay after", async () => {
  const { tables } = await import("@workspace.sh/table-fixtures");
  const contacts = tables["deals"]!.schema.fields.find((f) => f.name === "contacts")!;
  const related = { contacts: tables["contacts"]! };
  const ids = tables["contacts"]!.rows.map((r) => r.id);
  assert.deepEqual(relationToggled(contacts, [ids[2]], ids[0]!, related), [ids[0], ids[2]]);
  assert.deepEqual(relationToggled(contacts, [ids[0], "gone"], ids[1]!, related), [ids[0], ids[1], "gone"]);
  assert.equal(relationToggled(contacts, [ids[0]], ids[0]!, related), undefined);
});

test("`=` typed in a stored field's cell is its own formula; typed over one, a value or nothing takes its place (D52)", async () => {
  const { cellFormulaDraft, commitDraft } = await import("./cellEdit");
  const fields = [{ name: "price", type: "number" as const }, { name: "qty", type: "number" as const }];
  const qty = fields[1]!;
  assert.deepEqual(commitDraft(qty, 3, "=price * 2", "key", null, { fields }), { kind: "formula", expr: "(* price 2)" });
  assert.equal(commitDraft(qty, 3, "=price *", "key", null, { fields }).kind, "problem");
  // Kept as typed on leaving, or entered again (D65): its cell says it can't be read.
  assert.deepEqual(commitDraft(qty, 3, "=price *", "blur", null, { fields }), { kind: "formula", expr: "price *" });
  assert.deepEqual(commitDraft(qty, 3, "=price *", "key", "=price *", { fields }), { kind: "formula", expr: "price *" });
  // One that reads keeps an unknown function, to show #NAME?.
  assert.deepEqual(commitDraft(qty, 3, "=frobnicate(price)", "blur", null, { fields }), { kind: "formula", expr: "(frobnicate price)" });
  // The same formula again changes nothing.
  assert.deepEqual(commitDraft(qty, 6, "=price*2", "key", null, { fields, own: "(* price 2)" }), { kind: "unchanged" });
  // Typed over it: the value, even the one it shows, and nothing at all.
  assert.deepEqual(commitDraft(qty, 6, "6", "key", null, { fields, own: "(* price 2)" }), { kind: "save", value: 6 });
  assert.deepEqual(commitDraft(qty, 6, "", "key", null, { fields, own: "(* price 2)" }), { kind: "save", value: null });
  // Without a way to give a cell a formula, `=` is text like any other (and not a number).
  assert.equal(commitDraft(qty, 3, "=price * 2", "key", null).kind, "problem");
  assert.equal(cellFormulaDraft("(* price 2)"), "=price * 2");
  assert.equal(cellFormulaDraft("(* price 2)", undefined, "stored"), "=(* price 2)");
  // Edited without its `=`, which the editor draws before the box: the stored form exactly as stored.
  const { cellFormulaText, FORMULA_PREFIX } = await import("./cellEdit");
  assert.equal(cellFormulaText("(* price 2)"), "price * 2");
  assert.equal(cellFormulaText("(* price   2)", undefined, "stored"), "(* price   2)");
  // Saved with its `=` put back, in either syntax, it's the same formula.
  for (const [text, syntax] of [["price * 2", "excel"], ["(* price 2)", "stored"]] as const) {
    const r = commitDraft({ name: "n", type: "number" }, 1, FORMULA_PREFIX + text, "key", null, { fields: [{ name: "price", type: "number" }, { name: "n", type: "number" }] });
    assert.deepEqual(r, { kind: "formula", expr: "(* price 2)" }, syntax);
  }
});
