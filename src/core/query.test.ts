import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, applySort, applyGroup, applyView } from "./query.js";
import type { ParsedTable, Row, TableSchema, View } from "./types.js";

const schema: TableSchema = {
  fields: [
    { name: "title", type: "string" },
    { name: "status", type: "string", constraints: { enum: ["todo", "doing", "done"] } },
    { name: "priority", type: "integer" },
  ],
};

const rows: Row[] = [
  { id: "r1", title: "A", status: "done", priority: 1 },
  { id: "r2", title: "B", status: "todo", priority: 3 },
  { id: "r3", title: "C", status: "doing", priority: 2 },
  { id: "r4", title: "D", status: "todo" },
];

test("applyFilters: eq operator narrows rows", () => {
  const r = applyFilters(rows, [{ field: "status", operator: "eq", value: "todo" }]);
  assert.equal(r.length, 2);
});

test("applyFilters: empty / not_empty operators distinguish missing values", () => {
  const empty = applyFilters(rows, [{ field: "priority", operator: "empty" }]);
  assert.equal(empty.length, 1);
  assert.equal(empty[0]!.id, "r4");
  const notEmpty = applyFilters(rows, [{ field: "priority", operator: "not_empty" }]);
  assert.equal(notEmpty.length, 3);
});

test("applySort honours enum declaration order, not alphabetical", () => {
  const sorted = applySort(rows, [{ field: "status", direction: "asc" }], schema);
  // enum is [todo, doing, done], so r2/r4 (todo) come before r3 (doing) before r1 (done)
  const titles = sorted.map((r) => r.title);
  assert.equal(titles[0], "B");
  assert.equal(titles[titles.length - 1], "A");
  assert.ok(titles.indexOf("C") > titles.indexOf("D"));
});

test("applySort: nulls sort last regardless of direction", () => {
  const asc = applySort(rows, [{ field: "priority", direction: "asc" }], schema);
  assert.equal(asc[asc.length - 1]!.id, "r4", "null priority must sort last on asc");
  const desc = applySort(rows, [{ field: "priority", direction: "desc" }], schema);
  assert.equal(desc[desc.length - 1]!.id, "r4", "null priority must STILL sort last on desc");
});

test("applyGroup: keys ordered by enum declaration when field has an enum", () => {
  const groups = applyGroup(rows, "status", schema);
  assert.deepEqual(Object.keys(groups), ["todo", "doing", "done"]);
});

test("applyGroup: nulls bucket into '(empty)' and that bucket is last", () => {
  const rowsWithNull: Row[] = [
    { id: "a", title: "x" },
    { id: "b", title: "y", status: "todo" },
    { id: "c", title: "z", status: null as unknown as string },
  ];
  const groups = applyGroup(rowsWithNull, "status", schema);
  assert.ok("(empty)" in groups);
  assert.equal(groups["(empty)"]!.length, 2);
  assert.equal(groups["todo"]!.length, 1);
  const keys = Object.keys(groups);
  assert.equal(keys[keys.length - 1], "(empty)");
});

test("applyGroup: returns Record (not Map) per spec", () => {
  const groups = applyGroup(rows, "status", schema);
  assert.equal(typeof groups, "object");
  assert.ok(!(groups instanceof Map));
});

test("applyView: filter then sort", () => {
  const parsed: ParsedTable = { schema, rows, views: [], meta: {}, path: "" };
  const view: View = {
    id: "v1",
    name: "Active by priority",
    layout: "table",
    filter: [{ field: "status", operator: "neq", value: "done" }],
    sort: [{ field: "priority", direction: "asc" }],
  };
  const result = applyView(parsed, view);
  assert.equal(result.length, 3);
  assert.equal(result[0]!.id, "r3"); // priority 2
  assert.equal(result[result.length - 1]!.id, "r4"); // null last
});
