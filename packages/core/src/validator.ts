import type { CellFormula, Field, Row, TableSchema, ValidationError } from "./types.js";
import { cellFormulas } from "./cells.js";
import { enumValues } from "./types.js";
import { instantOf, isDate, isDateTime, isDuration, isGeoJSON, isGeopoint, isTime, isYearMonth } from "./encoding.js";

export function validate(schema: TableSchema, rows: Row[], cells?: CellFormula[]): ValidationError[] {
  const errors: ValidationError[] = [];
  // A cell with its own formula is checked as a computed field's is: not at all, and it's filled (SPEC section 9, D52).
  const own = cellFormulas(schema, rows, cells);
  const seenIds = new Set<string>();
  const pkSeen = new Map<string, number>();
  // `unique` fields: each value held, and the first row that held it. Empty values don't count (SPEC section 2).
  const uniqueKeys = (schema.uniqueKeys ?? []).filter((k) => Array.isArray(k) && k.length > 0).map((fields) => ({ fields, seen: new Map<string, number>() }));
  const uniques = schema.fields.filter((f) => f.constraints?.unique && !f.computed).map((f) => ({ name: f.name, seen: new Map<string, number>() }));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (typeof row.id !== "string" || row.id.length === 0) {
      errors.push({ rowIndex: i, message: "row is missing system id" });
    } else if (seenIds.has(row.id)) {
      errors.push({ rowIndex: i, rowId: row.id, message: `duplicate system id: ${row.id}` });
    } else {
      seenIds.add(row.id);
    }

    for (const e of fieldErrorsOf(schema, row)) {
      if (own.get(row.id)?.has(e.field)) continue;
      errors.push({ rowIndex: i, rowId: row.id, field: e.field, message: e.message });
    }

    for (const u of uniques) {
      const value = row[u.name];
      if (value === undefined || value === null || value === "") continue;
      const key = JSON.stringify(value);
      const prior = u.seen.get(key);
      if (prior !== undefined) errors.push({ rowIndex: i, rowId: row.id, field: u.name, message: `${u.name} must be unique: row ${prior} has the same value` });
      else u.seen.set(key, i);
    }

    // uniqueKeys (D67): as primaryKey, but a row with any of the fields empty isn't checked.
    for (const k of uniqueKeys) {
      const values = k.fields.map((f) => row[f]);
      if (values.some((v) => v === undefined || v === null || v === "")) continue;
      const key = values.map((v) => JSON.stringify(v)).join("\u0000");
      const prior = k.seen.get(key);
      if (prior !== undefined) errors.push({ rowIndex: i, rowId: row.id, message: `unique key collision with row ${prior} on [${k.fields.join(", ")}]` });
      else k.seen.set(key, i);
    }

    if (schema.primaryKey && schema.primaryKey.length > 0) {
      const key = schema.primaryKey.map((f) => JSON.stringify(row[f])).join("\u0000");
      const prior = pkSeen.get(key);
      if (prior !== undefined) {
        errors.push({
          rowIndex: i,
          rowId: row.id,
          message: `primary key collision with row ${prior} on [${schema.primaryKey.join(", ")}]`,
        });
      } else {
        pkSeen.set(key, i);
      }
    }
  }

  // Two fields with one id (D62): a writer gives the second another, but as read it isn't valid.
  const fieldIds = new Set<string>();
  for (const f of schema.fields) {
    if (typeof f.id !== "string") continue;
    if (fieldIds.has(f.id)) errors.push({ rowIndex: -1, field: f.name, message: `field ${f.name} has the id ${f.id}, which another field has` });
    fieldIds.add(f.id);
  }

  // A line of cells/ for a row or field the table hasn't: kept by the writer, but not valid (SPEC section 9).
  const ids = new Set(rows.map((r) => r.id));
  const names = new Set(schema.fields.map((f) => f.name));
  for (const c of cells ?? []) {
    if (!ids.has(c.id)) errors.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `cells/ has a formula for row ${c.id}, which isn't there` });
    else if (!names.has(c.field) || c.field === "id") errors.push({ rowIndex: -1, rowId: c.id, field: c.field, message: `cells/ has a formula for field ${c.field}, which isn't there` });
  }

  return errors;
}

