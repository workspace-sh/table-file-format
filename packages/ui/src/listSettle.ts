// Where a page is put once its scrolling rests, under a list too tall to
// lay out as it is (RowList, web and native). The rows are drawn `shift`
// points further down the list than the page is; resting, the page moves to
// where those rows are in the whole list, the rows staying where they are,
// so how far down the page is says how far down the list you are.

/**
 * The page's place once scrolling rests, and the shift the rows then take;
 * null leaves the page where it is.
 *
 * `at` is how far the page is scrolled past the list's top, `screen` how
 * much of it shows, `laidOut` the height the list is laid out at, `more`
 * how much taller the whole list is than that, and `shift` the shift the
 * rows are drawn at now.
 */
export function settledPlace(at: number, screen: number, laidOut: number, more: number, shift: number): { to: number; shift: number } | null {
  if (more <= 0) return null;
  const range = Math.max(1, laidOut - screen);
  // At or above the list's top, or at or past its end, the page is showing
  // what's around the list (the title above, the new-row band below), and
  // the rows there are already the list's own first or last. Moving it
  // would pull the page off what it was scrolled to: the title couldn't be
  // reached, nor the last row.
  if (at <= 0 || at >= range) return null;
  const start = at + shift;
  const to = Math.min(range, Math.max(0, start / (1 + more / range)));
  if (Math.abs(to - at) < 2) return null;
  return { to, shift: start - to };
}
