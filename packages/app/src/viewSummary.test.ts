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

test("a search says what it found, short enough for the field", () => {
  const t = table([{ title: "a" }, { title: "b" }, { title: "c" }]);
  assert.equal(viewSummary(t, { shown: 2, inView: 3, searching: true }).found, "2 rows");
  assert.equal(viewSummary(t, { shown: 1, inView: 3, searching: true }).found, "1 row");
  assert.equal(viewSummary(t, { shown: 0, inView: 3, searching: true }).found, "No rows");
  assert.equal(viewSummary(t, { shown: 3, inView: 3, searching: false }).found, undefined);
});

test("large counts are grouped as the reader writes numbers", () => {
  const big: ParsedTable = { ...table([]), indexed: { count: 1_000_000 } as ParsedTable["indexed"] };
  const n = (x: number) => x.toLocaleString();
  assert.equal(viewSummary(big, { shown: 1_000_000, inView: 1_000_000, searching: false }).count, `${n(1_000_000)} of ${n(1_000_000)} rows`);
  assert.equal(viewSummary(big, { shown: 12_345, inView: 1_000_000, searching: true }).count, `${n(12_345)} of ${n(1_000_000)} matching`);
  assert.notEqual(n(1_000_000), "1000000");
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

test("a filter that hides rows is said beside the count, by its fields' titles (#595)", () => {
  const t: ParsedTable = {
    ...table([{ title: "a" }, { title: "b" }, { title: "c" }]),
    schema: {
      fields: [
        { name: "title", type: "string" },
        { name: "read", title: "Read", type: "boolean" },
        { name: "status", type: "string" },
        { name: "owner", type: "string" },
      ],
    },
  };
  const count = (input: Partial<Parameters<typeof viewSummary>[1]>) => viewSummary(t, { shown: 2, inView: 2, searching: false, ...input }).count;
  assert.equal(count({ filteredBy: ["read"] }), "2 of 3 rows · Filtered by Read");
  assert.equal(count({ filteredBy: ["read", "status", "read"] }), "2 of 3 rows · Filtered by Read and status");
  assert.equal(count({ filteredBy: ["read", "status", "owner"] }), "2 of 3 rows · Filtered");
  // Nothing hidden, no filter, or a search (which counts out of what the filter left): just the count.
  assert.equal(count({ shown: 3, inView: 3, filteredBy: ["read"] }), "3 of 3 rows");
  assert.equal(count({}), "2 of 3 rows");
  assert.equal(count({ shown: 1, searching: true, filteredBy: ["read"] }), "1 of 2 matching");
});

test("says the count as numbers too, for an app to compare whatever the language groups them as", () => {
  const t = table([{ title: "a" }, { title: "b" }, { title: "c" }]);
  const filtered = viewSummary(t, { shown: 2, inView: 2, searching: false });
  assert.deepEqual([filtered.shown, filtered.total], [2, 3]);
  const searching = viewSummary(t, { shown: 1, inView: 2, searching: true });
  assert.deepEqual([searching.shown, searching.total], [1, 2], "out of the search's rows");
  const big: ParsedTable = { ...table([]), indexed: { count: 1_000_000 } as ParsedTable["indexed"] };
  const all = viewSummary(big, { shown: 1_000_000, inView: 1_000_000, searching: false });
  assert.deepEqual([all.shown, all.total], [1_000_000, 1_000_000]);
});
