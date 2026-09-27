import { test } from "node:test";
import assert from "node:assert/strict";

import { printNode, readCases, printCase } from "./edn.js";
import { readOpenFormula, Unsupported } from "./openformula.js";
import { meets, roundTo } from "./compare.js";
import { toExcel } from "./engines.js";

const edn = (f: string) => printNode(readOpenFormula(f));

test("OpenFormula text reads into the stored form", () => {
  assert.equal(edn("of:=ROUND(2.348;2)"), "(round 2.348 2)");
  assert.equal(edn("of:=ROUND(2.5;)"), "(round 2.5 nil)", "an omitted argument is nil");
  assert.equal(edn('of:=IF(TRUE();"a""b";FALSE())'), '(if true "a\\"b" false)', "TRUE() is the constant; \"\" escapes a quote");
  assert.equal(edn("of:=SUM({1;2|3;4})"), "(sum [[1 2] [3 4]])", "inline arrays are rows");
  assert.equal(edn('of:="a"&"b"'), '(& "a" "b")');
  assert.equal(edn("of:=5%"), "(% 5)");
  assert.equal(edn("of:=.5e-3"), "0.0005");
});

test("precedence follows OpenFormula's Table 1", () => {
  assert.equal(edn("of:=-2^2"), "(power (- 2) 2)", "prefix minus binds tighter than ^");
  assert.equal(edn("of:=2^3^2"), "(power (power 2 3) 2)", "^ is left-associative");
  assert.equal(edn("of:=1+2*3"), "(+ 1 (* 2 3))");
  assert.equal(edn("of:=1+2&3"), "(& (+ 1 2) 3)");
  assert.equal(edn("of:=1&2=12"), "(= (& 1 2) 12)");
  assert.equal(edn("of:=1<=2"), "(<= 1 2)");
  assert.equal(edn("of:=1<>2"), "(<> 1 2)");
  assert.equal(edn("of:=-2%"), "(% (- 2))", "prefix minus binds tighter than %");
});

test("references and error literals are left for later, not guessed", () => {
  assert.throws(() => readOpenFormula("of:=SUM([.A1:.A3])"), Unsupported);
  assert.throws(() => readOpenFormula("of:=ISNA(#N/A)"), Unsupported);
});

test("a case round-trips through EDN", () => {
  const c = { expr: readOpenFormula("of:=ROUND(2.5;)"), expect: { error: null }, compare: { round: 12 }, from: "Sheet2!A2" };
  const line = printCase(c);
  assert.equal(line, '{:expr (round 2.5 nil) :expect {:error nil} :round 12 :from "Sheet2!A2"}');
  assert.deepEqual(readCases(`; a comment\n${line}\n`), [c]);
});

test("the Excel spelling for an engine that reads Excel", () => {
  assert.equal(toExcel(readOpenFormula("of:=COM.MICROSOFT.NETWORKDAYS.INTL(1;2;;{1;2|3;4})")), "NETWORKDAYS.INTL(1,2,,{1,2;3,4})");
  assert.equal(toExcel(readOpenFormula("of:=-2^2")), "POWER((-2),2)");
});

test("comparison judges as the source's check did", () => {
  assert.ok(meets(0.1 + 0.2, 0.3), "within 2^-48");
  assert.ok(!meets(0.3001, 0.3));
  assert.ok(meets(2.3456, 2.35, { round: 2 }));
  assert.ok(meets(123456.7, 123500, { sig: 4 }));
  assert.ok(meets({ error: "#NUM!" }, { error: null }), "any error");
  assert.ok(!meets({ error: "#NAME?" }, { error: null }), "an unknown function isn't the error asked for");
  assert.ok(meets(true, 1), "TRUE equals 1, as in LibreOffice");
  assert.ok(meets([[3, 4]], 3), "a single value compares with an array's top-left");
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(-2.5, 0), -3);
});
