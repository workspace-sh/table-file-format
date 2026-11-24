import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { canonicalField, canonicalSchema, categoriesPatch, displayOf, displayPatch } from "./fieldForm.ts";
import { formatValue, stringFormatKind } from "./format.ts";
import { enumOptions, type Field, type TableSchema } from "./types.ts";

const fixturesDir = resolve(import.meta.dirname, "../../../fixtures");

/** A field as a file written before D68 held it: the display token in `format`, choices in `constraints.enum`. */
function legacy(field: Field): Field {
  const { display, categories, ...rest } = field;
  let out: Field = { ...rest };
  if (typeof display === "string") out = { ...out, format: display };
  else if (field.type === "string" && field.format === "uri") out = { ...out, format: "url" };
  if (Array.isArray(categories)) out = { ...out, constraints: { ...(out.constraints ?? {}), enum: categories } };
  return out;
}

function fixtureSchemas(): [string, TableSchema][] {
  const out: [string, TableSchema][] = [];
  for (const bundle of readdirSync(fixturesDir).filter((n) => n.endsWith(".table") && statSync(join(fixturesDir, n)).isDirectory())) {
    const tables = join(fixturesDir, bundle, "tables");
    // A folder under tables/ that isn't a table (schema-errors has one) has no schema to check.
    for (const t of readdirSync(tables).filter((t) => existsSync(join(tables, t, "schema.json")))) out.push([`${bundle}/${t}`, JSON.parse(readFileSync(join(tables, t, "schema.json"), "utf8"))]);
  }
  return out;
}

test("every fixture is in D68's form", () => {
  for (const [name, schema] of fixtureSchemas()) assert.equal(canonicalSchema(schema), schema, name);
});

test("every fixture field reads the same in the old form as in the new, and converts back exactly", () => {
  const samples: unknown[] = [1234.5, -1200, 0.42, 2026, "2026-11-18", "2026-11-18T09:30:00Z", "https://example.com", "a@example.com", "+442079460000"];
  let checked = 0;
  for (const [name, schema] of fixtureSchemas()) {
    for (const field of schema.fields) {
      const old = legacy(field);
      assert.deepEqual(canonicalField(old), field, `${name}.${field.name}`);
      assert.equal(displayOf(old), displayOf(field), `${name}.${field.name}`);
      assert.deepEqual(enumOptions(old), enumOptions(field), `${name}.${field.name}`);
      assert.equal(stringFormatKind(old), stringFormatKind(field), `${name}.${field.name}`);
      for (const v of samples) assert.equal(formatValue(old, v, { locale: "en-GB", now: new Date("2026-11-18T12:00:00Z") }), formatValue(field, v, { locale: "en-GB", now: new Date("2026-11-18T12:00:00Z") }), `${name}.${field.name} ${String(v)}`);
      checked++;
    }
  }
  assert.ok(checked > 50, `only ${checked} fields checked`);
});

test("the old form converts: display tokens to display, url to uri, choices to categories", () => {
  assert.deepEqual(canonicalField({ name: "a", type: "number", format: "currency:GBP" }), { name: "a", type: "number", display: "currency:GBP" });
  assert.deepEqual(canonicalField({ name: "d", type: "date", format: "long" }), { name: "d", type: "date", display: "long" });
  assert.deepEqual(canonicalField({ name: "w", type: "string", format: "url" }), { name: "w", type: "string", format: "uri" });
  assert.deepEqual(canonicalField({ name: "e", type: "string", format: "email" }), { name: "e", type: "string", format: "email" });
  assert.deepEqual(canonicalField({ name: "p", type: "string", format: "phone" }), { name: "p", type: "string", display: "phone" });
  assert.deepEqual(canonicalField({ name: "t", type: "string", format: "plain" }), { name: "t", type: "string" });
  assert.deepEqual(
    canonicalField({ name: "s", type: "string", constraints: { required: true, enum: ["a", { value: "b", color: "green" }] } }),
    { name: "s", type: "string", categories: ["a", { value: "b", color: "green" }], constraints: { required: true } },
  );
  assert.deepEqual(canonicalField({ name: "s", type: "string", constraints: { enum: ["a"] } }), { name: "s", type: "string", categories: ["a"] });
});

test("a field already in the new form is returned as it is", () => {
  const f: Field = { name: "a", type: "number", display: "percent", categories: ["x"] };
  assert.equal(canonicalField(f), f);
  const s: TableSchema = { fields: [f] };
  assert.equal(canonicalSchema(s), s);
});

test("Table Schema's own formats stay in format", () => {
  for (const format of ["default", "email", "uri", "uuid", "binary"]) {
    const f: Field = { name: "x", type: "string", format };
    assert.equal(canonicalField(f), f, format);
  }
});

test("choosing how a field is shown writes the new form, and clears only what it had", () => {
  assert.deepEqual(displayPatch({ type: "number" }, "percent"), { display: "percent" });
  assert.deepEqual(displayPatch({ type: "number", format: "percent" }, "decimal:2"), { format: undefined, display: "decimal:2" });
  assert.deepEqual(displayPatch({ type: "string" }, "url"), { format: "uri" });
  assert.deepEqual(displayPatch({ type: "string", display: "phone" }, "email"), { format: "email", display: undefined });
  assert.deepEqual(displayPatch({ type: "string", format: "uri" }, ""), { format: undefined });
  assert.deepEqual(displayPatch({ type: "number", display: "percent" }, "percent"), {});
});

test("writing choices puts them in categories and takes them out of constraints", () => {
  assert.deepEqual(categoriesPatch({ name: "s", type: "string", constraints: { enum: ["a"], required: true } }, ["a", "b"]), {
    categories: ["a", "b"],
    constraints: { required: true },
  });
  assert.deepEqual(categoriesPatch({ name: "s", type: "string", constraints: { enum: ["a"] } }, ["a"]), { categories: ["a"], constraints: undefined });
});
