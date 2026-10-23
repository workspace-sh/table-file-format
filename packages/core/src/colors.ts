/**
 * A view's colour rules (SPEC section 4, "Colour rules"; D53): which rows
 * and cells a view colours, from their values. Display-only, like a
 * choice's colour, and never the only carrier of meaning: the value is
 * always shown.
 */

import { matchesFilter } from "./arrange.js";
import type { EnumColor, Row, TableSchema, View } from "./types.js";

const COLORS: ReadonlySet<string> = new Set<EnumColor>(["gray", "brown", "red", "orange", "yellow", "lime", "green", "mint", "teal", "cyan", "blue", "indigo", "purple", "pink"]);

/** A colour as a reader shows it: one of the choice colours, or `gray` for a name it doesn't know. */
export function knownColor(color: unknown): EnumColor {
  return typeof color === "string" && COLORS.has(color) ? (color as EnumColor) : "gray";
}

/** The colours a view gives a row: the whole row's, and each cell's of its own. */
export interface RowColors {
  row?: EnumColor;
  cells: Record<string, EnumColor>;
}

/**
 * The colours `view`'s rules give `row` (with its formulas' results, as
 * shown). For the row and for each cell, the first rule that matches wins.
 * A cell shows its own colour over its row's.
 */
export function rowColors(view: Pick<View, "colors">, row: Row, schema?: TableSchema): RowColors {
  const out: RowColors = { cells: {} };
  const rules = view.colors;
  if (!Array.isArray(rules) || rules.length === 0) return out;
  const datetime = new Set(schema?.fields.filter((f) => f.type === "datetime").map((f) => f.name) ?? []);
  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.filter)) continue;
    const at = typeof rule.field === "string" ? rule.field : undefined;
    if (at === undefined ? out.row !== undefined : out.cells[at] !== undefined) continue;
    if (!rule.filter.every((f) => matchesFilter(row, f, datetime.has(f.field)))) continue;
    if (at === undefined) out.row = knownColor(rule.color);
    else out.cells[at] = knownColor(rule.color);
  }
  return out;
}

/** Whether a view has any colour rules: a renderer that has none to apply can skip asking per row. */
export function hasColorRules(view: Pick<View, "colors">): boolean {
  return Array.isArray(view.colors) && view.colors.length > 0;
}
