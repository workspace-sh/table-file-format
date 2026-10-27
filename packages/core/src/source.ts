import type { TableMeta, TableSource } from "./types.js";

/**
 * Where a table or bundle came from (SPEC section 5, D66), or nothing.
 *
 * A record of origin, so a `source` that isn't an object is ignored as an
 * unknown key is, and so is any member that isn't a non-empty string. An
 * object left with no members says nothing, and reads as none.
 */
export function sourceOf(meta: TableMeta | undefined): TableSource | undefined {
  const raw: unknown = meta?.source;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const source: TableSource = {};
  for (const key of ["uri", "format", "retrieved_at"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") source[key] = value;
  }
  return Object.keys(source).length > 0 ? source : undefined;
}
