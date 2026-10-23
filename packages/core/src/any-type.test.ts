// An `any` field (D56): each value its own kind, sorted kind by kind,
// compared like with like, valid whatever its kind.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyView } from "./query.js";
import { validate } from "./validator.js";
import type { ParsedTable } from "./types.js";

const table: ParsedTable = {
  schema: { fields: [{ name: "v", type: "any" }] },
  rows: [{ id: "a", v: "n/a" }, { id: "b", v: 7 }, { id: "c", v: true }, { id: "d", v: 3 }, { id: "e", v: [1, 2] }],
  views: [],
  meta: {},
};

test("valid whatever its kind", () => {
  assert.deepEqual(validate(table.schema, table.rows), []);
});

test("sorted kind by kind: numbers, then text, then true/false", () => {
  const sorted = applyView(table, { id: "s", name: "s", layout: "table", sort: [{ field: "v", direction: "asc" }] });
  assert.deepEqual(sorted.slice(0, 4).map((r) => r.id), ["d", "b", "a", "c"]);
});

test("more or less than compares like with like: text is neither", () => {
  const more = applyView(table, { id: "f", name: "f", layout: "table", filter: [{ field: "v", operator: "gt", value: 5 }] });
  assert.deepEqual(more.map((r) => r.id), ["b"]);
  // The text "10" is more than 5 to JavaScript; to an `any` field it's text, so neither.
  const withText = { ...table, rows: [...table.rows, { id: "t", v: "10" }] };
  assert.deepEqual(applyView(withText, { id: "f", name: "f", layout: "table", filter: [{ field: "v", operator: "gt", value: 5 }] }).map((r) => r.id), ["b"]);
});
