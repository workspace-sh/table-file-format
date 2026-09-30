import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { schemaVersionOf, schemaVersions, viewSummary } from "./viewSummary.ts";

const table = (rows: Record<string, unknown>[], version?: number): ParsedTable => ({
  path: "x",
  schema: {
    ...(version !== undefined ? { "schema-version": version } : {}),
    fields: [{ name: "title", type: "string", constraints: { required: true } }],
  },
  rows: rows.map((r, i) => ({ id: `r${i}`, ...r })),
  views: [],
  meta: {},
});

test("counts rows out of the table, or out of the view while searching", () => {
  const t = table([{ title: "a" }, { title: "b" }, { title: "c" }]);
  assert.equal(viewSummary(t, { shown: 2, inView: 3, searching: false }).count, "2 of 3 rows");
  assert.equal(viewSummary(t, { shown: 1, inView: 2, searching: true }).count, "1 of 2 matching");
  assert.equal(viewSummary(table([{ title: "a" }]), { shown: 1, inView: 1, searching: false }).count, "1 of 1 row");
});

test("a valid table says so, with the rule as its hint", () => {
  const s = viewSummary(table([{ title: "a" }]), { shown: 1, inView: 1, searching: false });
  assert.equal(s.valid, true);
  assert.equal(s.validity, "schema valid");
  assert.match(s.validityHint, /^Every row fits the schema/);
});

test("errors are counted, and the hint lists the first five", () => {
  const one = viewSummary(table([{}]), { shown: 1, inView: 1, searching: false });
  assert.equal(one.validity, "1 validation error");
  assert.equal(one.validityHint.split("\n").length, 1);
  assert.match(one.validityHint, /^title: /);
  const seven = viewSummary(table(Array.from({ length: 7 }, () => ({}))), { shown: 7, inView: 7, searching: false });
  assert.equal(seven.validity, "7 validation errors");
  assert.equal(seven.errors.length, 7);
  const lines = seven.validityHint.split("\n");
  assert.equal(lines.length, 6);
  assert.equal(lines[5], "…and 2 more");
});

test("the schema changed only when its version went up since it was opened", () => {
  const at = (version: number | undefined, openedAt?: number) =>
    viewSummary(table([], version), { shown: 0, inView: 0, searching: false, openedAt }).schemaChanged;
  assert.equal(at(undefined), false);
  assert.equal(at(2, 2), false);
  assert.equal(at(3, 2), true);
  assert.equal(at(2), true);
  assert.equal(schemaVersionOf(table([])), 1);
  assert.deepEqual(schemaVersions({ "a/b": table([], 4), "a/c": table([]) }), { "a/b": 4, "a/c": 1 });
});
