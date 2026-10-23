// Colour rules and three number formats (SPEC sections 2 and 4; D53).

import test from "node:test";
import assert from "node:assert/strict";

import { rowColors } from "./colors.js";
import { currencyOf } from "./currency.js";
import { formatValue } from "./format.js";
import type { Field, View } from "./types.js";

const num = (format: string): Field => ({ name: "n", type: "number", format });
const shown = (format: string, value: number) => formatValue(num(format), value, { locale: "en-US" });

test("scientific:N shows N fraction digits and a signed two-digit exponent", () => {
  assert.equal(shown("scientific:2", 12345), "1.23E+04");
  assert.equal(shown("scientific:2", 0.000123), "1.23E-04");
  assert.equal(shown("scientific:0", -5), "-5E+00");
  assert.equal(shown("scientific:2", 0), "0.00E+00");
  // Rounding that carries to ten moves the exponent, not 10.00E+00.
  assert.equal(shown("scientific:2", 9.996), "1.00E+01");
});

test("fraction shows the whole part and the nearest fraction under 100", () => {
  assert.equal(shown("fraction", 1.25), "1 1/4");
  assert.equal(shown("fraction", 0.5), "1/2");
  assert.equal(shown("fraction", -2.75), "-2 3/4");
  assert.equal(shown("fraction", 3), "3");
  assert.equal(shown("fraction", 0.3333333), "1/3");
  assert.equal(shown("fraction", 1.9999), "2");
});

test(":parens shows a negative in brackets without its sign, and only on decimal and currency", () => {
  assert.equal(shown("currency:USD:parens", -1200), "($1,200.00)");
  assert.equal(shown("currency:USD:parens", 1200), "$1,200.00");
  assert.equal(shown("decimal:2:parens", -3.5), "(3.50)");
  assert.equal(shown("currency:USD", -1200), "-$1,200.00");
  // Still dollars (D33): :parens says only how a negative looks.
  assert.equal(currencyOf({ format: "currency:usd:parens" }), "USD");
});

test("a view's colour rules: the first that matches wins, for the row and for each cell", () => {
  const view: Pick<View, "colors"> = {
    colors: [
      { filter: [{ field: "status", operator: "eq", value: "blocked" }], color: "red" },
      { filter: [{ field: "budget", operator: "gt", value: 10000 }], color: "orange", field: "budget" },
      { filter: [{ field: "budget", operator: "gt", value: 0 }], color: "green", field: "budget" },
      { filter: [], color: "blue" },
    ],
  };
  assert.deepEqual(rowColors(view, { id: "a", status: "blocked", budget: 20000 }), { row: "red", cells: { budget: "orange" } });
  assert.deepEqual(rowColors(view, { id: "b", status: "open", budget: 5 }), { row: "blue", cells: { budget: "green" } });
  assert.deepEqual(rowColors(view, { id: "c", status: "open" }), { row: "blue", cells: {} });
  // A colour the reader doesn't know is gray; a view with none colours nothing.
  assert.deepEqual(rowColors({ colors: [{ filter: [], color: "chartreuse" }] }, { id: "d" }), { row: "gray", cells: {} });
  assert.deepEqual(rowColors({}, { id: "e" }), { cells: {} });
});
