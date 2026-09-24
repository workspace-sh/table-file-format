import type { Field, Row, TableSchema, ValidationError } from "./types.js";
import { enumValues } from "./types.js";
import { isDate, isDateTime, isDuration, isGeoJSON, isGeopoint, isTime } from "./encoding.js";

export function validate(schema: TableSchema, rows: Row[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const pkSeen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (typeof row.id !== "string" || row.id.length === 0) {
      errors.push({ rowIndex: i, message: "row is missing system id" });
    } else if (seenIds.has(row.id)) {
      errors.push({ rowIndex: i, rowId: row.id, message: `duplicate system id: ${row.id}` });
    } else {
      seenIds.add(row.id);
    }

    for (const field of schema.fields) {
      if (field.computed) continue; // derived on read, never stored — nothing to validate
      const value = row[field.name];
      const fieldErrors = validateField(field, value);
      for (const message of fieldErrors) {
        errors.push({ rowIndex: i, rowId: row.id, field: field.name, message });
      }
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

  return errors;
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
    if (!allowed.includes(value as string)) {
      errors.push(`value not in enum: ${JSON.stringify(value)}`);
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
    case "number":
      return typeof value === "number";
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
