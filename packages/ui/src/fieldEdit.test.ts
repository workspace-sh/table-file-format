import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { tables } from "@workspace.sh/table-fixtures";
import {
  addableChoices,
  alignLabel,
  alignPatch,
  fieldFormula,
  formatFamily,
  formatState,
  friendlyType,
  newChoice,
  newField,
  requiredPatch,
  takesChoices,
} from "./fieldEdit";

const budget = tables["budget"]!.schema.fields;
const deals = tables["deals"]!.schema.fields;
const f = (fields: Field[], name: string) => fields.find((x) => x.name === name)!;

test("types and alignments are called what people call them", () => {
  assert.equal(friendlyType("boolean"), "Checkbox");
  assert.equal(alignLabel("start", false), "Left");
  assert.equal(alignLabel("start", true), "Right");
  assert.equal(alignLabel("center", true), "Center");
  assert.deepEqual(alignPatch("auto"), { align: undefined });
  assert.deepEqual(alignPatch("end"), { align: "end" });
});

test("a number's format picker: currency keeps its code, decimal its places", () => {
  const value = formatState(f(deals, "value"), deals, { locale: "en-GB" })!;
  assert.equal(value.family, "number");
  assert.equal(value.kind, "currency");
  assert.equal(value.code, "USD");
  assert.deepEqual(value.choose("decimal"), { format: "decimal:2" });
  assert.deepEqual(value.choose("currency"), { format: "currency:USD" });
  assert.deepEqual(value.choose(""), { format: undefined });
  assert.equal(value.notes.length, 1);
  assert.equal(value.notes[0]!.kind, "note");
});

test("a formula shows its inputs' currency, and warns when shown in another", () => {
  const quarter = formatState(f(budget, "quarter"), budget, {})!;
  assert.equal(quarter.choices[0]!.label, "Same as inputs (GBP)");
  // Switched to currency, a formula takes its inputs' (yen here), not the reader's.
  const yen: Field[] = [{ name: "a", type: "number", format: "currency:JPY" }, { name: "b", type: "number", computed: { expr: "(* a 2)" } } as Field];
  assert.deepEqual(formatState(yen[1]!, yen, {})!.choose("currency"), { format: "currency:JPY" });
  const inDollars = formatState({ ...f(budget, "quarter"), format: "currency:USD" }, budget, {})!;
  assert.equal(inDollars.notes[0]!.kind, "warn");
  assert.match(inDollars.notes[0]!.text, /worked out from values in GBP/);
});

test("date formats show today as an example; types without formats have none", () => {
  const close = formatState(f(deals, "close_date"), deals, { locale: "en-GB" }, new Date("2026-03-04T12:00:00Z"))!;
  assert.match(close.choices.find((c) => c.value === "iso")!.label, /2026-03-04/);
  assert.equal(formatFamily("boolean"), null);
  assert.equal(formatState(f(deals, "renewal"), deals, {}), null);
});

test("required is set and cleared; the constraints go when empty", () => {
  const title: Field = { name: "t", type: "string" };
  assert.deepEqual(requiredPatch(title, true), { constraints: { required: true } });
  assert.deepEqual(requiredPatch({ ...title, constraints: { required: true } }, false), { constraints: undefined });
  assert.deepEqual(requiredPatch({ ...title, constraints: { required: true, maxLength: 3 } }, false), { constraints: { maxLength: 3 } });
});

test("a new choice is trimmed, and refused when empty or already there", () => {
  const stage = f(deals, "stage");
  assert.equal(takesChoices(stage), true);
  assert.equal(takesChoices(f(deals, "title")), false);
  assert.equal(newChoice(stage, "  won "), null);
  assert.equal(newChoice(stage, "   "), null);
  assert.equal(newChoice(stage, " Paused "), "Paused");
});

test("a changed formula saves, with a new type when its family changes; the same one doesn't", () => {
  const quarter = f(budget, "quarter");
  assert.equal(fieldFormula(quarter, budget, "(+ jan feb mar)").save, undefined);
  assert.deepEqual(fieldFormula(quarter, budget, "=jan*2").save, { computed: { expr: "(* jan 2)", dialect: "table-expr-v1" } });
  assert.equal(fieldFormula(quarter, budget, '(concat item "!")').save?.type, "string");
  assert.equal(fieldFormula(quarter, budget, "(+ jan").compiled.ok, false);
});

test("a new field's key comes from its name, never clashing; a formula field needs a formula that compiles", () => {
  const existing = new Set(budget.map((x) => x.name));
  assert.deepEqual(newField({ name: "Notes", type: "string", existing, fields: budget }).field, { name: "notes", title: "Notes", type: "string" });
  assert.equal(newField({ name: "jan", type: "number", existing, fields: budget }).key, "jan_2");
  // A name that's already a plain key needs no separate title.
  assert.deepEqual(newField({ name: "notes", type: "string", existing, fields: budget }).field, { name: "notes", type: "string" });
  assert.equal(newField({ name: "  ", type: "string", existing, fields: budget }).field, null);
  assert.equal(newField({ name: "Half", type: "formula", formula: "(/ jan", existing, fields: budget }).field, null);
  const half = newField({ name: "Half", type: "formula", formula: "=jan/2", existing, fields: budget }).field!;
  assert.deepEqual(half.computed, { expr: "(/ jan 2)", dialect: "table-expr-v1" });
  assert.equal(half.type, "number");
  assert.equal(addableChoices().at(-1)!.value, "formula");
});
