// Where an app starts: which table is shown first, and which view of each.

import type { ParsedTable } from "@workspace.sh/table-core";

/** The example table shown first, when it's there. */
export const DEFAULT_TABLE_KEY = "projects/projects";

/** The table to show first: the default one when it's held, else the first held; undefined when there's none. */
export function firstTableKey(tables: Record<string, ParsedTable>): string | undefined {
  return tables[DEFAULT_TABLE_KEY] ? DEFAULT_TABLE_KEY : Object.keys(tables)[0];
}

/** Each table's first view, by key: the view each table opens on. */
export function firstViews(tables: Record<string, ParsedTable>): Record<string, string> {
  return Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, t.views[0]?.id ?? ""]));
}
