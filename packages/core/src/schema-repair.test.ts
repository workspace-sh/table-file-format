// schemaRepair: where a schema.json stops being JSON, and the corrected text
// for the common breaks, starting from the schema-unreadable example.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { failsAt, schemaRepair } from "./schema-repair.js";
import { fixturesDir } from "./test-fixtures.js";

const field = (id: string, name: string, type: string) => `    {"id": "${id}", "name": "${name}", "type": "${type}"}`;
const schema = (...lines: string[]) => ["{", '  "fields": [', ...lines, "  ]", "}"].join("\n");

test("the schema-unreadable example: line 4 is missing its }, and adding it mends it", () => {
  const text = readFileSync(resolve(fixturesDir, "broken/schema-unreadable.table/tables/items/schema.json"), "utf8");
  const r = schemaRepair(text);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.line, 3);
  assert.equal(r.reason, "Line 4 isn’t closed: the field “count” is missing its }.");
  assert.equal(r.suggestion?.label, "Add the Missing }");
  assert.deepEqual(schemaRepair(r.suggestion!.text), { ok: true });
  assert.match(r.suggestion!.text.split("\n")[3]!, /"integer"}$/);
});

test("a valid schema is mended", () => {
  assert.deepEqual(schemaRepair(schema(`${field("a1", "title", "string")},`, field("b2", "count", "integer"))), { ok: true });
});

test("a trailing comma is removed", () => {
  const r = schemaRepair(schema(`${field("a1", "title", "string")},`, `${field("b2", "count", "integer")},`));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.equal(r.line, 3);
  assert.equal(r.suggestion?.label, "Remove the Extra Comma");
  assert.deepEqual(schemaRepair(r.suggestion!.text), { ok: true });
});

test("a missing comma between fields is added", () => {
  const r = schemaRepair(schema(field("a1", "title", "string"), field("b2", "count", "integer")));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.equal(r.line, 2);
  assert.equal(r.suggestion?.label, "Add the Missing Comma");
  assert.deepEqual(schemaRepair(r.suggestion!.text), { ok: true });
});

test("a text that ends too soon gets its closing brackets", () => {
  const r = schemaRepair(["{", '  "fields": [', field("a1", "title", "string")].join("\n"));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.equal(r.suggestion?.label, "Add the Missing }");
  assert.deepEqual(schemaRepair(r.suggestion!.text), { ok: true });
});

test("JSON that isn't a schema says so, with nothing to suggest", () => {
  const r = schemaRepair('{"name": "items"}');
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.match(r.reason, /no list of fields/);
  assert.equal(r.suggestion, undefined);
  assert.ok(!schemaRepair("[1, 2]").ok);
});

test("a break with no common correction names its line where the parser says", () => {
  const r = schemaRepair(schema('    {"id": "a1", "name": title, "type": "string"}'));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.equal(r.suggestion, undefined);
  assert.equal(r.line, 2);
  assert.equal(r.reason, "Line 3 isn’t valid JSON.");
});

test("failsAt finds where JSON stops, and agrees with the parser that good JSON is good", () => {
  for (const good of ['{"a": [1, -2.5e3, true, false, null, "x\\"y\\u00e9"]}', "[]", " {} ", '"s"']) assert.equal(failsAt(good), null, good);
  assert.equal(failsAt('{"a": tru}'), 6);
  assert.equal(failsAt('{"a": 1,}'), 8);
  assert.equal(failsAt('{"a": 1} x'), 9);
  assert.equal(failsAt('{"a": "open'), 11);
});
