/**
 * Filtering, sorting, grouping and manual order: how a view arranges a
 * table's rows (SPEC section 4). Nothing here computes formulas, so both
 * views (query.ts) and Sheet view grids (grid.ts, workbook.ts) use it.
 */

import type { Field, Row, TableSchema, ViewFilter, ViewSort } from "./types.js";
import { enumValues } from "./types.js";
import { instantOf } from "./encoding.js";
import { byCodePoint, type TextOrder } from "./collate.js";

export function applyFilters(rows: Row[], filters: ViewFilter[]): Row[] {
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

/**
 * Rows in a sort's order. Text is compared in the saved order
 * (`compareText`, the same on every device) unless `options.text` gives a
 * viewer's own, for a personal sort. Rows that tie keep the order they
 * came in (the sort is stable), which is file order for a table's rows.
 */
export function applySort(
  rows: Row[],
  sorts: ViewSort[],
  schema: TableSchema,
  options: { text?: TextOrder } = {},
): Row[] {
  if (!sorts.length) return rows;
  return sorter(sorts, schema, options.text).sort(rows, (row, f) => row[f]);
}

/** A value as a sort compares it, worked out once per row; null when empty. */
export type SortKey = {
  /** Numbers, then text, then true/false (SPEC "Sort behaviour"). */
  kind: 0 | 1 | 2;
  isString: boolean;
  num: number;
  text: string;
  /** Text in Unicode's default lower case, for the saved order. */
  folded: string;
  /** Whether the text has a unit from U+D800 up, where UTF-16 order isn't code point order. */
  wide: boolean;
  /** Its place in the field's enum: -1 when it isn't one of them. */
  enumAt: number;
  /** A datetime's instant; NaN otherwise. */
  instant: number;
} | null;

const WIDE = /[\uD800-\uFFFF]/;
/** Text that native comparison doesn't put in code point order. */
const NOT_PLAIN = WIDE;

/** Two strings in code point order: native comparison when either has no wide units, which gives the same. */
function codePoints(a: string, aWide: boolean, b: string, bWide: boolean): number {
  if (aWide && bWide) return byCodePoint(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How a list of sorts reads a row's keys and compares two rows' keys. */
export function sorter(sorts: ViewSort[], schema: TableSchema, text?: TextOrder) {
  const fieldsByName = new Map(schema.fields.map((f) => [f.name, f]));
  const orders = sorts.map((s) => sortOrder(fieldsByName.get(s.field), text));
  const one = sorts.length === 1 && !text ? { sort: sorts[0]!, order: orders[0]! } : null;
  return {
    /**
     * Items in the sorts' order, stable. Each item's keys are worked out
     * once, not on every comparison (a million rows are compared about
     * twenty million times); a lone sort over only plain text or only
     * numbers compares one native key per item.
     */
    sort<T>(items: T[], read: (item: T, field: string) => unknown): T[] {
      if (one && !one.order.hasEnum && !one.order.isDatetime) {
        const fast = sortSimple(items, (item) => read(item, one.sort.field), one.sort.direction === "desc");
        if (fast) return fast;
      }
      const keyed = items.map((item) => ({ item, keys: this.keys((f) => read(item, f)) }));
      keyed.sort((a, b) => this.compare(a.keys, b.keys));
      return keyed.map((k) => k.item);
    },
    keys(read: (field: string) => unknown): SortKey[] {
      return sorts.map((s, i) => orders[i]!.key(read(s.field)));
    },
    compare(a: SortKey[], b: SortKey[]): number {
      for (let i = 0; i < sorts.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        // Absent, null and "" are all empty, and empties sort last (SPEC "Empty values").
        if (x === null && y === null) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        const cmp = orders[i]!.compare(x, y);
        if (cmp !== 0) return sorts[i]!.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    },
  };
}

/**
 * One sort over values that are all numbers, or all plain text, compared
 * natively: native comparison is code point order for text without wide
 * units. Undefined when the values are anything else.
 */
function sortSimple<T>(items: T[], value: (item: T) => unknown, desc: boolean): T[] | undefined {
  const firsts: (string | number)[] = new Array(items.length);
  const seconds: string[] = new Array(items.length);
  const filled: number[] = [];
  const empty: T[] = [];
  let numbers = 0;
  for (let i = 0; i < items.length; i++) {
    const v = value(items[i]!);
    if (v === undefined || v === null || v === "") {
      empty.push(items[i]!);
      continue;
    }
    if (typeof v === "number") {
      if (Number.isNaN(v)) return undefined;
      numbers++;
      firsts[i] = v;
    } else if (typeof v === "string") {
      const folded = v.toLowerCase();
      if (NOT_PLAIN.test(v) || (folded !== v && NOT_PLAIN.test(folded))) return undefined;
      firsts[i] = folded;
      seconds[i] = v;
    } else return undefined;
    filled.push(i);
  }
  if (numbers !== 0 && numbers !== filled.length) return undefined;
  const sign = desc ? -1 : 1;
  // Array sort is stable, so ties keep the order items came in. Text
  // compares as compareText does: its lower case, then itself.
  filled.sort((a, b) => {
    const x = firsts[a]!;
    const y = firsts[b]!;
    if (x !== y) return x < y ? -sign : sign;
    if (numbers !== 0) return 0;
    const p = seconds[a]!;
    const q = seconds[b]!;
    return p === q ? 0 : p < q ? -sign : sign;
  });
  const out: T[] = filled.map((i) => items[i]!);
  // Empties last, whichever way the sort runs.
  for (const e of empty) out.push(e);
  return out;
}

function sortOrder(field: Field | undefined, text: TextOrder | undefined) {
  const declared = enumValues(field);
  const enumAt = new Map(declared.map((v, i) => [v, i]));
  const hasEnum = declared.length > 0;
  const isDatetime = field?.type === "datetime";
  return {
    hasEnum,
    isDatetime,
    key(v: unknown): SortKey {
      if (v === undefined || v === null || v === "") return null;
      const isString = typeof v === "string";
      const kind = typeof v === "number" ? 0 : typeof v === "boolean" ? 2 : 1;
      const str = kind === 1 ? String(v) : "";
      const folded = text || kind !== 1 ? "" : str.toLowerCase();
      return {
        kind,
        isString,
        num: kind === 1 ? 0 : Number(v),
        text: str,
        folded,
        wide: WIDE.test(str) || WIDE.test(folded),
        enumAt: hasEnum && isString ? (enumAt.get(v as string) ?? -1) : -1,
        instant: isDatetime && isString ? instantOf(v as string) : NaN,
      };
    },
    compare(a: NonNullable<SortKey>, b: NonNullable<SortKey>): number {
      // An enum sorts by its declared order (not alphabetically).
      if (hasEnum && a.isString && b.isString) {
        if (a.enumAt !== -1 && b.enumAt !== -1) return a.enumAt - b.enumAt;
        if (a.enumAt !== -1) return -1;
        if (b.enumAt !== -1) return 1;
      }
      // By instant, not spelling: "10:00+02:00" is before "09:00Z" (SPEC "Value encodings").
      if (!Number.isNaN(a.instant) && !Number.isNaN(b.instant) && a.instant !== b.instant) return a.instant - b.instant;
      // Different kinds in one field: numbers, then text, then true/false.
      if (a.kind !== b.kind) return a.kind - b.kind;
      if (a.kind !== 1) return a.num - b.num;
      if (text) return text(a.text, b.text);
      // compareText, with each side's lower case worked out once.
      return codePoints(a.folded, a.wide, b.folded, b.wide) || codePoints(a.text, a.wide, b.text, b.wide);
    },
  };
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
  const order = enumValues(fieldDef);
  const result: Record<string, Row[]> = {};

  if (order.length > 0) {
    for (const e of order) {
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

/**
 * Apply a manual row ordering. Rows mentioned in `order` come first, in
 * that sequence; rows not mentioned follow in the input's order. Stable
 * for both groups.
 */
export function applyOrder(rows: Row[], order: string[] | undefined): Row[] {
  return inOrder(rows, order, (r) => r.id);
}

/** `applyOrder` for anything that carries a row id. */
export function inOrder<T>(items: T[], order: string[] | undefined, id: (item: T) => string): T[] {
  if (!order || order.length === 0) return items;
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const mentioned: T[] = [];
  const unmentioned: T[] = [];
  for (const item of items) {
    if (orderIndex.has(id(item))) mentioned.push(item);
    else unmentioned.push(item);
  }
  mentioned.sort((a, b) => orderIndex.get(id(a))! - orderIndex.get(id(b))!);
  for (const item of unmentioned) mentioned.push(item);
  return mentioned;
}

export function matchesFilter(row: Row, f: ViewFilter): boolean {
  const v = row[f.field];
  switch (f.operator) {
    case "eq": return v === f.value;
    case "neq": return v !== f.value;
    case "gt": return (v as number) > (f.value as number);
    case "gte": return (v as number) >= (f.value as number);
    case "lt": return (v as number) < (f.value as number);
    case "lte": return (v as number) <= (f.value as number);
    // On an array (a multi-select, say) these ask about its items (D35).
    case "contains": return Array.isArray(v) ? v.includes(f.value) : typeof v === "string" && v.includes(String(f.value));
    case "not_contains": return Array.isArray(v) ? !v.includes(f.value) : typeof v === "string" && !v.includes(String(f.value));
    case "starts_with": return typeof v === "string" && v.startsWith(String(f.value));
    case "ends_with": return typeof v === "string" && v.endsWith(String(f.value));
    case "empty": return v === undefined || v === null || v === "";
    case "not_empty": return !(v === undefined || v === null || v === "");
    // An array value is "in" the list when any of its items is.
    case "in": return Array.isArray(f.value) && (Array.isArray(v) ? v.some((x) => (f.value as unknown[]).includes(x)) : f.value.includes(v));
    case "not_in": return Array.isArray(f.value) && (Array.isArray(v) ? !v.some((x) => (f.value as unknown[]).includes(x)) : !f.value.includes(v));
  }
}