/** Whether `field` can hold `value` by its type: what a cell's formula's result is checked against (D52). Constraints aren't asked. */
export function holds(field: Field, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (field.relation?.cardinality === "many") return Array.isArray(value) && value.every((v) => typeof v === "string");
  return typeMatches(field.type, value);
}

/**
 * A row's own field errors, kept for the row object: a row is never
 * changed in place (an edit makes a new one), so an edit to one row of a
 * million checks one row's fields, and the rest are found again.
 */
const fieldErrorMemo = new WeakMap<TableSchema, WeakMap<Row, { field: string; message: string }[]>>();
const NO_ERRORS: { field: string; message: string }[] = [];

function fieldErrorsOf(schema: TableSchema, row: Row): { field: string; message: string }[] {
  let rows = fieldErrorMemo.get(schema);
  if (!rows) fieldErrorMemo.set(schema, (rows = new WeakMap()));
  let found = rows.get(row);
  if (!found) {
    const errors: { field: string; message: string }[] = [];
    for (const field of schema.fields) {
      if (field.computed) continue; // derived on read, never stored — nothing to validate
      for (const p of valueProblems(field, row[field.name])) errors.push({ field: field.name, message: p.message });
    }
    rows.set(row, (found = errors.length === 0 ? NO_ERRORS : errors));
  }
  return found;
}

/**
 * Check that every entry in `bodies` has a matching row.id. Bodies present
 * without a corresponding row are reported as orphans. Rows missing a body
 * are NOT reported — bodies are optional.
 */
export function validateBodies(
  rows: Row[],
  bodies: Record<string, string> | undefined,
): ValidationError[] {
  if (!bodies) return [];
  const rowIds = new Set(rows.map((r) => r.id));
  const errors: ValidationError[] = [];
  for (const id of Object.keys(bodies)) {
    if (!rowIds.has(id)) {
      errors.push({
        rowIndex: -1,
        rowId: id,
        message: `orphaned body: bodies/${id}.md has no matching row`,
      });
    }
  }
  return errors;
}

/** One thing wrong with a value, by its code (a `ProblemCode`), with what it was checked against. */
export interface ValueProblem {
  code: "value.required" | "value.type" | "value.choice" | "value.minimum" | "value.maximum" | "value.exclusive-minimum" | "value.exclusive-maximum" | "value.min-length" | "value.max-length" | "value.pattern";
  message: string;
  details: Record<string, string | number | boolean | null>;
}

/**
 * A value problem said in English, from its code and details (and, for a relation's ids, the value):
 * the one place its words are written, for what's found here and what the engine finds (#867).
 */
export function valueMessage(code: ValueProblem["code"], details: ValueProblem["details"], field: Pick<Field, "type" | "relation">, value: unknown): string {
  switch (code) {
    case "value.required":
      return "required field is missing";
    case "value.type":
      if (field.relation?.cardinality === "many") return Array.isArray(value) ? "relation array must contain only string ids" : "expected an array of relation ids (cardinality: many)";
      return `expected type ${field.type}, got ${String(details["got"])}`;
    case "value.choice":
      return `value not in enum: ${String(details["value"])}`;
    case "value.minimum":
      return `below minimum ${String(details["limit"])}`;
    case "value.maximum":
      return `above maximum ${String(details["limit"])}`;
    case "value.exclusive-minimum":
      return `not above exclusiveMinimum ${String(details["limit"])}`;
    case "value.exclusive-maximum":
      return `not below exclusiveMaximum ${String(details["limit"])}`;
    case "value.min-length":
      return `below minLength ${String(details["limit"])}`;
    case "value.max-length":
      return `above maxLength ${String(details["limit"])}`;
    case "value.pattern":
      return `fails pattern ${String(details["limit"])}`;
  }
}

