// The JSON Schemas for a .table's files (schema/*.schema.json) and its rows
// (rowJsonSchema), against the conformance cases in conformance/json-schema/
// and against every example table. The rows' schema says what the
// validator says about a value, except where JSON Schema can't (SPEC
// section 9, "JSON Schema").

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseBundle } from "./parser.js";
import { readTableArchive } from "./archive.js";
import { rowJsonSchema, VALUE_PATTERNS } from "./rowSchema.js";
import { valueProblems } from "./validator.js";
import { fixturesDir, PROBLEM_FIXTURES } from "./test-fixtures.js";
import type { Row, TableSchema } from "./types.js";

const root = join(import.meta.dirname, "..", "..", "..");
const cases = join(root, "conformance", "json-schema");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
// Strict, so a misspelt keyword is an error; union types (["number", "string"]) are standard JSON Schema.
const ajv = () => new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const fileSchema = (name: string) => ajv().compile(read(join(root, "schema", `${name}.schema.json`)));
const schemaOf = { schema: fileSchema("schema"), views: fileSchema("views"), meta: fileSchema("meta") };

interface Case { description: string; rule: string; valid: boolean; data: unknown }
interface RowCase { description: string; rule: string; valid: boolean; row: Record<string, unknown> }

for (const name of ["schema", "views", "meta"] as const) {
  test(`${name}.json: every conformance case is valid or not as it says`, () => {
    const file = read(join(cases, `${name}.json.cases.json`)) as { schema: string; cases: Case[] };
    assert.equal(resolve(cases, file.schema), join(root, "schema", `${name}.schema.json`));
    assert.ok(file.cases.length > 10);
    for (const c of file.cases) {
      assert.ok(c.rule, `${c.description}: names no rule`);
      assert.equal(schemaOf[name](c.data), c.valid, `${c.description} (${c.rule}): ${JSON.stringify(schemaOf[name].errors)}`);
    }
    assert.ok(file.cases.some((c) => c.valid) && file.cases.some((c) => !c.valid));
  });
}

const rowTables = (read(join(cases, "rows.cases.json")) as { tables: { description: string; schema: TableSchema; cases: RowCase[] }[] }).tables;

test("rows: every conformance case is valid or not as it says", () => {
  for (const t of rowTables) {
    assert.equal(schemaOf.schema(t.schema), true, `${t.description}: its schema.json isn't valid`);
    const validate = ajv().compile(rowJsonSchema(t.schema));
    for (const c of t.cases) {
      assert.ok(c.rule, `${c.description}: names no rule`);
      assert.equal(validate(c.row), c.valid, `${t.description}: ${c.description} (${c.rule}): ${JSON.stringify(validate.errors).slice(0, 600)}`);
    }
  }
});

/** What the validator says of one row by itself: its id and its values (SPEC section 9, rules 1 and 2). */
function validatorSays(schema: TableSchema, row: Record<string, unknown>): boolean {
  if (typeof row["id"] !== "string" || row["id"] === "") return false;
  return schema.fields.every((f) => f.computed || valueProblems(f, row[f.name]).length === 0);
}

// Where the reference validator and the spec part: SPEC section 2, "Multi-select", says a required
// multi-select rejects an empty list, and valueProblems counts only absent, null and "" as empty.
const VALIDATOR_DIFFERS = new Set(["a required multi-select that's empty"]);

test("rows: the validator agrees with every conformance case", () => {
  for (const t of rowTables) {
    for (const c of t.cases) {
      if (VALIDATOR_DIFFERS.has(c.description)) continue;
      assert.equal(validatorSays(t.schema, c.row), c.valid, `${t.description}: ${c.description}`);
    }
  }
});

test("the value patterns are the same in the rows' schema and schema.json's bounds", () => {
  const defs = read(join(root, "schema", "schema.schema.json")).$defs;
  for (const [type, pattern] of Object.entries(VALUE_PATTERNS)) assert.equal(defs[`${type}Bound`].pattern, pattern, type);
  assert.equal(read(join(root, "schema", "views.schema.json")).$defs.date.pattern, VALUE_PATTERNS.date);
});

