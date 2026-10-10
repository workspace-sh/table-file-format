// A large table while it is read into its index (LARGE-TABLES-PLAN,
// decision 1): its rows show at once, as its file has them, with how far
// the reading has got. What each app says and shows meanwhile is here, so
// they say the same.

import type { View } from "@workspace.sh/table-core";

/** A view with only what the head of a file can show: its fields and sizes, not its order, filters, groups or totals. */
export function asStored(view: View): View {
  const { sort: _sort, order: _order, filter: _filter, group: _group, totals: _totals, ...rest } = view;
  return rest;
}

/**
 * How far the reading has got. How many rows there are isn't known until the
 * last is read, so until then the total is "about", to two figures: a number
 * that changed with every step would read as a fault.
 */
export function readingText(building: { done: number; total: number }): string {
  if (building.total <= 0) return "Reading rows";
  if (building.done >= building.total) return `${building.done.toLocaleString()} rows read`;
  const digits = Math.max(0, String(Math.round(building.total)).length - 2);
  const about = Math.round(building.total / 10 ** digits) * 10 ** digits;
  return `${building.done.toLocaleString()} of about ${Math.max(about, building.done).toLocaleString()} rows read`;
}

/** What the line above the first rows says while a large table is read. */
export function ingestingText(view: View): string {
  const arranged = !!(view.sort?.length || view.order?.length || view.filter?.length || view.group);
  return arranged
    ? "Showing rows as stored, as they're read. This view's sorting, filters and groups, and search and editing, are ready once the table is read. This happens once."
    : "Showing rows as stored, as they're read. Search and editing are ready once the table is read. This happens once.";
}
