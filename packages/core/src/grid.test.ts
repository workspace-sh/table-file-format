import { test } from "node:test";
import assert from "node:assert/strict";

import { sheetGrid } from "./workbook.js";
import type { ParsedTable, Row, View } from "./types.js";

// Sheet views as grids (SPEC section 4, "Sheet views"; D41).

const rows: Row[] = [
  { id: "a", name: "pear", status: "done", year: 2025, n: 3 },
  { id: "b", name: "Apple", status: "todo", year: 2024, n: 1 },
  { id: "c", name: "fig", year: 2025, n: 2 },
  { id: "d", name: "apple", status: "todo", year: 2024, n: 1 },
];

function table(view: Partial<View>): ParsedTable {
  return {
    schema: {
      fields: [
        { name: "name", type: "string" },
        { name: "status", type: "string", constraints: { enum: ["todo", "doing", "done"] } },
        { name: "year", type: "number" },
        { name: "n", type: "number" },
        { name: "double", type: "number", computed: { dialect: "table-expr-v1", expr: "(* n 2)" } },
      ],
    },
    rows,
    views: [{ id: "s", name: "Sheet", layout: "table", coordinates: true, ...view }],
    meta: {},
  };
}

const ids = (t: ParsedTable) => sheetGrid(t, "s")!.rows.map((r) => r.id);

test("with nothing saved, a grid is file order", () => {
  const g = sheetGrid(table({}), "s")!;
  assert.deepEqual(g.rows.map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual([...g.position], [["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
});

test("a saved sort numbers it, ties in file order", () => {
  assert.deepEqual(ids(table({ sort: [{ field: "n", direction: "asc" }] })), ["b", "d", "c", "a"]);
  assert.deepEqual(ids(table({ sort: [{ field: "name", direction: "asc" }] })), ["b", "d", "c", "a"]);
});

test("a computed field can sort it", () => {
  assert.deepEqual(ids(table({ sort: [{ field: "double", direction: "desc" }] })), ["a", "c", "b", "d"]);
});

test("manual order beats the sort", () => {
  const t = table({ order: ["c", "a"], sort: [{ field: "n", direction: "asc" }] });
  assert.deepEqual(ids(t), ["c", "a", "b", "d"]);
});

test("grouping numbers straight through the groups: enum order, empties last", () => {
  const g = sheetGrid(table({ group: { field: "status" } }), "s")!;
  assert.deepEqual(g.rows.map((r) => r.id), ["b", "d", "a", "c"]);
  assert.deepEqual(g.groups, [
    { key: "todo", start: 1, count: 2 },
    { key: "done", start: 3, count: 1 },
    { key: "(empty)", start: 4, count: 1 },
  ]);
});

test("groups that look like numbers keep the order they arrive in", () => {
  // A plain object would put "2024" before "2025" whatever the rows say.
  const g = sheetGrid(table({ group: { field: "year" } }), "s")!;
  assert.deepEqual(g.groups.map((x) => x.key), ["2025", "2024"]);
  assert.deepEqual(g.rows.map((r) => r.id), ["a", "c", "b", "d"]);
});

test("grouping, then the sort within each group", () => {
  const g = sheetGrid(table({ group: { field: "year" }, sort: [{ field: "name", direction: "desc" }] }), "s")!;
  assert.deepEqual(g.rows.map((r) => r.id), ["a", "c", "d", "b"]);
});

test("saved filters hide rows without renumbering them", () => {
  const g = sheetGrid(table({ filter: [{ field: "status", operator: "eq", value: "todo" }] }), "s")!;
  assert.deepEqual([...g.hidden], ["a", "c"]);
  assert.equal(g.position.get("b"), 2);
  assert.equal(g.position.get("d"), 4);
});

test("rows come with their computed fields", () => {
  assert.equal(sheetGrid(table({}), "s")!.rows[0]!.double, 6);
});

test("columns are the view's fields, or the schema's", () => {
  assert.deepEqual(sheetGrid(table({}), "s")!.columns, ["name", "status", "year", "n", "double"]);
  assert.deepEqual(sheetGrid(table({ fields: ["n", "name"] }), "s")!.columns, ["n", "name"]);
});

test("only a table layout with coordinates is a Sheet view", () => {
  assert.equal(sheetGrid(table({ coordinates: false }), "s"), null);
  assert.equal(sheetGrid(table({ layout: "board" }), "s"), null);
  assert.equal(sheetGrid(table({}), "nope"), null);
});
