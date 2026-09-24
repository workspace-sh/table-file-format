// table-expr-v1: reading and evaluating computed fields (DECISIONS D29,
// SPEC section 2 "Computed fields").

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRows, FormulaError, parseExpr, serializeRows, validate, applyView } from "./index.js";
import type { Field, ParsedTable, Row, TableSchema } from "./types.js";

function schemaWith(...computed: Array<[string, string]>): TableSchema {
  return {
    fields: [
      { name: "price", type: "number" },
      { name: "quantity", type: "integer" },
      { name: "status", type: "string" },
      { name: "unit price", type: "number" },
      ...computed.map(([name, expr]): Field => ({
        name,
        type: "number",
        computed: { expr, dialect: "table-expr-v1" },
      })),
    ],
  };
}

/** Evaluate one expression against one row. */
function run(expr: string, row: Partial<Row> = {}): unknown {
  const { rows } = computeRows(schemaWith(["out", expr]), [{ id: "r1", ...row } as Row]);
  return rows[0]!.out;
}

test("arithmetic, and D29's own examples", () => {
  assert.equal(run("(* price quantity)", { price: 2.5, quantity: 4 }), 10);
  assert.equal(run("(sum price quantity)", { price: 2.5, quantity: 4 }), 6.5);
  assert.equal(run('(if (> (* price quantity) 4200) "over" "ok")', { price: 100, quantity: 50 }), "over");
  assert.equal(run("(- price)", { price: 3 }), -3);
  assert.equal(run("(- price 1)", { price: 3 }), 2);
  assert.equal(run("(/ price 4)", { price: 10 }), 2.5);
  assert.equal(run("(+ 1 2 3)"), 6);
});

test("round, min, max, abs behave like their spreadsheet namesakes", () => {
  assert.equal(run("(round 2.5)"), 3);
  assert.equal(run("(round -2.5)"), -3); // half away from zero, as in Excel
  assert.equal(run("(round 3.14159 2)"), 3.14);
  assert.equal(run("(min 3 1 2)"), 1);
  assert.equal(run("(max 3 1 2)"), 3);
  assert.equal(run("(abs -4)"), 4);
});

test("text functions", () => {
  assert.equal(run('(concat status ": " price)', { status: "active", price: 5 }), "active: 5");
  assert.equal(run("(upper status)", { status: "done" }), "DONE");
  assert.equal(run("(lower status)", { status: "DONE" }), "done");
  assert.equal(run("(len status)", { status: "done" }), 4);
});

test("comparison and logic", () => {
  assert.equal(run('(= status "done")', { status: "done" }), true);
  assert.equal(run('(<> status "done")', { status: "done" }), false);
  assert.equal(run("(and (> price 1) (< price 10))", { price: 5 }), true);
  assert.equal(run("(or false (not true))"), false);
});

test("an empty cell makes arithmetic empty; sum, min and max skip it", () => {
  assert.equal(run("(* price quantity)", { price: 2 }), undefined);
  assert.equal(run("(sum price quantity)", { price: 2 }), 2);
  assert.equal(run("(sum price quantity)"), undefined);
  assert.equal(run("(max price quantity)", { quantity: 3 }), 3);
  assert.equal(run("(isblank price)"), true);
  assert.equal(run("(isblank price)", { price: 0 }), false);
  assert.equal(run('(if (isblank status) "none" status)'), "none");
  assert.equal(run('(concat "a" status "b")'), "ab");
});

test("errors are values that show their code and pass through", () => {
  const div = run("(/ price quantity)", { price: 1, quantity: 0 });
  assert.ok(div instanceof FormulaError);
  assert.equal(String(div), "#DIV/0!");
  assert.equal(String(run('(* price "x")', { price: 1 })), "#VALUE!");
  assert.equal(String(run("(frobnicate price)", { price: 1 })), "#NAME?");
  assert.equal(String(run("(* nosuchfield 2)")), "#NAME?");
  assert.equal(String(run("(+ 1 (/ 1 0))")), "#DIV/0!");
  // The untaken branch of an if is never evaluated.
  assert.equal(run("(if true 1 (/ 1 0))"), 1);
});

test("function names are read case-insensitively; field names are not", () => {
  assert.equal(run("(SUM price 1)", { price: 1 }), 2);
  assert.equal(String(run("(* Price 2)", { price: 1 })), "#NAME?");
});

test("a field name that isn't a bare word is referenced with (field …)", () => {
  assert.equal(run('(* (field "unit price") quantity)', { "unit price": 3, quantity: 2 }), 6);
});

test("a computed field can use another; a loop between them is #REF!", () => {
  const schema = schemaWith(["total", "(* price quantity)"], ["with_tax", "(* total 1.2)"]);
  const { rows } = computeRows(schema, [{ id: "r1", price: 10, quantity: 2 }]);
  assert.equal(rows[0]!.with_tax, 24);
  const loop = schemaWith(["a", "(+ b 1)"], ["b", "(+ a 1)"]);
  assert.equal(String(computeRows(loop, [{ id: "r1" }]).rows[0]!.a), "#REF!");
});

test("an expr that doesn't parse renders empty and is reported once, not per row", () => {
  const schema = schemaWith(["bad", "(* price"]);
  const { rows, diagnostics } = computeRows(schema, [{ id: "r1", price: 1 }, { id: "r2", price: 2 }]);
  assert.equal(rows[0]!.bad, undefined);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.field, "bad");
  assert.equal(parseExpr("price * quantity").ok, false); // infix is not the stored form
});

test("computed values are never written, and never validated as stored data", () => {
  const schema: TableSchema = {
    fields: [
      { name: "price", type: "number" },
      { name: "total", type: "number", constraints: { required: true }, computed: { expr: "(* price 2)", dialect: "table-expr-v1" } },
    ],
  };
  const { rows } = computeRows(schema, [{ id: "r1", price: 3 }]);
  assert.equal(rows[0]!.total, 6);
  assert.equal(serializeRows(rows, schema), '{"id":"r1","price":3}\n\n');
  assert.deepEqual(validate(schema, [{ id: "r1", price: 3 }]), []);
});

test("views filter and sort on computed values", () => {
  const schema = schemaWith(["total", "(* price quantity)"]);
  const rows: Row[] = [
    { id: "a", price: 1, quantity: 5 },
    { id: "b", price: 10, quantity: 1 },
    { id: "c", price: 2, quantity: 1 },
  ];
  const out = applyView(
    { schema, rows, views: [], meta: {} } as unknown as ParsedTable,
    { id: "v", name: "v", layout: "table", filter: [{ field: "total", operator: "gte", value: 3 }], sort: [{ field: "total", direction: "desc" }] },
  );
  assert.deepEqual(out.map((r) => [r.id, r.total]), [["b", 10], ["a", 5]]);
});

test("a table without computed fields comes back untouched", () => {
  const schema: TableSchema = { fields: [{ name: "price", type: "number" }] };
  const rows: Row[] = [{ id: "r1", price: 1 }];
  assert.equal(computeRows(schema, rows).rows, rows);
});

test("a result too large for a number is #NUM!, as in spreadsheets", () => {
  assert.equal(String(run("(* 1e308 10)")), "#NUM!");
  assert.equal(String(run("(- (* 1e308 10))")), "#NUM!");
});
