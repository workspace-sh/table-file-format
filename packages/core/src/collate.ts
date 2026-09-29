/**
 * The order a saved sort puts text in (SPEC section 4, "Sort behaviour";
 * D41). It has to be the same on every device, since a Sheet view's rows
 * are numbered in it and formulas read those numbers: the viewer's
 * language can't decide it. So text is compared by Unicode code point,
 * ignoring case, with capitals first when that's the only difference.
 * JavaScript engines, Rust, and SQLite's default comparison all agree on
 * that order. A personal sort, which only changes one person's screen,
 * may use their language instead (`Intl.Collator`).
 */

/**
 * Two UTF-16 code units compared as the code points they belong to. In
 * UTF-16, U+E000–U+FFFF sort after the surrogates that encode U+10000 and
 * above; shifting both ranges puts them in code point order. Only the
 * first differing unit matters, and within one surrogate pair the order
 * of the units already matches code points.
 */
function unit(c: number): number {
  if (c < 0xd800) return c;
  return c >= 0xe000 ? c - 0x800 : c + 0x2000;
}

/** Two strings in code point order: -1, 0 or 1. */
export function byCodePoint(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return unit(x) < unit(y) ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/**
 * Text in a saved sort's order: ignoring case (Unicode's default lower
 * case, never a language's), then by code point; when only case differs,
 * capitals first. Returns -1, 0 or 1.
 */
export function compareText(a: string, b: string): number {
  return byCodePoint(a.toLowerCase(), b.toLowerCase()) || byCodePoint(a, b);
}

/** How a sort compares two pieces of text: the saved order, or a viewer's own. */
export type TextOrder = (a: string, b: string) => number;
