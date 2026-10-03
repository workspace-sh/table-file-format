// Putting a settings sheet back as it opened (Cancel). Free of any
// renderer, as shared.ts.

/**
 * The patch that turns `now` back into `before`: each key that differs,
 * at its old value, and a key added since, cleared (`undefined`, which
 * isn't written). Empty when nothing changed.
 */
export function revertPatch<T extends object>(before: T, now: T): Partial<T> {
  const patch: Partial<T> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(now)]) as Set<keyof T>;
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(now[key])) patch[key] = before[key];
  }
  return patch;
}

/** The moves (each -1 or 1) that take an item from `now` back to `before`. */
export function movesBack(before: number, now: number): (-1 | 1)[] {
  return Array.from({ length: Math.abs(now - before) }, () => (now > before ? -1 : 1));
}
