// Cells' own formulas in a table's index (SPEC section 8; D52): kept with
// the rows, worked out with them, their results shown and never stored.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, indexedCells, OWN_FORMULAS, putRows, queryIndex, removeRows, setIndexedCellFormula, storedCellsText, storedRowLines } from "./indexer.js";
import { openNodeDatabase } from "./sqlite-node.js";
import type { CellFormula, Row, TableSchema } from "./types.js";

const schema: TableSchema = {
  fields: [
    { name: "item", type: "string" },
    { name: "price", type: "number" },
    { name: "qty", type: "number" },
    { name: "total", type: "number", computed: { expr: "(* price qty)", dialect: "table-expr-v1" } },
  ],
};
const rows: Row[] = [
  { id: "a", item: "Apples", price: 2, qty: 3 },
  { id: "b", item: "Bread", price: 4 },
  { id: "c", item: "Cheese", price: 10, qty: 1 },
];
const cells: CellFormula[] = [
  { id: "b", field: "qty", expr: "(+ 5 5)" },
  { id: "c", field: "total", expr: "(* price 100)" },
  { id: "a", field: "qty", expr: "99" },
  { id: "gone", field: "qty", expr: "1" },
];

async function built() {
  const raw = openNodeDatabase(":memory:");
  const db = { exec: raw.exec, run: raw.run, all: raw.all, ...(raw.batch ? { batch: raw.batch } : {}) };
  await buildIndex(db, { name: "t", schema, rows, key: "k", cells });
  return db;
}

test("built with its cells' own formulas: shown with their results, sorted by them, and the formulas carried for an editor", async () => {
  const db = await built();
  const all = (await queryIndex(db, { name: "t", schema }))!;
  const shown = await all.rows(0, 3);
  assert.equal(shown.find((r) => r.id === "b")!.qty, 10);
  assert.equal(shown.find((r) => r.id === "b")!.total, 40);
  assert.equal(shown.find((r) => r.id === "c")!.total, 1000);
  // A typed value beats a formula (a's qty).
  assert.equal(shown.find((r) => r.id === "a")!.qty, 3);
  assert.deepEqual(shown.find((r) => r.id === "b")![OWN_FORMULAS], { qty: "(+ 5 5)" });
  // Sorted by what the formulas give.
  const byQty = (await queryIndex(db, { name: "t", schema, query: { sort: [{ field: "qty", direction: "desc" }] } }))!;
  assert.deepEqual((await byQty.rows(0, 3)).map((r) => r.id), ["b", "a", "c"]);
});

test("written back: the rows hold no formula's result, and cells/ keeps every line but a typed-over one", async () => {
  const db = await built();
  const lines: string[] = [];
  for await (const batch of storedRowLines(db, { name: "t", schema })) for (const l of batch) lines.push(l.line);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), rows);
  assert.equal(
    await storedCellsText(db, { name: "t", schema }),
    ['{"id":"b","field":"qty","expr":"(+ 5 5)"}', '{"id":"c","field":"total","expr":"(* price 100)"}', '{"id":"gone","field":"qty","expr":"1"}', ""].join("\n"),
  );
});

test("a cell's formula set and taken away in place; a row removed takes its lines, and put back brings them", async () => {
  const db = await built();
  const all = async () => (await (await queryIndex(db, { name: "t", schema }))!.rows(0, 3)).find((r) => r.id === "c")!;
  assert.deepEqual(await setIndexedCellFormula(db, { name: "t", schema, rowId: "c", field: "price", expr: "(+ 1 1)", key: "e1" }), { was: undefined });
  assert.equal((await all()).price, 2);
  assert.equal((await all()).total, 200);
  // The value it stood in for is gone; taken away, the cell is empty.
  await setIndexedCellFormula(db, { name: "t", schema, rowId: "c", field: "price", expr: null, key: "e2" });
  assert.equal((await all()).price, undefined);
  const removed = await removeRows(db, { name: "t", schema, ids: ["b"], key: "e3" });
  assert.deepEqual(removed[0]!.cells, [cells[0]]);
  assert.equal((await indexedCells(db, "t")).some((c) => c.id === "b"), false);
  await putRows(db, { name: "t", schema, rows: [removed[0]!.row], at: { b: removed[0]!.at }, cells: removed[0]!.cells!, key: "e4" });
  const back = (await (await queryIndex(db, { name: "t", schema }))!.rows(0, 3)).find((r) => r.id === "b")!;
  assert.equal(back.qty, 10);
});

test("a cell's formula that reads other rows can't be indexed", async () => {
  const raw = openNodeDatabase(":memory:");
  const db = { exec: raw.exec, run: raw.run, all: raw.all };
  await assert.rejects(buildIndex(db, { name: "t", schema, rows, key: "k", cells: [{ id: "a", field: "qty", expr: '(sum (values "price"))' }] }), /read other rows can't be indexed/);
});

test("built again from its rows without cells given, it keeps the cells' formulas it held", async () => {
  const db = await built();
  await buildIndex(db, { name: "t", schema, rows, key: "k2" });
  assert.equal((await indexedCells(db, "t")).length, cells.length);
  const shown = await (await queryIndex(db, { name: "t", schema }))!.rows(0, 3);
  assert.equal(shown.find((r) => r.id === "b")!.qty, 10);
});
