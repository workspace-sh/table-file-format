// problemItems against the schema-errors example: each problem in words,
// the merge conflict as one decision, and the one-tap fixes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { applyFixes, problemsOf, startCheck, type ParsedTable } from "@workspace.sh/table-core";
import { parseBundle } from "@workspace.sh/table-core/parser";
import { fileURLToPath } from "node:url";
import { buttonLabel, problemItems } from "./problemWords.ts";

const fixturesDir = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..", "fixtures");
const table = async (): Promise<ParsedTable> => (await parseBundle(resolve(fixturesDir, "schema-errors.table"))).tables["problems"]!;

test("the schema-errors example in words: the conflict first, then values, warnings and notes last", async () => {
  const t = await table();
  const problems = problemsOf(t, "problems");
  const items = problemItems(t, problems);
  assert.equal(items.reduce((n, i) => n + i.count, 0), problems.length);
  assert.equal(items[0]!.group, "decisions");
  assert.equal(items[0]!.title, "Two versions of row 35");
  // Plain words for anyone; the file and its lines for whoever looks closer.
  // The title names the row, so the line under it says what differs instead of naming it again.
  assert.equal(items[0]!.where, "Differs in problem");
  assert.match(items[0]!.technical!.where, /^rows\/0001\.ndjson · lines /);
  assert.equal(items[0]!.technical!.lines.length, 5);
  assert.match(items[0]!.technical!.lines[0]!.text, /^<<<<<<</);
  const notJson = items.find((i) => i.title === "A line that isn’t JSON")!;
  assert.equal(notJson.where, "a line the table can’t show");
  assert.match(notJson.technical!.where, /line \d+$/);
  assert.equal(items.at(-1)!.group, "notes");
  const below = items.find((i) => i.title === "Below the minimum of 0")!;
  assert.equal(below.where, "amount · row 8 · −5");
  assert.equal(below.quick?.label, "Make It 0");
  assert.deepEqual(below.fixes.map((f) => f.label), ["Make It 0", "Lower the Minimum to −5"]);
  assert.equal(below.fixes[1]!.note, "Changes amount for every row.");
  assert.deepEqual(below.cell, { row: below.cell!.row, field: "amount" });
  // A fix that changes a rule, or removes something, isn't offered in one tap.
  for (const i of items) if (i.quick) assert.ok(!i.quick.rule && !i.quick.removes, i.title);
  assert.ok(items.filter((i) => i.quick).length >= 10);
});

test("each way of settling the conflict leaves no conflict behind", async () => {
  const t = await table();
  const conflict = problemItems(t, problemsOf(t, "problems"))[0]!.conflict!;
  assert.deepEqual(conflict.versions[0]!.differs, ["problem"]);
  for (const [fixes, kept] of [
    [conflict.keepOurs, /our side/],
    [conflict.keepTheirs, /their side/],
    [conflict.keepBoth, /our side/],
  ] as const) {
    const after = applyFixes(t, fixes);
    const left = problemsOf(after, "problems").filter((p) => p.code === "line.conflict-marker" || p.code === "line.id-repeated");
    assert.deepEqual(left, [], kept.source);
    assert.match(String(after.rows.find((r) => r.id === conflict.row)!["problem"]), kept);
  }
  const both = applyFixes(t, conflict.keepBoth);
  assert.equal(both.rows.length, t.rows.length + 1);
});

test("a fix's label as a button says it", () => {
  assert.equal(buttonLabel("Make it 0"), "Make It 0");
  assert.equal(buttonLabel("Add “paused” as a choice"), "Add “paused” as a Choice");
  assert.equal(buttonLabel("Keep it as a new row"), "Keep It as a New Row");
});

test("an indexed table's checked problems name their rows as the table in memory does, by place", async () => {
  const t = await table();
  // Its rows as the index holds them (the lines it couldn't read aren't rows, and aren't there).
  // A pattern is a JavaScript RegExp, which the engine doesn't check: left out of both.
  const fields = t.schema.fields.map(({ constraints, ...f }) => {
    const { pattern: _pattern, ...rest } = constraints ?? {};
    return { ...f, ...(constraints ? { constraints: rest } : {}) };
  });
  const memory: ParsedTable = { ...t, schema: { ...t.schema, fields }, cells: [], unread: [], diagnostics: [] };
  const check = startCheck(memory)!;
  check.beginFile("rows");
  check.piece(new TextEncoder().encode(memory.rows.map((r) => JSON.stringify(r)).join("\n")));
  check.endFile("rows");
  const checked = check.finish()!;
  assert.ok(checked.total > 0);
  const indexed: ParsedTable = { ...memory, rows: [], indexed: { count: memory.rows.length, version: 1, checked } };
  const want = problemItems(memory, problemsOf(memory, "problems"));
  const got = problemItems(indexed, problemsOf(indexed, "problems"));
  const said = (items: typeof want) => items.filter((i) => i.group !== "notes").map((i) => [i.title, i.where]);
  assert.deepEqual(said(got), said(want).slice(0, said(got).length));
  assert.ok(said(got).length > 10, `compared ${said(got).length}`);
});
