// Does an engine's answer meet a case? The same judgement the case's
// source made: LibreOffice's `=`, or its check rounded to decimals or
// significant digits, or "is an error".

import type { Compare, Value } from "./node.js";

/** LibreOffice's approxEqual: equal to within 2^-48 of each other. */
export function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  const e48 = 2 ** -48;
  const d = Math.abs(a - b);
  return d < Math.abs(a) * e48 && d < Math.abs(b) * e48;
}

/** ROUND as OpenFormula defines it: halves away from zero. */
export function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  // Nudge by a relative ulp so 1.005 rounds as it reads, as spreadsheets do.
  const scaled = Math.abs(x) * f * (1 + Number.EPSILON);
  return (Math.sign(x) * Math.round(scaled)) / f;
}

function roundSig(x: number, sig: number): number {
  if (x === 0) return 0;
  const digits = sig - 1 - Math.floor(Math.log10(Math.abs(x)));
  return roundTo(x, digits);
}

function isError(v: Value): v is { error: string | null } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameNumber(got: number, want: number, compare?: Compare): boolean {
  if (!compare) return approxEqual(got, want);
  if ("round" in compare) return approxEqual(roundTo(got, compare.round), roundTo(want, compare.round));
  return approxEqual(roundSig(got, compare.sig), roundSig(want, compare.sig));
}

export function meets(got: Value, want: Value, compare?: Compare): boolean {
  if (isError(want)) {
    if (!isError(got)) return false;
    if (want.error !== null) return got.error === want.error;
    // "Any error" asks for the function's own failure. #NAME? says the
    // engine doesn't know the function, which isn't that.
    return got.error !== "#NAME?";
  }
  if (isError(got)) return false;
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return false;
    return want.every((row, r) => {
      const g = got[r]!;
      return Array.isArray(row) && Array.isArray(g) && row.length === g.length && row.every((w, c) => meets(g[c]!, w, compare));
    });
  }
  // A single value compares with an array's first item, as a cell showing
  // an array formula shows its top-left value.
  const top = Array.isArray(got) ? got[0]?.[0] : got;
  if (top === undefined) return false;
  // LibreOffice's `=` holds TRUE equal to 1 and FALSE to 0: OpenFormula
  // lets a logical be a number (4.3.7), and many cases store it as one.
  const asNumber = (v: Value) => (typeof v === "boolean" ? Number(v) : v);
  if (typeof want === "number" || typeof want === "boolean") {
    const g = asNumber(top), w = asNumber(want) as number;
    return typeof g === "number" && (typeof want === "boolean" ? g === w : sameNumber(g, w, compare));
  }
  return top === want;
}
