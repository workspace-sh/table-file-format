import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

// The JSON Schema for meta.json (schema/meta.schema.json) against every example's
// manifests, and against what it must allow and refuse.

const root = join(import.meta.dirname, "..", "..", "..");
const schema = JSON.parse(readFileSync(join(root, "schema", "meta.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function check(meta: unknown): string | null {
  return validate(meta) ? null : JSON.stringify(validate.errors);
}

test("every example's manifest and every table's meta.json is valid", () => {
  const fixtures = join(root, "fixtures");
  let seen = 0;
  for (const bundle of readdirSync(fixtures).filter((n) => n.endsWith(".table"))) {
    const dir = join(fixtures, bundle);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // a single-file .table
    }
    if (entries.includes("meta.json")) {
      assert.equal(check(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))), null, bundle);
      seen++;
    }
    for (const table of entries.includes("tables") ? readdirSync(join(dir, "tables")) : []) {
      const path = join(dir, "tables", table, "meta.json");
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      assert.equal(check(JSON.parse(text)), null, `${bundle}/${table}`);
      seen++;
    }
  }
  assert.ok(seen > 5, `only ${seen} meta.json files found`);
});

test("a source is valid with any of its members, or none", () => {
  for (const source of [
    { uri: "https://example.org/exports/sales.csv", format: "text/csv", retrieved_at: "2026-10-27T10:00:00Z" },
    { uri: "file:///home/a/sales.csv" },
    { format: "text/csv" },
    {},
  ]) {
    assert.equal(check({ source }), null, JSON.stringify(source));
  }
});

test("a source that isn't an object, or a member that isn't a string, is not valid", () => {
  for (const source of ["https://example.org/a.csv", ["https://example.org/a.csv"], null, { uri: 1 }, { uri: "" }, { format: true }]) {
    assert.notEqual(check({ source }), null, JSON.stringify(source));
  }
});

test("keys the schema doesn't name are allowed, since they're kept", () => {
  assert.equal(check({ title: "Sales", "com.example.app": { version: 1 } }), null);
});
