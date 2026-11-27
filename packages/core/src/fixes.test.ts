// applyFix against the schema-errors example: every fix applyFix makes takes
// its problem away and brings no new one, but for choose-line, which keeps
// the row it replaces as a line, as its description says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { applyFix, applyFixes, canApplyFix } from "./fixes.js";
import { parseBundle } from "./parser.js";
import { problemsOf, type Problem } from "./problems.js";
import { fixturesDir } from "./test-fixtures.js";
import type { ParsedTable } from "./types.js";

const table = async (): Promise<ParsedTable> => (await parseBundle(resolve(fixturesDir, "schema-errors.table"))).tables["problems"]!;
const keyOf = (p: Problem) => `${p.code} ${JSON.stringify(p.at)} ${JSON.stringify(p.details)}`;

test("every fix applyFix makes takes its problem away, and brings no new one", async () => {
  const before = await table();
  const problems = problemsOf(before, "problems");
  let tried = 0;
  for (const p of problems) {
    for (const fix of p.fixes.filter(canApplyFix)) {
      const after = applyFix(before, fix);
      const now = problemsOf(after, "problems").map(keyOf);
      const was = new Set(problems.map(keyOf));
      assert.ok(!now.includes(keyOf(p)), `${fix.kind} (${fix.label}) left ${keyOf(p)}`);
      const added = now.filter((k) => !was.has(k));
      if (fix.kind === "choose-line") assert.deepEqual(added.map((k) => k.split(" ")[0]), ["line.id-repeated"], fix.label);
      // A line kept as a row of its own may share a key with the row it repeated: the table says so, rightly.
      else if (fix.kind === "keep-as-new-row") assert.ok(added.every((k) => /^(key\.|value\.unique)/.test(k)), `${fix.label} added ${added.join("; ")}`);
      else if (fix.kind !== "change-field" && fix.kind !== "change-schema" && fix.kind !== "clear-value" && fix.kind !== "set-value") assert.deepEqual(added, [], `${fix.kind} (${fix.label}) added ${added.join("; ")}`);
      tried++;
    }
  }
  assert.ok(tried >= 30, `only ${tried} fixes tried`);
});

test("a value fix changes only that cell, and a rule fix only that field", async () => {
  const before = await table();
  const below = problemsOf(before, "problems").find((p) => p.code === "value.minimum" && p.details["field"] === "amount")!;
  const [makeIt, lower] = below.fixes;
  const set = applyFix(before, makeIt!);
  const row = (t: ParsedTable) => t.rows.find((r) => r.id === (below.at as { row: string }).row)!;
  assert.equal(row(set)["amount"], 0);
  assert.equal(set.schema, before.schema);
  const widened = applyFix(before, lower!);
  assert.equal(widened.schema.fields.find((f) => f.name === "amount")!.constraints?.minimum, -5);
  assert.equal(row(widened)["amount"], -5);
  assert.equal(before.rows.find((r) => r.id === row(set).id)!["amount"], -5, "the table it was given is unchanged");
});

test("a merge conflict resolved as one choice: keep the other side, remove the markers", async () => {
  const before = await table();
  const problems = problemsOf(before, "problems");
  const theirs = problems.find((p) => p.code === "line.id-repeated")!;
  const markers = problems.filter((p) => p.code === "line.conflict-marker");
  assert.equal(markers.length, 3);
  const id = (theirs.details["row"] as string) ?? "";
  const choose = theirs.fixes.find((f) => f.kind === "choose-line")!;
  const chosen = applyFixes(before, [choose, ...markers.map((m) => m.fixes.find((f) => f.kind === "remove-line")!)]);
  assert.match(String(chosen.rows.find((r) => r.id === id)!["problem"]), /their side/);
  const left = problemsOf(chosen, "problems");
  assert.equal(left.filter((p) => p.code === "line.conflict-marker").length, 0);
  // The side not chosen is kept as a line, to remove.
  const ours = left.filter((p) => p.code === "line.id-repeated");
  assert.equal(ours.length, 1);
  assert.match(ours[0]!.at.kind === "line" ? ours[0]!.at.text : "", /our side/);
  const done = applyFix(chosen, ours[0]!.fixes.find((f) => f.kind === "remove-line")!);
  assert.equal(problemsOf(done, "problems").filter((p) => p.code === "line.id-repeated").length, 0);
});

test("keeping a line as a new row puts it after the row it followed, with an id of its own", async () => {
  const before = await table();
  const noId = problemsOf(before, "problems").find((p) => p.code === "id.missing" && p.at.kind === "line")!;
  const after = applyFix(before, noId.fixes.find((f) => f.kind === "keep-as-new-row")!);
  assert.equal(after.rows.length, before.rows.length + 1);
  const added = after.rows.find((r) => r["problem"] === "A row without an id")!;
  assert.equal(typeof added.id, "string");
  assert.ok(added.id.length > 0);
});

test("the fixes that need a person's pick or a file outside the table aren't applied here", () => {
  assert.equal(canApplyFix({ kind: "attach-page", page: "x", label: "", changesSchema: false }), false);
  assert.equal(canApplyFix({ kind: "remove-file", path: "attachments/x", label: "", changesSchema: false }), false);
  assert.throws(() => applyFix({} as ParsedTable, { kind: "remove-page", page: "x", label: "", changesSchema: false }));
});
