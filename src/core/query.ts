import type {
  Field,
  ParsedTable,
  Row,
  TableSchema,
  View,
  ViewFilter,
  ViewSort,
} from "./types.js";

export function applyFilters(rows: Row[], filters: ViewFilter[]): Row[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

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

export function applySort(rows: Row[], sorts: ViewSort[], schema: TableSchema): Row[] {
  if (!sorts.length) return rows;
  const fieldsByName = new Map(schema.fields.map((f) => [f.name, f]));
  const copy = rows.slice();
  copy.sort((a, b) => {
    for (const s of sorts) {
      const aVal = a[s.field];
      const bVal = b[s.field];
      const aMissing = aVal === undefined || aVal === null;
      const bMissing = bVal === undefined || bVal === null;
      if (aMissing && bMissing) continue;
      if (aMissing) return 1;
      if (bMissing) return -1;
      const cmp = compare(aVal, bVal, fieldsByName.get(s.field));
      if (cmp !== 0) return s.direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
  return copy;
}

export function applyGroup(
  rows: Row[],
  field: string,
  schema?: TableSchema,
): Record<string, Row[]> {
  const buckets = new Map<string, Row[]>();
  for (const row of rows) {
    const value = row[field];
    const key =
      value === undefined || value === null || value === "" ? "(empty)" : String(value);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const fieldDef = schema?.fields.find((f) => f.name === field);
  const enumValues = fieldDef?.constraints?.enum;
  const result: Record<string, Row[]> = {};

  if (enumValues) {
    for (const e of enumValues) {
      if (buckets.has(e)) {
        result[e] = buckets.get(e)!;
        buckets.delete(e);
      }
    }
  }
  for (const [k, v] of buckets) {
    if (k === "(empty)") continue;
    result[k] = v;
  }
  if (buckets.has("(empty)")) {
    result["(empty)"] = buckets.get("(empty)")!;
  }
  return result;
}

export function applyView(parsed: ParsedTable, view: View): Row[] {
  let rows = parsed.rows;
  if (view.filter) rows = applyFilters(rows, view.filter);
  if (view.sort) rows = applySort(rows, view.sort, parsed.schema);
  return rows;
}

function matchesFilter(row: Row, f: ViewFilter): boolean {
  const v = row[f.field];
  switch (f.operator) {
    case "eq": return v === f.value;
    case "neq": return v !== f.value;
    case "gt": return (v as number) > (f.value as number);
    case "gte": return (v as number) >= (f.value as number);
    case "lt": return (v as number) < (f.value as number);
    case "lte": return (v as number) <= (f.value as number);
    case "contains": return typeof v === "string" && v.includes(String(f.value));
    case "not_contains": return typeof v === "string" && !v.includes(String(f.value));
    case "starts_with": return typeof v === "string" && v.startsWith(String(f.value));
    case "ends_with": return typeof v === "string" && v.endsWith(String(f.value));
    case "empty": return v === undefined || v === null || v === "";
    case "not_empty": return !(v === undefined || v === null || v === "");
    case "in": return Array.isArray(f.value) && f.value.includes(v);
    case "not_in": return Array.isArray(f.value) && !f.value.includes(v);
  }
}

function compare(a: unknown, b: unknown, field: Field | undefined): number {
  const enumValues = field?.constraints?.enum;
  if (enumValues && typeof a === "string" && typeof b === "string") {
    const ai = enumValues.indexOf(a);
    const bi = enumValues.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}
