// A `.table` holds one or more tables, each under `tables/<name>/`
// (SPEC section 1, D37). What every reader and writer needs to agree on:
// which names are valid, and the order tables are shown in.

import type { BundleMeta, ParsedTable } from "./types.js";

/**
 * A table's name is its directory name (SPEC section 1): non-empty, no
 * path separators, not hidden. Relations, addresses and the manifest's
 * `tables` list use it.
 */
export function isTableName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && !name.startsWith(".");
}

/**
 * Table names in display order: the manifest's `tables` list first,
 * skipping any it names that aren't there, then the rest by name.
 */
export function tableOrder(bundle: { meta?: BundleMeta; tables: Record<string, unknown> }): string[] {
  const present = Object.keys(bundle.tables);
  const listed = (bundle.meta?.tables ?? []).filter((n, i, all) => present.includes(n) && all.indexOf(n) === i);
  const rest = present.filter((n) => !listed.includes(n)).sort();
  return [...listed, ...rest];
}

/** A bundle's tables in display order, with their names. */
export function orderedTables<T = ParsedTable>(bundle: { meta?: BundleMeta; tables: Record<string, T> }): Array<[string, T]> {
  return tableOrder(bundle).map((name) => [name, bundle.tables[name]!]);
}
