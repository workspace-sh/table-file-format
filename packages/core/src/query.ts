import type { ViewTotal, ParsedTable, Row, TableSchema, View } from "./types.js";
import { computeRows, type ComputeOptions } from "./workbook.js";
import { applyFilters, applyOrder, applySort } from "./arrange.js";

// How views arrange rows lives in arrange.ts, which Sheet view grids share.
export { applyFilters, applySort, applyGroup, applyOrder } from "./arrange.js";

/**
 * Browser-safe text search: case-insensitive substring match over every
 * string-typed field plus the system `id`. Does not search nested objects
 * or arrays. Optional `bodies` lets the search reach into long-form
 * markdown content too.
 *
 * This is the spec-mandated fallback path for readers without
 * `index.sqlite` (or with a stale one). The Node-side FTS5-backed search
 * via `queryIndex` will be more performant for large tables; this scans
 * linearly.
 */
export function searchRows(
  rows: Row[],
  query: string,
  options?: { schema?: TableSchema; bodies?: Record<string, string> },
): Row[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return rows;
  const needle = trimmed.toLowerCase();
  const stringFields = options?.schema
    ? options.schema.fields
        .filter((f) => f.type === "string" || f.type === "date" || f.type === "datetime")
        .map((f) => f.name)
    : null;

  return rows.filter((row) => {
    if (typeof row.id === "string" && row.id.toLowerCase().includes(needle)) return true;
    const fieldNames = stringFields ?? Object.keys(row);
    for (const name of fieldNames) {
      const v = row[name];
      if (typeof v === "string" && v.toLowerCase().includes(needle)) return true;
    }
    const body = options?.bodies?.[row.id];
    if (typeof body === "string" && body.toLowerCase().includes(needle)) return true;
    return false;
  });
}

export function applyView(parsed: ParsedTable, view: View, options: ComputeOptions = {}): Row[] {
  // Computed fields first, so a view can filter and sort on them. The
  // results live only in the returned rows — never in parsed.rows.
  // `options.tables` lets lookups and linked rows reach other tables (D36),
  // and the table's own views let formulas read its Sheet views (D41).
  let rows = computeRows(parsed.schema, parsed.rows, { views: parsed.views, ...options }).rows;
  if (view.filter) rows = applyFilters(rows, view.filter);
  // Manual order takes precedence over sort. The user dragged things
  // into place; the view becomes manual-order until the order array is
  // cleared.
  if (view.order && view.order.length > 0) {
    rows = applyOrder(rows, view.order);
  } else if (view.sort) {
    rows = applySort(rows, view.sort, parsed.schema);
  }
  return rows;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * A totals footer's value for one column (SPEC section 4, `totals`), over
 * the rows a view shows. Sums and averages read numbers and skip anything
 * else; counts count values, or blanks. Undefined when there's nothing to
 * total.
 */
export function viewTotal(rows: Row[], field: string, kind: ViewTotal): number | undefined {
  const values = rows.map((r) => r[field]);
  if (kind === "count") return values.filter((v) => !isBlank(v)).length;
  if (kind === "count_empty") return values.filter(isBlank).length;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return undefined;
  switch (kind) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "average":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

