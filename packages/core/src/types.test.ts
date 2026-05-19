import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultAlignFor, effectiveAlign } from "./types";
import type { Field } from "./types";

test("defaultAlignFor: numerics right-align", () => {
  assert.equal(defaultAlignFor("integer"), "right");
  assert.equal(defaultAlignFor("number"), "right");
  assert.equal(defaultAlignFor("year"), "right");
});

test("defaultAlignFor: booleans center", () => {
  assert.equal(defaultAlignFor("boolean"), "center");
});

test("defaultAlignFor: text/date/object fall through to left", () => {
  assert.equal(defaultAlignFor("string"), "left");
  assert.equal(defaultAlignFor("date"), "left");
  assert.equal(defaultAlignFor("datetime"), "left");
  assert.equal(defaultAlignFor("array"), "left");
  assert.equal(defaultAlignFor("object"), "left");
});

test("effectiveAlign: undefined field falls back to left", () => {
  assert.equal(effectiveAlign(undefined), "left");
});

test("effectiveAlign: explicit align overrides type default", () => {
  const numericLeft: Field = { name: "n", type: "integer", align: "left" };
  assert.equal(effectiveAlign(numericLeft), "left");

  const stringRight: Field = { name: "s", type: "string", align: "right" };
  assert.equal(effectiveAlign(stringRight), "right");

  const stringCenter: Field = { name: "s", type: "string", align: "center" };
  assert.equal(effectiveAlign(stringCenter), "center");
});

test("effectiveAlign: no explicit align uses type default", () => {
  const integerField: Field = { name: "n", type: "integer" };
  assert.equal(effectiveAlign(integerField), "right");

  const stringField: Field = { name: "s", type: "string" };
  assert.equal(effectiveAlign(stringField), "left");

  const boolField: Field = { name: "b", type: "boolean" };
  assert.equal(effectiveAlign(boolField), "center");
});
