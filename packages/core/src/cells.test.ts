// A cell's own formula (SPEC section 3, "A cell's own formula"; D52, D54):
// read and written in cells/, worked out in place of the field's value or
// formula, and checked as a computed field's is.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readTableArchive, writeTableArchive } from "./archive.js";
import { parseEditLog } from "./edit-log.js";
import { memoryFs, readTable, writeTableTo } from "./io.js";
import { validate } from "./validator.js";
import { computeRows } from "./workbook.js";
import type { CellFormula, TableSchema } from "./types.js";

const schema: TableSchema = {
  fields: [
    { name: "item", type: "string" },
    { name: "price", type: "number" },
    { name: "qty", type: "number", constraints: { required: true } },
    { name: "total", type: "number", computed: { expr: "(* price qty)", dialect: "table-expr-v1" } },
  ],
};
const rows = [
  { id: "a", item: "Apples", price: 2, qty: 3 },
  { id: "b", item: "Bread", price: 4 },
  { id: "c", item: "Cheese", price: 10, qty: 1 },
];

test("a cell's formula stands in for its stored value, and is its row's exception in a computed field", () => {
  const cells: CellFormula[] = [
    { id: "b", field: "qty", expr: "(+ 1 1)" },
    { id: "c", field: "total", expr: "(* price qty 0.5)" },
  ];
  const out = computeRows(schema, rows, { cells }).rows;
  assert.equal(out[1]!.qty, 2);
  assert.equal(out[1]!.total, 8);
  // The other rows keep the field's formula.
  assert.equal(out[0]!.total, 6);
  assert.equal(out[2]!.total, 5);
});

test("a typed value beats a stored field's formula, the first of two lines is used, and a cell never on id", () => {
  const cells: CellFormula[] = [
    { id: "a", field: "qty", expr: "100" },
    { id: "b", field: "qty", expr: "7" },
    { id: "b", field: "qty", expr: "8" },
    { id: "c", field: "id", expr: "\"x\"" },
  ];
  const out = computeRows(schema, rows, { cells }).rows;
  assert.equal(out[0]!.qty, 3);
  assert.equal(out[1]!.qty, 7);
  assert.equal(out[2]!.id, "c");
});

test("what a cell's formula gives is checked against the field's type; a loop is #REF!; it may read other rows", () => {
  const more = [...rows.slice(0, 2), { id: "c", item: "Cheese", qty: 1 }, { id: "d", item: "Dates", qty: 2 }];
  const cells: CellFormula[] = [
    { id: "b", field: "qty", expr: "\"lots\"" },
    { id: "d", field: "price", expr: "total" },
    { id: "c", field: "price", expr: "(count (values \"item\"))" },
  ];
  const out = computeRows(schema, more, { cells }).rows;
  assert.equal(String(out[1]!.qty), "#VALUE!");
  // price → total → price: a loop.
  assert.equal(String(out[3]!.price), "#REF!");
  // Read across rows: four items.
  assert.equal(out[2]!.price, 4);
});

test("written and read back: cells/ in the rows' order and the schema's, lines kept that don't apply, a typed-over one gone", async () => {
  const fs = memoryFs();
  const cells: CellFormula[] = [
    { id: "c", field: "total", expr: "1", note: "kept" },
    { id: "gone", field: "qty", expr: "5" },
    { id: "b", field: "qty", expr: "2" },
    { id: "a", field: "qty", expr: "9" },
  ];
  await writeTableTo(fs, "/t", { schema, rows, cells, unreadCells: ["<<<<<<< ours"] });
  const text = await fs.readText("/t/cells/0001.ndjson");
  assert.equal(
    text,
    [
      '{"id":"b","field":"qty","expr":"2"}',
      '{"id":"c","field":"total","expr":"1","note":"kept"}',
      '{"id":"gone","field":"qty","expr":"5"}',
      "<<<<<<< ours",
      "",
    ].join("\n"),
  );
  const back = await readTable(fs, "/t");
  assert.deepEqual(back.cells?.map((c) => c.id), ["b", "c", "gone"]);
  assert.deepEqual(back.unreadCells, ["<<<<<<< ours"]);
  assert.ok(back.diagnostics!.some((d) => /no row gone/.test(d.message)));
  assert.ok(back.diagnostics!.some((d) => /isn't a cell's formula/.test(d.message)));
  // None left: no cells/.
  await writeTableTo(fs, "/t", { schema, rows });
  assert.equal(await fs.list("/t/cells"), null);
});

test("a single file carries cells/ and reads it back", async () => {
  const cells: CellFormula[] = [{ id: "b", field: "qty", expr: "(+ 1 1)" }];
  const bytes = await writeTableArchive("shop", { meta: {}, tables: { basket: { schema, rows, views: [], meta: {}, cells } } });
  const back = await readTableArchive(bytes);
  assert.deepEqual(back.tables["basket"]!.cells, cells);
  assert.equal(back.files, undefined);
});

test("validation: a cell with a formula counts as filled; a line for a row that isn't there isn't valid", () => {
  const errors = validate(schema, rows, [{ id: "b", field: "qty", expr: "2" }]);
  assert.equal(errors.filter((e) => e.rowId === "b").length, 0);
  assert.equal(validate(schema, rows).filter((e) => e.rowId === "b").length, 1);
  assert.match(validate(schema, rows, [{ id: "zz", field: "qty", expr: "2" }]).at(-1)!.message, /row zz, which isn't there/);
});

test("history reads a formula event, and a row's cells with its deletion", () => {
  const log = parseEditLog(
    [
      '{"id":"e1","at":"2026-10-23T10:00:00Z","op":"formula","row":"b","field":"qty","to":"(+ 1 1)"}',
      '{"id":"e2","at":"2026-10-23T10:01:00Z","op":"delete","row":"b","values":{"id":"b"},"cells":{"qty":{"expr":"(+ 1 1)"}}}',
    ].join("\n"),
  );
  assert.deepEqual(log.events.map((e) => e.op), ["formula", "delete"]);
});

test("a cell's note (D57): a line may be only a note, a note stays when a value is typed over a formula, and gives no formula", async () => {
  const { parseCellsText, cellFormulas, layoutCells } = await import("./cells.js");
  const read = parseCellsText('{"id":"a","field":"qty","note":"checked"}\n{"id":"b","field":"qty","expr":"2","note":"why two"}\n{"id":"c","field":"qty"}\n', [], [], "cells/0001.ndjson");
  assert.equal(read.length, 2);
  // A note alone gives the cell no formula: a keeps its value.
  assert.equal(cellFormulas(schema, rows, read).get("a"), undefined);
  // b has a typed value? No: b has no qty, so its formula applies; a value typed over it later keeps the note.
  const typed = rows.map((r) => (r.id === "b" ? { ...r, qty: 9 } : r));
  assert.equal(layoutCells(schema, typed, read, undefined)[0]!.text, '{"id":"a","field":"qty","note":"checked"}\n{"id":"b","field":"qty","note":"why two"}\n');
});
