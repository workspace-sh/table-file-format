// A JSON Schema (2020-12) for one table's rows, made from its schema.json
// (SPEC section 9, "JSON Schema"): each value checked against its field's
// type and the constraints JSON Schema can say. What it can't say (unique
// values, keys, date bounds, real calendar days) is the validator's.

import type { Field, TableSchema } from "./types.js";
import { enumValues } from "./types.js";

/** The value encodings' patterns (SPEC section 2), as schema/schema.schema.json writes them for bounds. */
export const VALUE_PATTERNS = {
  date: "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$",
  datetime: "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])?$",
  time: "^([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\\.[0-9]+)?$",
  yearmonth: "^[0-9]{4}-(0[1-9]|1[0-2])$",
  duration: "^P(?!$)([0-9]+([.,][0-9]+)?Y)?([0-9]+([.,][0-9]+)?M)?([0-9]+([.,][0-9]+)?W)?([0-9]+([.,][0-9]+)?D)?(T(?=[0-9])([0-9]+([.,][0-9]+)?H)?([0-9]+([.,][0-9]+)?M)?([0-9]+([.,][0-9]+)?S)?)?$",
} as const;

/** ±(2⁵³−1): the integers every JSON parser reads exactly (SPEC section 2, "Numbers"). */
const SAFE = Number.MAX_SAFE_INTEGER;

type JsonSchema = Record<string, unknown>;

/** What a value of `type` is, before constraints. */
function typeSchema(type: Field["type"]): JsonSchema {
  switch (type) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "integer":
    case "year":
      return { type: "integer", minimum: -SAFE, maximum: SAFE };
    case "boolean":
      return { type: "boolean" };
    case "date":
    case "datetime":
    case "time":
    case "yearmonth":
    case "duration":
      return { type: "string", pattern: VALUE_PATTERNS[type] };
    case "array":
      return { type: "array" };
    case "object":
      return { type: "object" };
    case "geopoint":
      return {
        type: "array",
        prefixItems: [
          { type: "number", minimum: -180, maximum: 180 },
          { type: "number", minimum: -90, maximum: 90 },
        ],
        minItems: 2,
        maxItems: 2,
      };
    case "geojson":
      // Writers write the object; readers still accept its text (SPEC section 2).
      return {
        anyOf: [
          { type: "object", required: ["type"], properties: { type: { type: "string" } } },
          { type: "string", contentMediaType: "application/geo+json" },
        ],
      };
    case "any":
      return {};
    default:
      return {};
  }
}

/** A value of `field`, filled: its type, choices and the constraints JSON Schema can check. */
function filledSchema(field: Field): JsonSchema {
  const c = field.constraints ?? {};
  if (field.relation?.cardinality === "many") {
    return { type: "array", items: { type: "string" }, ...(c.required ? { minItems: 1 } : {}) };
  }
  const parts: JsonSchema[] = [typeSchema(field.type)];
  const choices = enumValues(field);
  if (choices.length > 0) {
    // Multi-select: each item a choice, and required rejects an empty list (SPEC section 2, D35).
    if (field.type === "array") parts.push({ type: "array", items: { enum: choices }, ...(c.required ? { minItems: 1 } : {}) });
    else parts.push({ enum: choices });
  }
  // Bounds JSON Schema can compare: numbers. Dates, times, year-months and durations are the validator's.
  if (field.type === "number" || field.type === "integer" || field.type === "year") {
    const bounds: JsonSchema = {};
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
      if (typeof c[key] === "number") bounds[key] = c[key];
    }
    if (Object.keys(bounds).length > 0) parts.push({ type: "number", ...bounds });
  }
  if (field.type === "string" || field.type === "any") {
    const text: JsonSchema = {};
    if (c.minLength !== undefined) text["minLength"] = c.minLength;
    if (c.maxLength !== undefined) text["maxLength"] = c.maxLength;
    if (c.pattern !== undefined) text["pattern"] = c.pattern;
    if (Object.keys(text).length > 0) parts.push(field.type === "any" ? { if: { type: "string" }, then: { type: "string", ...text } } : { type: "string", ...text });
  }
  return parts.length === 1 ? parts[0]! : { allOf: parts };
}

/**
 * The JSON Schema for one row of a table with this schema (SPEC section 9,
 * rule 2): an object with a non-empty system `id`, each field's value empty
 * (absent, `null` or `""`) or of its type and within its constraints, and
 * a required field filled. A computed field isn't checked, as validation
 * skips it; keys the schema doesn't name are allowed.
 */
export function rowJsonSchema(schema: TableSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = { id: { type: "string", minLength: 1 } };
  const required = ["id"];
  for (const field of schema.fields) {
    if (field.computed || field.name === "id") continue;
    const filled = filledSchema(field);
    if (field.constraints?.required) {
      required.push(field.name);
      properties[field.name] = { allOf: [{ not: { enum: [null, ""] } }, filled] };
    } else {
      properties[field.name] = { anyOf: [{ enum: [null, ""] }, filled] };
    }
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "A row of this table",
    type: "object",
    required,
    properties,
  };
}
