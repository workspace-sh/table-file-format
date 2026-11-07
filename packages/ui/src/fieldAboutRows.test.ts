import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldAboutSections } from "./fieldAboutRows";
import { fieldHint } from "./fieldHintFacts";

const schema = {
  fields: [
    { name: "q1", title: "Q1", type: "number" as const, computed: { expr: "jan + feb + mar" }, description: "The quarter's spend." },
    { name: "item", type: "string" as const, constraints: { required: true } },
  ],
};

test("About This Field says what the column is, then the ways on from it", () => {
  const hint = fieldHint({ field: schema.fields[0], name: "q1", schema, editable: false });
  const sections = fieldAboutSections({ hint, name: "q1", onSettings: () => {}, onEditFormula: () => {} });
  assert.deepEqual(
    sections[0].rows.map((r) => (r.kind === "info" ? [r.label, r.value] : r.id)),
    [["Kind", "Formula"], ["Description", "The quarter's spend."], ["Formula", hint.formula], ["Stored as", "q1"]],
  );
  assert.equal(sections[0].title, "About This Field");
  assert.deepEqual(sections[1].rows.map((r) => (r.kind === "action" ? r.label : r.id)), ["Edit Formula…", "Field Settings…"]);
});

test("a column that isn't a formula has no Edit Formula…, and one that can't be changed no Field Settings…", () => {
  const hint = fieldHint({ field: schema.fields[1], name: "item", schema, editable: false });
  const sections = fieldAboutSections({ hint, name: "item", onEditFormula: () => {} });
  assert.deepEqual(sections[0].rows.map((r) => (r.kind === "info" ? [r.label, r.value] : r.id)), [["Kind", hint.facts[0]], ["Details", "Required"]]);
  assert.equal(sections.length, 1);
});
