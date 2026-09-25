// Currency is a unit (D33): formulas show their inputs' currency, and
// nothing converts.

import test from "node:test";
import assert from "node:assert/strict";

import { currencyOf, effectiveFormat, inputCurrency } from "./currency.js";
import type { Field, TableSchema } from "./types.js";

const f = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: "number", ...extra });
const calc = (name: string, expr: string, extra: Partial<Field> = {}): Field =>
  f(name, { computed: { expr, dialect: "table-expr-v1" }, ...extra });
const schema = (...fields: Field[]): TableSchema => ({ fields });

test("a field's own currency", () => {
  assert.equal(currencyOf(f("b", { format: "currency:usd" })), "USD");
  assert.equal(currencyOf(f("b", { format: "decimal:2" })), undefined);
});

test("a formula over dollars is shown in dollars", () => {
  const s = schema(f("budget", { format: "currency:USD" }), calc("per_month", "(round (/ budget 12) 0)"));
  assert.equal(effectiveFormat(s.fields[1]!, s), "currency:USD");
});

test("its own format always wins, even a different currency", () => {
  const s = schema(f("budget", { format: "currency:USD" }), calc("pm", "(/ budget 12)", { format: "currency:EUR" }));
  assert.equal(effectiveFormat(s.fields[1]!, s), "currency:EUR");
  assert.equal(inputCurrency(s.fields[1]!, s), "USD");
});

test("mixed currencies have no single unit, so the result is a plain number", () => {
  const s = schema(
    f("usd", { format: "currency:USD" }),
    f("eur", { format: "currency:EUR" }),
    calc("total", "(+ usd eur)"),
  );
  assert.equal(inputCurrency(s.fields[2]!, s), "mixed");
  assert.equal(effectiveFormat(s.fields[2]!, s), undefined);
});

test("inheritance follows a chain of formulas, and a loop doesn't hang", () => {
  const s = schema(
    f("budget", { format: "currency:GBP" }),
    calc("per_month", "(/ budget 12)"),
    calc("per_week", "(/ per_month 4)"),
    calc("a", "(+ b 1)"),
    calc("b", "(+ a 1)"),
  );
  assert.equal(effectiveFormat(s.fields[2]!, s), "currency:GBP");
  assert.equal(effectiveFormat(s.fields[3]!, s), undefined);
});

test("a stored field without a format stays as it is", () => {
  const s = schema(f("count"));
  assert.equal(effectiveFormat(s.fields[0]!, s), undefined);
});
