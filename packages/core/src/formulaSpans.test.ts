import test from "node:test";
import assert from "node:assert/strict";

import { formulaSpans } from "./formulaSpans.js";

const show = (src: string) => formulaSpans(src).map((s) => `${s.kind}:${src.slice(s.start, s.end)}`);

test("a column formula colours its references, functions, strings and operators", () => {
  assert.deepEqual(show('=sum(linked("lines", "product", "quantity"))'), [
    "op:=", "fn:sum", "op:(", "fn:linked", "op:(", 'str:"lines"', "op:,", 'str:"product"', "op:,", 'str:"quantity"', "op:)", "op:)",
  ]);
  assert.deepEqual(show("=Budget - Spent * 1.5"), ["op:=", "ref:Budget", "op:-", "ref:Spent", "op:*", "num:1.5"]);
});

test("cells, braces, brackets and sheets are references", () => {
  assert.deepEqual(show("=$C$6 + {Unit price} + [@Qty] + 'By date'!C6"), [
    "op:=", "ref:$C$6", "op:+", "ref:{Unit price}", "op:+", "ref:[@Qty]", "op:+", "ref:'By date'!C6",
  ]);
});

test("a half-typed formula still colours up to where it stops", () => {
  assert.deepEqual(show('=if(Status = "do'), ["op:=", "fn:if", "op:(", "ref:Status", "op:=", 'str:"do']);
  assert.deepEqual(show("=round("), ["op:=", "fn:round", "op:("]);
  assert.deepEqual(show("={Unit pri"), ["op:=", "ref:{Unit pri"]);
});

test("a doubled quote stays inside its string; true, false and nil are literals", () => {
  assert.deepEqual(show('="say ""hi""" & true'), ["op:=", 'str:"say ""hi"""', "op:&", "num:true"]);
});

test("offsets are UTF-16, as JavaScript counts", () => {
  const src = '="🙂" & Naïve';
  const spans = formulaSpans(src);
  assert.equal(src.slice(spans[1]!.start, spans[1]!.end), '"🙂"');
  assert.equal(src.slice(spans[3]!.start, spans[3]!.end), "Naïve");
});
