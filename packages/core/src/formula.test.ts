// The Excel-style authoring surface (DECISIONS D29): what people type,
// what is stored, and what is refused.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseExpr } from "./expr.js";
import { compileFormula, formatExpr, formulaFields, formulaType, printFormula } from "./formula.js";

const stored = (text: string, fields?: string[]) => {
  const r = compileFormula(text, fields ? { fields } : {});
  assert.ok(r.ok, `expected ${text} to compile, got: ${r.ok ? "" : r.message}`);
  return r.stored;
};
const refused = (text: string, fields?: string[]) => {
  const r = compileFormula(text, fields ? { fields } : {});
  assert.ok(!r.ok, `expected ${text} to be refused, but it compiled to ${r.ok ? r.stored : ""}`);
  return r.message;
};

// ---- every SPEC worked example survives the round trip a person makes

const here = dirname(fileURLToPath(import.meta.url));
const spec = readFileSync(resolve(here, "..", "..", "..", "docs", "SPEC.md"), "utf8");
const block = /<!-- worked-examples:start -->([\s\S]*?)<!-- worked-examples:end -->/.exec(spec)?.[1] ?? "";
const examples = block
  .split("\n")
  .filter((line) => line.startsWith("| `"))
  .map((line) => line.split(" | ")[1]!.replace(/^`|`$/g, ""));

test("SPEC has worked examples to round-trip", () => {
  assert.equal(examples.length, 20);
});

for (const expr of examples) {
  test(`SPEC example ${expr}: shown, typed back, stored unchanged`, () => {
    const parsed = parseExpr(expr);
    assert.ok(parsed.ok);
    const canonical = formatExpr(parsed.expr);
    const shown = printFormula(expr);
    assert.ok(shown.startsWith("="), shown);
    assert.equal(stored(shown), canonical, `${expr} was shown as ${shown}`);
  });
}

for (const expr of examples) {
  test(`SPEC example ${expr}: shown in the stored syntax, typed back, stored unchanged`, () => {
    const parsed = parseExpr(expr);
    assert.ok(parsed.ok);
    const canonical = formatExpr(parsed.expr);
    const shown = printFormula(expr, { syntax: "stored" });
    assert.equal(shown, canonical);
    assert.equal(stored(shown), canonical);
  });
}

test("the stored syntax shows other rows by id, never a coordinate (#76)", () => {
  const grid = { columns: ["item", "q1"], rows: ["a", "b"], here: "a" };
  const other = '(/ q1 (field "q1" "b"))';
  assert.equal(printFormula(other, { grid }), "=B1 / B2");
  assert.equal(printFormula(other, { grid, syntax: "stored" }), other);
  assert.equal(printFormula("(+ 1", { syntax: "stored" }), "(+ 1", "unparseable text comes back as-is");
});

// ---- what people type (PRIOR-ART "Authoring syntaxes")

test("PRIOR-ART's two formulas, as typed and as stored", () => {
  assert.equal(stored("=ROUND(budget / 12, 0)"), "(round (/ budget 12) 0)");
  assert.equal(stored('=IF(status = "done", budget, 0)'), '(if (= status "done") budget 0)');
});

test("the leading = is optional", () => {
  assert.equal(stored("ROUND(budget / 12, 0)"), "(round (/ budget 12) 0)");
});

test("every field-reference spelling means the same field", () => {
  for (const text of ["=budget * 2", "=[@budget] * 2", "=[budget] * 2", "={budget} * 2", '=prop("budget") * 2', "=$budget * 2"]) {
    assert.equal(stored(text), "(* budget 2)", text);
  }
});

test("a name that isn't a bare word is stored as (field …)", () => {
  assert.equal(stored("={unit price} * quantity"), '(* (field "unit price") quantity)');
  assert.equal(stored("=[@unit price] * quantity"), '(* (field "unit price") quantity)');
  assert.equal(printFormula('(* (field "unit price") quantity)'), "={unit price} * quantity");
});

test("== and != are = and <>", () => {
  assert.equal(stored('=IF(status == "done", 1, 0)'), '(if (= status "done") 1 0)');
  assert.equal(stored('=IF(status != "done", 1, 0)'), '(if (<> status "done") 1 0)');
});

