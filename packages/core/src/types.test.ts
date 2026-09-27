import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultAlignFor, effectiveAlign } from "./types.js";
import type { Field } from "./types.js";

test("defaultAlignFor: numerics right-align", () => {
  assert.equal(defaultAlignFor("integer"), "end");
  assert.equal(defaultAlignFor("number"), "end");
  assert.equal(defaultAlignFor("year"), "end");
});

test("defaultAlignFor: booleans center", () => {
  assert.equal(defaultAlignFor("boolean"), "center");
});

test("defaultAlignFor: text/date/object fall through to left", () => {
  assert.equal(defaultAlignFor("string"), "start");
  assert.equal(defaultAlignFor("date"), "start");
  assert.equal(defaultAlignFor("datetime"), "start");
  assert.equal(defaultAlignFor("array"), "start");
  assert.equal(defaultAlignFor("object"), "start");
});

test("effectiveAlign: undefined field falls back to start", () => {
  assert.equal(effectiveAlign(undefined), "start");
});

test("effectiveAlign: explicit align overrides type default", () => {
  const numericLeft: Field = { name: "n", type: "integer", align: "start" };
  assert.equal(effectiveAlign(numericLeft), "start");

  const stringRight: Field = { name: "s", type: "string", align: "end" };
  assert.equal(effectiveAlign(stringRight), "end");

  const stringCenter: Field = { name: "s", type: "string", align: "center" };
  assert.equal(effectiveAlign(stringCenter), "center");
});

test("effectiveAlign: no explicit align uses type default", () => {
  const integerField: Field = { name: "n", type: "integer" };
  assert.equal(effectiveAlign(integerField), "end");

  const stringField: Field = { name: "s", type: "string" };
  assert.equal(effectiveAlign(stringField), "start");

  const boolField: Field = { name: "b", type: "boolean" };
  assert.equal(effectiveAlign(boolField), "center");
});
