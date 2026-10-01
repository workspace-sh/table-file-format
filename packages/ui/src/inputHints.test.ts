import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { inputHints, inputModeOf } from "./inputHints.ts";

const f = (field: Partial<Field>): Field => ({ name: "x", type: "string", ...field }) as Field;

test("numbers: a pad without a minus only when the field can't go below zero", () => {
  assert.equal(inputHints(f({ type: "integer", constraints: { minimum: 0 } })).kind, "integer");
  assert.equal(inputHints(f({ type: "number", constraints: { minimum: 1 } })).kind, "decimal");
  assert.equal(inputHints(f({ type: "number" })).kind, "signed-decimal");
  assert.equal(inputHints(f({ type: "integer", constraints: { minimum: -5 } })).kind, "signed-decimal");
  assert.equal(inputHints(f({ type: "number", format: "currency:GBP" })).kind, "signed-decimal");
});

test("strings by format: email, url and phone get their keyboards", () => {
  assert.equal(inputHints(f({ format: "email" })).kind, "email");
  assert.equal(inputHints(f({ format: "url" })).kind, "url");
  assert.equal(inputHints(f({ format: "phone" })).kind, "phone");
  assert.equal(inputHints(f({ format: "markdown" })).kind, "text");
  assert.equal(inputHints(undefined).kind, "text");
});

test("dates and times", () => {
  assert.equal(inputHints(f({ type: "date" })).kind, "date");
  assert.equal(inputHints(f({ type: "datetime" })).kind, "datetime");
  assert.equal(inputHints(f({ type: "time" })).kind, "time");
});

test("only prose is capitalised and corrected", () => {
  assert.deepEqual(inputHints(f({})), { kind: "text", autocapitalize: "sentences", autocorrect: true, enter: "done" });
  for (const field of [f({ format: "email" }), f({ type: "number" }), f({ type: "date" })]) {
    const h = inputHints(field);
    assert.equal(h.autocapitalize, "none", h.kind);
    assert.equal(h.autocorrect, false, h.kind);
  }
});

test("the return key says next when another entry follows", () => {
  assert.equal(inputHints(f({}), { then: "next" }).enter, "next");
  assert.equal(inputHints(f({})).enter, "done");
});

test("HTML input modes", () => {
  assert.deepEqual(
    (["integer", "decimal", "signed-decimal", "email", "url", "phone", "date", "text"] as const).map(inputModeOf),
    ["numeric", "decimal", "text", "email", "url", "tel", "text", "text"],
  );
});
