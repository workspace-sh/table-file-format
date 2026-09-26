// A new field's stored key, from the name someone typed for it. The typed
// name becomes the field's `title` (free to change later); the key is its
// `name`, which never changes (SPEC "Schema evolution"). A plain key keeps
// formulas plain: `close_date`, not `{Close date}`.

/**
 * Lowercase letters and digits of any script, runs of anything else as one
 * `_`, never repeating a key already in use (a number is added: `status_2`).
 */
export function fieldKey(typed: string, existing: ReadonlySet<string>): string {
  const base =
    typed
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "") || "field";
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
