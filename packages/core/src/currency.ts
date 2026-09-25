/**
 * Currency is a unit (DECISIONS D33).
 *
 * `currency:<ISO-4217>` says what the stored number is *in*, not just how
 * it looks. Changing it relabels the values; nothing ever converts them —
 * a .table holds no exchange rates and a reader never fetches one. So a
 * formula column must not quietly show a currency its inputs aren't in:
 * with no format of its own, it is shown in its inputs' currency.
 */

import { formulaFields } from "./formula.js";
import { parseExpr } from "./expr.js";
import type { Field, TableSchema } from "./types.js";

/** The ISO 4217 code a field's own format names, if it names one. */
export function currencyOf(field: Pick<Field, "format"> | undefined): string | undefined {
  const f = field?.format;
  return f?.startsWith("currency:") ? f.slice("currency:".length).toUpperCase() : undefined;
}

/**
 * The currency a computed field's inputs are in: one code when every
 * currency-formatted input agrees, `undefined` when none has one, and
 * `"mixed"` when they disagree — adding dollars to euros has no single
 * unit, and the answer is shown as a plain number.
 */
export function inputCurrency(field: Field, schema: TableSchema, seen: Set<string> = new Set()): string | undefined {
  if (!field.computed || seen.has(field.name)) return undefined;
  seen.add(field.name);
  const parsed = parseExpr(field.computed.expr);
  if (!parsed.ok) return undefined;
  const codes = new Set<string>();
  for (const name of formulaFields(parsed.expr)) {
    const input = schema.fields.find((f) => f.name === name);
    if (!input) continue;
    const code = currencyOf(input) ?? (input.computed && !input.format ? inputCurrency(input, schema, seen) : undefined);
    if (code) codes.add(code);
  }
  if (codes.size === 0) return undefined;
  return codes.size === 1 ? [...codes][0] : "mixed";
}

/**
 * The format a field is shown with. A field's own `format` always wins;
 * a computed field without one takes its inputs' currency when they
 * share one, so a formula over dollars is shown in dollars.
 */
export function effectiveFormat(field: Field, schema: TableSchema): string | undefined {
  if (field.format || !field.computed) return field.format;
  const code = inputCurrency(field, schema);
  return code && code !== "mixed" ? `currency:${code}` : undefined;
}