test("function names are case-insensitive and stored lowercase; field names are not", () => {
  assert.equal(stored("=Round(Price, 2)"), "(round Price 2)");
  assert.equal(stored("=round(price, 2)"), "(round price 2)");
});

test("& joins text, as in a spreadsheet", () => {
  assert.equal(stored('=status & ": " & price'), '(concat status ": " price)');
});

test("precedence: * and / bind tighter than + and -, which bind tighter than comparisons", () => {
  assert.equal(stored("=a + b * c"), "(+ a (* b c))");
  assert.equal(stored("=(a + b) * c"), "(* (+ a b) c)");
  assert.equal(stored("=a - b - c"), "(- (- a b) c)");
  assert.equal(stored("=a / b / c"), "(/ (/ a b) c)");
  assert.equal(stored("=a + b > c"), "(> (+ a b) c)");
  assert.equal(stored("=a + b + c"), "(+ a b c)");
});

test("a minus on a number is that negative number; on anything else it negates", () => {
  assert.equal(stored("=ROUND(-2.5)"), "(round -2.5)");
  assert.equal(stored("=-price"), "(- price)");
  assert.equal(stored("=2 - -3"), "(- 2 -3)");
});

test("strings follow the spreadsheet rule: \"\" is a quote", () => {
  assert.equal(stored('=CONCAT("say ""hi""", name)'), '(concat "say \\"hi\\"" name)');
  assert.equal(printFormula('(concat "say \\"hi\\"" name)'), '=concat("say ""hi""", name)');
});

test("TRUE and FALSE are booleans, in any case", () => {
  assert.equal(stored("=IF(TRUE, 1, 0)"), "(if true 1 0)");
  assert.equal(stored("=IF(false, 1, 0)"), "(if false 1 0)");
});

// ---- showing a stored formula

test("printing adds only the brackets the meaning needs", () => {
  assert.equal(printFormula("(- a (- b c))"), "=a - (b - c)");
  assert.equal(printFormula("(- (- a b) c)"), "=a - b - c");
  assert.equal(printFormula("(* (+ a b) c)"), "=(a + b) * c");
  assert.equal(printFormula("(/ a (* b c))"), "=a / (b * c)");
  assert.equal(printFormula("(+ a b c)"), "=a + b + c");
  assert.equal(printFormula("(round (/ budget 12) 0)"), "=round(budget / 12, 0)");
});

test("a stored formula that doesn't parse is shown as it is", () => {
  assert.equal(printFormula("(round budget"), "(round budget");
});

// ---- what is refused (D29 addendum): nothing is stored

