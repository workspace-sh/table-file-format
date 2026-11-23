// tableProblems against the schema-errors example (workspace-fixtures): each
// of its rows says in its Problem column what is wrong with it, and each is
// found, with its code, place and fixes. The other examples have none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { parseBundle } from "./parser.js";
import { problemsOf, tableProblems, type Problem, type ProblemCode } from "./problems.js";
import { UnreadableSchemaError } from "./parse-text.js";
import { fixtureBundles, fixturesDir } from "./test-fixtures.js";
import type { FieldType } from "./types.js";

const schemaErrors = () => parseBundle(resolve(fixturesDir, "schema-errors.table"));

/** The row whose Problem column starts with `label`. */
async function rowLabelled(label: string): Promise<string> {
  const row = (await schemaErrors()).tables["problems"]!.rows.find((r) => String(r["problem"]).startsWith(label));
  assert.ok(row, `no row labelled ${label}`);
  return row.id;
}

const at = (p: Problem) => (p.at.kind === "cell" || p.at.kind === "row" ? p.at.row : undefined);

test("every labelled row of schema-errors has its problem, and the row with none has none", async () => {
  const problems = tableProblems(await schemaErrors(), { problems: ["receipt.txt", "unused.txt"] });
  const cases: [string, ProblemCode][] = [
    ["Wrong type: text in a whole-number", "value.type"],
    ["Wrong type: not a year and month", "value.type"],
    ["Wrong type: not a date", "value.type"],
    ["Required:", "value.required"],
    ["Not a choice: status", "value.choice"],
    ["Not a choice: a tag", "value.choice"],
    ["Below the minimum", "value.minimum"],
    ["Above the maximum", "value.maximum"],
    ["Not above the exclusive minimum", "value.exclusive-minimum"],
    ["Not below the exclusive maximum", "value.exclusive-maximum"],
    ["Before the minimum date", "value.minimum"],
    ["Too short", "value.min-length"],
    ["Too long", "value.max-length"],
    ["Doesn't match the pattern", "value.pattern"],
    ["Not unique: email (second)", "value.unique"],
    ["Primary key: sku and region (second)", "key.primary"],
    ["Unique key: person and week (second)", "key.unique"],
    ["A formula for a field the table hasn't", "cell.no-field"],
    ["Dangling link", "relation.dangling"],
    ["A cell's formula twice", "cell.repeated"],
    ["A value typed over a cell's formula", "cell.typed-over"],
  ];
  for (const [label, code] of cases) {
    const id = await rowLabelled(label);
    assert.ok(problems.some((p) => p.code === code && at(p) === id), `${label}: ${code}`);
  }
  const clean = await rowLabelled("No problem");
  assert.deepEqual(problems.filter((p) => at(p) === clean), []);
});

test("schema-errors has every problem that has no row of its own: lines, files, fields and warnings", async () => {
  const problems = tableProblems(await schemaErrors(), { problems: ["receipt.txt", "unused.txt"] });
  const codes = new Set(problems.map((p) => p.code));
  for (const code of [
    "id.missing", "body.orphaned", "cell.no-row", "field.id-repeated", "line.not-json", "line.not-row", "line.conflict-marker",
    "line.id-repeated", "line.repeat-left-out", "cell.line-unreadable", "file.malformed", "bundle.not-a-table", "choice.unused", "attachment.orphaned",
  ] as ProblemCode[]) {
    assert.ok(codes.has(code), code);
  }
  const marker = problems.filter((p) => p.code === "line.conflict-marker");
  assert.deepEqual(marker.map((p) => (p.at.kind === "line" ? p.at.text : "")), ["<<<<<<< ours", "=======", ">>>>>>> theirs"]);
  assert.equal(problems.find((p) => p.code === "attachment.orphaned")!.details["file"], "unused.txt");
  assert.ok(problems.some((p) => p.code === "choice.unused" && p.details["value"] === "archived"));
});

test("each problem has a severity by what it is: invalid, pointing nowhere, or only said", async () => {
  const problems = tableProblems(await schemaErrors());
  const of = (code: ProblemCode) => problems.find((p) => p.code === code)!.severity;
  assert.equal(of("value.type"), "error");
  assert.equal(of("line.conflict-marker"), "error");
  assert.equal(of("relation.dangling"), "warning");
  assert.equal(of("line.repeat-left-out"), "notice");
  assert.equal(of("cell.typed-over"), "notice");
});

test("a value's fixes correct it first, then widen the rule, which says it changes the schema", async () => {
  const problems = tableProblems(await schemaErrors());
  const below = problems.find((p) => p.code === "value.minimum" && p.details["limit"] === 0)!;
  assert.deepEqual(below.fixes.map((f) => [f.kind, f.label, f.changesSchema]), [
    ["set-value", "Make it 0", false],
    ["change-field", "Lower the minimum to -5", true],
  ]);
  const tag = problems.find((p) => p.code === "value.choice" && p.details["value"] === '"blue"')!;
  assert.deepEqual(tag.fixes.map((f) => f.label), ["Remove “blue”", "Add “blue” as a choice"]);
  const repeated = problems.find((p) => p.code === "line.id-repeated")!;
  assert.deepEqual(repeated.fixes.map((f) => f.kind), ["choose-line", "keep-as-new-row", "remove-line"]);
});

test("the other examples have no errors and no warnings", async () => {
  for (const [name, bundle] of Object.entries(await fixtureBundles())) {
    const found = tableProblems(bundle).filter((p) => p.severity !== "notice" && p.code !== "choice.unused");
    assert.deepEqual(found.map((p) => `${p.table}: ${p.message}`), [], name);
  }
});

test("a table read through its index says its rows aren't checked, and nothing about them", async () => {
  const table = { ...(await schemaErrors()).tables["problems"]!, rows: [], indexed: { count: 40, version: 1 } };
  const problems = problemsOf(table, "problems");
  assert.ok(problems.some((p) => p.code === "rows.not-checked" && p.severity === "notice"));
  assert.ok(!problems.some((p) => p.code.startsWith("value.") || p.code === "cell.no-row" || p.code === "body.orphaned"));
});

test("a schema.json that isn't JSON is fatal, and says so by its code", async () => {
  await assert.rejects(parseBundle(resolve(fixturesDir, "broken", "schema-unreadable.table")), (err: unknown) => {
    assert.ok(err instanceof UnreadableSchemaError);
    assert.equal(err.code, "schema.unreadable");
    assert.match(err.path, /schema\.json$/);
    return true;
  });
});

test("formula-errors has a column of every field type", async () => {
  const all: FieldType[] = ["string", "number", "integer", "boolean", "date", "datetime", "time", "year", "yearmonth", "array", "object", "duration", "geopoint", "geojson", "any"];
  const types = new Set((await fixtureBundles())["formula-errors"]!.tables["errors"]!.schema.fields.map((f) => f.type));
  assert.deepEqual(all.filter((t) => !types.has(t)), []);
});