/** What is wrong with `value` in `field` by its type and constraints (SPEC section 9, rule 2). */
export function valueProblems(field: Field, value: unknown): ValueProblem[] {
  const out: ValueProblem[] = [];
  const add = (code: ValueProblem["code"], details: ValueProblem["details"]) => out.push({ code, message: valueMessage(code, details, field, value), details });
  const c = field.constraints;
  const isMissing = value === undefined || value === null || value === "";

  if (isMissing) {
    if (c?.required) add("value.required", {});
    return out;
  }

  // Multi-target relation (cardinality "many"): the value is an array
  // of target ids. Validate each entry as a string; skip the scalar
  // type/enum/range checks below (they assume a single value).
  if (field.relation?.cardinality === "many") {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) add("value.type", { expected: "array" });
    return out;
  }

  if (!typeMatches(field.type, value)) {
    add("value.type", { expected: field.type, got: typeof value });
    return out;
  }

  // The choices, from `categories` or `constraints.enum` (D68). On an array, each item: multi-select (D35).
  const allowed = enumValues(field);
  if (allowed.length > 0) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!allowed.includes(item as string)) add("value.choice", { value: JSON.stringify(item) });
    }
  }

  const bound = (key: "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum", code: ValueProblem["code"], fails: (order: number) => boolean) => {
    const limit = c?.[key];
    if (limit === undefined) return;
    const order = compareBound(field.type, value, limit);
    if (order !== null && fails(order)) add(code, { constraint: key, limit });
  };
  bound("minimum", "value.minimum", (o) => o < 0);
  bound("maximum", "value.maximum", (o) => o > 0);
  bound("exclusiveMinimum", "value.exclusive-minimum", (o) => o <= 0);
  bound("exclusiveMaximum", "value.exclusive-maximum", (o) => o >= 0);

  if (typeof value === "string") {
    if (c?.minLength !== undefined && value.length < c.minLength) add("value.min-length", { constraint: "minLength", limit: c.minLength, length: value.length });
    if (c?.maxLength !== undefined && value.length > c.maxLength) add("value.max-length", { constraint: "maxLength", limit: c.maxLength, length: value.length });
    if (c?.pattern !== undefined && !new RegExp(c.pattern).test(value)) add("value.pattern", { constraint: "pattern", limit: c.pattern });
  }

  return out;
}

/**
 * How `value` stands to a bound (negative below, 0 at, positive above), for
 * the types bounds apply to (SPEC section 2): numbers and years, dates,
 * datetimes (as instants), times and year-months. Null when they can't be
 * compared: another type, a bound of the wrong kind, or a duration, whose
 * months and days have no fixed length.
 */
function compareBound(type: Field["type"], value: unknown, limit: number | string): number | null {
  if (typeof value === "number" && typeof limit === "number") return value - limit;
  if (typeof value !== "string" || typeof limit !== "string") return null;
  switch (type) {
    case "date":
    case "time":
    case "yearmonth":
      // Fixed-width, most significant first: the text's order is the value's.
      return value < limit ? -1 : value > limit ? 1 : 0;
    case "datetime": {
      const d = instantOf(value) - instantOf(limit);
      return Number.isNaN(d) ? null : d;
    }
    default:
      return null;
  }
}

function typeMatches(type: Field["type"], value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "date":
      return typeof value === "string" && isDate(value);
    case "datetime":
      return typeof value === "string" && isDateTime(value);
    case "time":
      return typeof value === "string" && isTime(value);
    case "duration":
      return typeof value === "string" && isDuration(value);
    case "yearmonth":
      return typeof value === "string" && isYearMonth(value);
    case "geojson":
      return isGeoJSON(value);
    case "any":
      // Any JSON value (D56): only a number JSON can't write is refused.
      return typeof value !== "number" || Number.isFinite(value);
    case "number":
      // Infinity and NaN have no JSON form: written, they'd become null.
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
    case "year":
      // Beyond ±(2^53 − 1) JSON parsers round silently (SPEC "Numbers").
      return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "geopoint":
      return isGeopoint(value);
    default:
      return true;
  }
}
