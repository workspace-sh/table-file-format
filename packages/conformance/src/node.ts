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
