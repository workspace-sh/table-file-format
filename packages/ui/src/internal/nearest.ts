/** The offset nearest `x`, among `offsets` no further than `end`, and `end` itself: where a scroll at `x` comes to rest. */
export function nearest(offsets: readonly number[], x: number, end: number): number {
  let best = end;
  for (const offset of offsets) {
    const at = Math.min(offset, end);
    if (Math.abs(at - x) < Math.abs(best - x)) best = at;
  }
  return best;
}
