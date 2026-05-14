import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  applySort,
  applyGroup,
  applyView,
  applyOrder,
  searchRows,
} from "./query";
import type { ParsedTable, Row, TableSchema, View } from "./types";

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

test("searchRows: empty/whitespace query returns all rows unchanged", () => {
  assert.equal(searchRows(rows, "").length, rows.length);
  assert.equal(searchRows(rows, "   ").length, rows.length);
});

test("searchRows: case-insensitive substring match across string fields", () => {
  const docs: Row[] = [
    { id: "r1", title: "Workspace v1", status: "active" },
    { id: "r2", title: "Sync engine", status: "on-hold" },
    { id: "r3", title: "Brand redesign", status: "done" },
  ];
  const hits = searchRows(docs, "WORK");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.id, "r1");
});

test("searchRows: matches against system id", () => {
  const docs: Row[] = [
    { id: "p42", title: "x" },
    { id: "p99", title: "y" },
  ];
  const hits = searchRows(docs, "42");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.id, "p42");
});

test("searchRows: schema restricts the searched fields to string-y types", () => {
  // Without schema, all string-typed values are searched, including 'priority'
  // serialised numbers — but priority is integer, not string, so that's fine.
  // With schema, we ONLY look at fields the schema declares as string-y.
  const docs: Row[] = [
    { id: "r1", title: "alpha", status: "done", priority: 1 },
    { id: "r2", title: "beta", status: "todo", priority: 9 },
  ];
  // "9" appears as a number in priority; should NOT match (numbers aren't searched)
  const hits = searchRows(docs, "9", { schema });
  assert.equal(hits.length, 0);
});

test("searchRows: includes long-form bodies when provided", () => {
  const docs: Row[] = [
    { id: "r1", title: "Plain title" },
    { id: "r2", title: "Other" },
  ];
  const bodies = { r1: "# Heading\n\nBody mentions a unique-token-xyz." };
  const hits = searchRows(docs, "unique-token-xyz", { bodies });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.id, "r1");
});

test("applyOrder: places mentioned rows first in the given sequence", () => {
  const docs: Row[] = [
    { id: "r1", title: "A" },
    { id: "r2", title: "B" },
    { id: "r3", title: "C" },
    { id: "r4", title: "D" },
  ];
  const out = applyOrder(docs, ["r3", "r1"]);
  assert.deepEqual(
    out.map((r) => r.id),
    ["r3", "r1", "r2", "r4"],
  );
});

test("applyOrder: returns input unchanged when order is empty/undefined", () => {
  const docs: Row[] = [
    { id: "r1", title: "A" },
    { id: "r2", title: "B" },
  ];
  assert.deepEqual(applyOrder(docs, undefined), docs);
  assert.deepEqual(applyOrder(docs, []), docs);
});

test("applyView: order overrides sort when present", () => {
  const parsed: ParsedTable = { schema, rows, views: [], meta: {}, path: "" };
  const view: View = {
    id: "v1",
    name: "Manual",
    layout: "list",
    sort: [{ field: "priority", direction: "asc" }],
    order: ["r4", "r2"],
  };
  const result = applyView(parsed, view);
  // r4, r2 first by order, then r1/r3 in their arrival order (not sort)
  assert.equal(result[0]!.id, "r4");
  assert.equal(result[1]!.id, "r2");
});

test("applyView: order falls back to sort when order is empty", () => {
  const parsed: ParsedTable = { schema, rows, views: [], meta: {}, path: "" };
  const view: View = {
    id: "v1",
    name: "Sorted",
    layout: "list",
    sort: [{ field: "priority", direction: "asc" }],
    order: [],
  };
  const result = applyView(parsed, view);
  // sort by priority asc; null last
  assert.equal(result[0]!.id, "r1"); // priority 1
  assert.equal(result[result.length - 1]!.id, "r4"); // null
});
