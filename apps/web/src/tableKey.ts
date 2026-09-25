// Where a table made in the demo is kept, by the name its maker gave it.

/**
 * The key a new table goes under: its name, lowercased and hyphenated, as
 * a relation would name it. A clash gets a number.
 */
export function tableKeyFor(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}
