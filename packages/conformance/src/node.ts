// A formula as the suite holds it: OpenFormula's expression, spelled in
// table-expr's EDN (SPEC section 2). Richer than today's core `Expr`: it
// also carries inline arrays and omitted arguments, which OpenFormula
// has and the suite needs.

export type Node =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  /** An omitted argument, as in `ROUND(2.5;)`. EDN `nil`. */
  | { kind: "omitted" }
  /** An inline array, row by row. EDN `[[1 2] [3 4]]`. */
  | { kind: "array"; rows: Node[][] }
  /** A function or operator. Names are lowercase. */
  | { kind: "call"; fn: string; args: Node[] };

/**
 * The value a case expects, or an engine gave. `{ error: null }` is any
 * error: a case that only asks for one, not which.
 */
export type Value = number | string | boolean | { error: string | null } | Value[][];

/**
 * How a case compares numbers, as its source's own check did. Absent:
 * equal as LibreOffice compares, to within 2^-48 of each other.
 */
export type Compare = { round: number } | { sig: number };

/**
 * OpenFormula's host-defined properties (3.4) that change answers: text
 * comparison, and how criteria match text.
 */
export interface Host {
  caseSensitive: boolean;
  wholeCell: boolean;
  regex: boolean;
  wildcards: boolean;
}

/** `.table`'s host: as Excel and Numbers behave (DECISIONS D39). */
export const TABLE_HOST: Host = { caseSensitive: false, wholeCell: true, regex: false, wildcards: true };

export const sameHost = (a: Host, b: Host) =>
  a.caseSensitive === b.caseSensitive && a.wholeCell === b.wholeCell && a.regex === b.regex && a.wildcards === b.wildcards;

// What OpenFormula says the host settings change (3.4, 4.11.8): criteria,
// database queries, lookups, SEARCH, and comparing text.
const HOST_SENSITIVE = new Set([
  "averageif", "averageifs", "countif", "countifs", "sumif", "sumifs",
  "daverage", "dcount", "dcounta", "dget", "dmax", "dmin", "dproduct",
  "dstdev", "dstdevp", "dsum", "dvar", "dvarp",
  "hlookup", "vlookup", "lookup", "match", "search",
  "=", "<>", "<", "<=", ">", ">=",
]);

/** Could the host settings change this expression's answer? */
export function hostSensitive(node: Node): boolean {
  if (node.kind === "call") return HOST_SENSITIVE.has(node.fn) || node.args.some(hostSensitive);
  if (node.kind === "array") return node.rows.some((r) => r.some(hostSensitive));
  return false;
}
