// The rules behind the view settings panel (#86 step 6), kept apart from
// React so they can be tested on their own: which operators a field can
// use, how a typed filter value becomes a stored one, and which field a
// layout starts from. Views are SPEC section 4.

import type { Field, FieldType, FilterOperator, TableSchema, ViewLayout } from "@workspace.sh/table-core";

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "is",
  neq: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  empty: "is empty",
  not_empty: "is not empty",
  in: "is any of",
  not_in: "is none of",
};

const NUMERIC: FieldType[] = ["number", "integer", "year", "duration"];
const DATES: FieldType[] = ["date", "datetime", "time"];

/** The operators that mean something for this field. */
export function operatorsFor(field: Field | undefined): FilterOperator[] {
  const type = field?.type ?? "string";
  if (type === "boolean") return ["eq", "neq", "empty", "not_empty"];
  if (NUMERIC.includes(type) || DATES.includes(type)) {
    return ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty", "in", "not_in"];
  }
  if (field?.constraints?.enum) return ["eq", "neq", "in", "not_in", "empty", "not_empty"];
  return ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with", "empty", "not_empty", "in", "not_in"];
}

/** `empty` and `not_empty` stand alone; everything else compares with a value. */
export function takesValue(operator: FilterOperator): boolean {
  return operator !== "empty" && operator !== "not_empty";
}

function one(field: Field | undefined, raw: string): unknown {
  const text = raw.trim();
  const type = field?.type ?? "string";
  if (type === "boolean") return text.toLowerCase() === "true";
  if (NUMERIC.includes(type)) {
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? n : text;
  }
  return text;
}

/**
 * What a typed value is stored as: a number for a numeric field, a boolean
 * for a yes/no one, and for "is any of" / "is none of" a list, typed
 * comma-separated.
 */
export function filterValueFrom(field: Field | undefined, operator: FilterOperator, raw: string): unknown {
  if (!takesValue(operator)) return undefined;
  if (operator === "in" || operator === "not_in") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => one(field, part));
  }
  return one(field, raw);
}

/** A stored value as it's typed back in the box. */
export function filterValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  return value === undefined || value === null ? "" : String(value);
}

/**
 * The field a layout is drawn from when it's chosen: a board's columns
 * (an enum, else any text field), a calendar's dates. Null when the table
 * has none, and the layout isn't offered.
 */
export function layoutFieldFor(layout: ViewLayout, schema: TableSchema): string | null {
  const live = schema.fields.filter((f) => !f.deprecated);
  if (layout === "board") {
    return (live.find((f) => f.constraints?.enum) ?? live.find((f) => f.type === "string"))?.name ?? null;
  }
  if (layout === "calendar") return live.find((f) => f.type === "date" || f.type === "datetime")?.name ?? null;
  return null;
}

export const LAYOUTS: ViewLayout[] = ["table", "board", "list", "gallery", "calendar"];

/** Whether the table has what this layout needs. */
export function canUseLayout(layout: ViewLayout, schema: TableSchema): boolean {
  if (layout === "board" || layout === "calendar") return layoutFieldFor(layout, schema) !== null;
  return true;
}