test("a function outside the standard library is refused, and says what is available", () => {
  const msg = refused("=VLOOKUP(budget, 1)");
  assert.match(msg, /VLOOKUP isn't a function/);
  assert.match(msg, /\bround\b/);
});

test("a cell address is refused: a formula works on every row", () => {
  assert.match(refused("=B7 * 2"), /cell address/);
});

test("a field that happens to be named like a cell address can be used by name", () => {
  assert.equal(stored("=q1 + q2", ["q1", "q2"]), "(+ q1 q2)");
});

test("broken formulas are refused with a reason", () => {
  assert.match(refused("=ROUND(budget / 12, 0"), /missing its closing \)/);
  assert.match(refused("=budget / 12)"), /no \( to match/);
  assert.match(refused('=CONCAT("open'), /closing quote/);
  assert.match(refused("=budget *"), /ends too soon/);
  assert.match(refused("=budget # 2"), /isn't something a formula can use/);
  assert.match(refused("="), /Type a formula/);
  assert.match(refused("=a = b = c"), /can't be chained/);
});

test("prop() and field() take one quoted name", () => {
  assert.match(refused("=prop(budget)"), /one field name in quotes/);
});

// ---- warnings, not refusals

test("a field that doesn't exist compiles, with a warning that it will show #NAME?", () => {
  const r = compileFormula("=Price * 2", { fields: ["price"] });
  assert.ok(r.ok);
  assert.equal(r.stored, "(* Price 2)");
  assert.deepEqual(r.warnings.length, 1);
  assert.match(r.warnings[0]!, /no field called “Price”/);
});

test("known fields produce no warnings", () => {
  const r = compileFormula("=ROUND(budget / 12, 0)", { fields: ["budget"] });
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, []);
});

// ---- a new formula field's type

test("a formula's result type", () => {
  const t = (text: string, types: Record<string, "string" | "number" | "boolean"> = {}) => {
    const r = compileFormula(text);
    assert.ok(r.ok);
    return formulaType(r.expr, new Map(Object.entries(types)));
  };
  assert.equal(t("=ROUND(budget / 12, 0)"), "number");
  assert.equal(t('=CONCAT(status, "!")'), "string");
  assert.equal(t("=UPPER(status)"), "string");
  assert.equal(t("=budget > 10"), "boolean");
  assert.equal(t('=IF(status = "done", "yes", "no")'), "string");
  assert.equal(t("=owner", { owner: "string" }), "string");
});

test("lowercase and UPPERCASE are the same formula, and it is shown lowercase", () => {
  assert.equal(stored("=round(budget / 12, 0)"), stored("=ROUND(budget / 12, 0)"));
  assert.equal(printFormula("(round (/ budget 12) 0)"), "=round(budget / 12, 0)");
  assert.equal(printFormula("(if true 1 0)"), "=if(true, 1, 0)");
});

test("the fields a formula reads, in order, without repeats", () => {
  const f = (text: string) => {
    const r = compileFormula(text);
    assert.ok(r.ok);
    return formulaFields(r.expr);
  };
  assert.deepEqual(f("=round(budget / 12, 0)"), ["budget"]);
  assert.deepEqual(f('=if(status = "done", budget, budget / 2)'), ["status", "budget"]);
  assert.deepEqual(f("={unit price} * quantity"), ["unit price", "quantity"]);
  assert.deepEqual(f("=1 + 2"), []);
});

// ---- the stored form, typed directly (#76)

test("the stored form can be typed directly, and is stored canonically", () => {
  const r = compileFormula("(round   (/ budget 12)\n 0)", { fields: ["budget"] });
  assert.ok(r.ok);
  assert.equal(r.stored, "(round (/ budget 12) 0)");
  assert.deepEqual(r.warnings, []);
  // With the = people type out of habit, too.
  const withEq = compileFormula("=(round (/ budget 12) 0)");
  assert.ok(withEq.ok);
  assert.equal(withEq.stored, "(round (/ budget 12) 0)");
});

test("typed in the stored form or Excel style, the same formula is stored the same way", () => {
  const stored = compileFormula("(concat (upper owner) \"!\")");
  const excel = compileFormula('=UPPER(owner) & "!"');
  assert.ok(stored.ok && excel.ok);
  assert.equal(stored.stored, excel.stored);
});

test("function names are lowercased as D32 writes them; field names are left alone", () => {
  const r = compileFormula('(ROUND (field "Unit Price") 2)', { fields: ["Unit Price"] });
  assert.ok(r.ok);
  assert.equal(r.stored, '(round (field "Unit Price") 2)');
});

test("a function outside D32's library is refused, with the ones there are", () => {
  const r = compileFormula("(vlookup budget 2)");
  assert.ok(!r.ok);
  assert.match(r.message, /^vlookup isn't a function \.table formulas have\. They can use: .*round/);
});

test("a missing field is a warning, as in Excel style", () => {
  const r = compileFormula("(* budgte 2)", { fields: ["budget"] });
  assert.ok(r.ok);
  assert.deepEqual(r.warnings, ["There is no field called “budgte”, so the result will show #NAME?."]);
});

test("Excel style that happens to open with ( is still Excel style", () => {
  const r = compileFormula("(budget + 1) * 2", { fields: ["budget"] });
  assert.ok(r.ok);
  assert.equal(r.stored, "(* (+ budget 1) 2)");
  const one = compileFormula("(budget)", { fields: ["budget"] });
  assert.ok(one.ok);
  assert.equal(one.stored, "budget");
});

test("unbalanced stored form is refused with where it went wrong", () => {
  const r = compileFormula("(round budget 2");
  assert.ok(!r.ok);
  assert.ok(r.at >= 0);
});