/** Every example table as it is on disk: a folder's files, or a single file's as read. */
async function* exampleTables(): AsyncGenerator<{ where: string; schema: unknown; views: unknown; meta: unknown[]; rows: Row[] }> {
  const places = [fixturesDir, join(fixturesDir, "single-file"), join(fixturesDir, "large")];
  for (const place of places) {
    for (const name of readdirSync(place).filter((n) => n.endsWith(".table")).sort()) {
      if (PROBLEM_FIXTURES.has(name.slice(0, -".table".length)) || name === "big-1000000.table") continue;
      const path = join(place, name);
      if (statSync(path).isDirectory()) {
        const bundleMeta = existsSync(join(path, "meta.json")) ? [read(join(path, "meta.json"))] : [];
        for (const table of readdirSync(join(path, "tables"))) {
          const dir = join(path, "tables", table);
          const rows = readdirSync(join(dir, "rows")).flatMap((f) =>
            readFileSync(join(dir, "rows", f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row),
          );
          yield {
            where: `${name}/${table}`,
            schema: read(join(dir, "schema.json")),
            views: existsSync(join(dir, "views.json")) ? read(join(dir, "views.json")) : [],
            meta: [...bundleMeta, ...(existsSync(join(dir, "meta.json")) ? [read(join(dir, "meta.json"))] : [])],
            rows,
          };
        }
      } else {
        const bundle = await readTableArchive(readFileSync(path));
        for (const [table, t] of Object.entries(bundle.tables)) {
          yield { where: `${place === fixturesDir ? "" : place.slice(fixturesDir.length + 1) + "/"}${name}/${table}`, schema: t.schema, views: t.views, meta: [bundle.meta, t.meta], rows: t.rows };
        }
      }
    }
  }
}

test("every example table's schema.json, views.json, meta.json and rows are valid", async () => {
  let tables = 0;
  let rows = 0;
  for await (const t of exampleTables()) {
    assert.equal(schemaOf.schema(t.schema), true, `${t.where} schema.json: ${JSON.stringify(schemaOf.schema.errors).slice(0, 600)}`);
    assert.equal(schemaOf.views(t.views), true, `${t.where} views.json: ${JSON.stringify(schemaOf.views.errors).slice(0, 600)}`);
    for (const m of t.meta) assert.equal(schemaOf.meta(m), true, `${t.where} meta.json: ${JSON.stringify(schemaOf.meta.errors).slice(0, 600)}`);
    const validate = ajv().compile(rowJsonSchema(t.schema as TableSchema));
    for (const row of t.rows) assert.equal(validate(row), true, `${t.where} row ${row.id}: ${JSON.stringify(validate.errors).slice(0, 600)}`);
    tables++;
    rows += t.rows.length;
  }
  assert.ok(tables > 30, `only ${tables} tables`);
  assert.ok(rows > 50_000, `only ${rows} rows`);
});

test("schema-errors: the rows' schema refuses each row the validator does, but for what JSON Schema can't say", async () => {
  const table = (await parseBundle(join(fixturesDir, "schema-errors.table"))).tables["problems"]!;
  const validate = ajv().compile(rowJsonSchema(table.schema));
  // A date bound compares dates, which JSON Schema can't (SPEC section 9, "JSON Schema").
  const beyond = (row: Row) => String(row["problem"]).startsWith("Before the minimum date");
  let refused = 0;
  for (const row of table.rows) {
    const says = validatorSays(table.schema, row);
    if (beyond(row)) {
      assert.equal(says, false);
      assert.equal(validate(row), true, "a date bound is the validator's");
      continue;
    }
    assert.equal(validate(row), says, `${row["problem"]}: ${JSON.stringify(validate.errors).slice(0, 600)}`);
    if (!says) refused++;
  }
  assert.ok(refused >= 13, `only ${refused} rows refused`);
});
