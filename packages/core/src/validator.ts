import type { CellFormula, Field, Row, TableSchema, ValidationError } from "./types.js";
import { cellFormulas } from "./cells.js";
import { enumValues } from "./types.js";
import { isDate, isDateTime, isDuration, isGeoJSON, isGeopoint, isTime } from "./encoding.js";

export function validate(schema: TableSchema, rows: Row[], cells?: CellFormula[]): ValidationError[] {
  const errors: ValidationError[] = [];
  // A cell with its own formula is checked as a computed field's is: not at all, and it's filled (SPEC section 9, D52).
  const own = cellFormulas(schema, rows, cells);
  const seenIds = new Set<string>();
  const pkSeen = new Map<string, number>();
  // `unique` fields: each value held, and the first row that held it. Empty values don't count (SPEC section 2).
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
      for (const message of validateField(field, row[field.name])) errors.push({ field: field.name, message });
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

function validateField(field: Field, value: unknown): string[] {
  const errors: string[] = [];
  const c = field.constraints;
  const isMissing = value === undefined || value === null || value === "";

  if (isMissing) {
    if (c?.required) errors.push("required field is missing");
    return errors;
  }

  // Multi-target relation (cardinality "many"): the value is an array
  // of target ids. Validate each entry as a string; skip the scalar
  // type/enum/range checks below (they assume a single value).
  if (field.relation?.cardinality === "many") {
    if (!Array.isArray(value)) {
      errors.push("expected an array of relation ids (cardinality: many)");
    } else if (!value.every((v) => typeof v === "string")) {
      errors.push("relation array must contain only string ids");
    }
    return errors;
  }

  if (!typeMatches(field.type, value)) {
    errors.push(`expected type ${field.type}, got ${typeof value}`);
    return errors;
  }

  if (c?.enum) {
    const allowed = enumValues(field);
    // On an array, the choice list checks each item: multi-select (D35).
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (!allowed.includes(item as string)) errors.push(`value not in enum: ${JSON.stringify(item)}`);
    }
  }
  if (typeof value === "number") {
    if (c?.minimum !== undefined && value < c.minimum) errors.push(`below minimum ${c.minimum}`);
    if (c?.maximum !== undefined && value > c.maximum) errors.push(`above maximum ${c.maximum}`);
  }
  if (typeof value === "string") {
    if (c?.minLength !== undefined && value.length < c.minLength) errors.push(`below minLength ${c.minLength}`);
    if (c?.maxLength !== undefined && value.length > c.maxLength) errors.push(`above maxLength ${c.maxLength}`);
    if (c?.pattern !== undefined && !new RegExp(c.pattern).test(value)) errors.push(`fails pattern ${c.pattern}`);
  }

  return errors;
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
