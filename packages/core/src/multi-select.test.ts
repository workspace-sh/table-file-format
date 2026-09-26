// Multi-select: an array field with a choice list (D35, #97).

import { test } from "node:test";
import assert from "node:assert/strict";

import { validate } from "./validator.js";
import { applyFilters } from "./query.js";
import type { Row, TableSchema } from "./types.js";

const schema: TableSchema = {
  fields: [
    {
      name: "tags",
      type: "array",
      constraints: { enum: [{ value: "emea", color: "blue" }, { value: "priority", color: "red" }, "startup"] },
    },
  ],
};
const rows: Row[] = [
  { id: "a", tags: ["emea", "priority"] },
  { id: "b", tags: ["startup"] },
  { id: "c", tags: [] },
  { id: "d" },
];

test("an array field's choice list checks each item", () => {
  assert.deepEqual(validate(schema, [{ id: "r1", tags: ["emea", "priority"] }]), []);
  const errors = validate(schema, [{ id: "r2", tags: ["emea", "nope", "also-nope"] }]);
  assert.deepEqual(errors.map((e) => e.message), ['value not in enum: "nope"', 'value not in enum: "also-nope"']);
  // Still an array: a bare string is the wrong type, not a choice.
  assert.equal(validate(schema, [{ id: "r3", tags: "emea" }]).length, 1);
});

test("contains and not_contains ask about an array's items", () => {
  const ids = (filter: Parameters<typeof applyFilters>[1]) => applyFilters(rows, filter).map((r) => r.id);
  assert.deepEqual(ids([{ field: "tags", operator: "contains", value: "priority" }]), ["a"]);
  assert.deepEqual(ids([{ field: "tags", operator: "not_contains", value: "priority" }]), ["b", "c"]);
});

test("is any of / is none of match when any item is in the list", () => {
  const ids = (filter: Parameters<typeof applyFilters>[1]) => applyFilters(rows, filter).map((r) => r.id);
  assert.deepEqual(ids([{ field: "tags", operator: "in", value: ["startup", "priority"] }]), ["a", "b"]);
  // No tags at all is none of them, as an empty single value is for not_in.
  assert.deepEqual(ids([{ field: "tags", operator: "not_in", value: ["startup", "priority"] }]), ["c", "d"]);
});

test("a single value still matches as before", () => {
  const plain: Row[] = [{ id: "x", s: "alpha" }, { id: "y", s: "beta" }];
  assert.deepEqual(applyFilters(plain, [{ field: "s", operator: "contains", value: "ph" }]).map((r) => r.id), ["x"]);
  assert.deepEqual(applyFilters(plain, [{ field: "s", operator: "in", value: ["beta"] }]).map((r) => r.id), ["y"]);
});
