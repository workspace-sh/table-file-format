// A field's `format`, `display` and `categories` (DECISIONS D68).
//
// `format` means what Table Schema says it means: how the stored value is
// written (`email`, `uri`, `uuid`, `binary`; `default` for dates). How a value
// is shown is `display` (`currency:GBP`, `long`, `phone`, `markdown`). The
// choices a field offers are `categories`, each a bare value or `{ value,
// label, color }`.
//
// Files written before D68 put the display token in `format` and the choices
// in `constraints.enum`. Readers take both forms (`displayOf`, `enumOptions`),
// and every write puts a schema in this form (`canonicalSchema`), so a file
// upgrades the next time it is saved.

import type { EnumOption, Field, TableSchema } from "./types.js";

/** Table Schema's own `format` values for a string: how the value is written. */
const STRING_FORMATS = new Set(["default", "email", "uri", "uuid", "binary"]);

/**
 * How a field is shown, in the display vocabulary (SPEC "Field display"):
 * `display` when it has one; otherwise what its `format` implies (`uri` is
 * shown as a link, `email` as an address); otherwise, for a file written
 * before D68, the display token it kept in `format`.
 */
export function displayOf(field: Pick<Field, "format" | "display"> | undefined): string | undefined {
  if (!field) return undefined;
  if (typeof field.display === "string" && field.display !== "") return field.display;
  const f = field.format;
  if (typeof f !== "string" || f === "" || f === "default") return undefined;
  if (f === "uri") return "url";
  if (f === "email") return "email";
  if (f === "uuid" || f === "binary") return undefined;
  return f;
}

/**
 * The keys to set on `field` so it is shown as `token` (empty: plainly), in
 * D68's form: a link is `format: "uri"`, an address `format: "email"`, and
 * anything else `display`. Keys set to `undefined` are removed when written.
 */
export function displayPatch(field: Pick<Field, "type" | "format" | "display">, token: string): Partial<Field> {
  const keepFormat = typeof field.format === "string" && STRING_FORMATS.has(field.format) && field.format !== "uri" && field.format !== "email" ? field.format : undefined;
  let want: { format?: string; display?: string };
  if (!token || token === "plain") want = { format: keepFormat };
  else if (field.type === "string" && token === "url") want = { format: "uri" };
  else if (field.type === "string" && token === "email") want = { format: "email" };
  else want = { format: keepFormat, display: token };
  // Only the keys that change: one the field has and loses is set to undefined.
  const patch: Partial<Field> = {};
  if (want.format !== field.format && (want.format !== undefined || field.format !== undefined)) patch.format = want.format;
  if (want.display !== field.display && (want.display !== undefined || field.display !== undefined)) patch.display = want.display;
  return patch;
}

/** A field's choices as written: `categories`, or a file's older `constraints.enum`. */
export function rawChoices(field: Field | undefined): (string | EnumOption)[] | undefined {
  const c = field?.categories;
  if (Array.isArray(c)) return c as (string | EnumOption)[];
  return field?.constraints?.enum;
}

/** Whether a field offers a list of choices. */
export function hasChoices(field: Field | undefined): boolean {
  return Array.isArray(rawChoices(field));
}

/** The keys to set on `field` so its choices are `choices`, in D68's form. */
export function categoriesPatch(field: Field, choices: (string | EnumOption)[]): Partial<Field> {
  const { enum: _was, ...constraints } = field.constraints ?? {};
  return { categories: choices, constraints: Object.keys(constraints).length > 0 ? constraints : undefined };
}

/** `field` in D68's form. Returns `field` itself when it already is. */
export function canonicalField(field: Field): Field {
  let next: Field = field;
  const f = field.format;
  const legacyDisplay = typeof f === "string" && f !== "" && !STRING_FORMATS.has(f);
  if (legacyDisplay) {
    const { format: _f, ...rest } = next;
    const token = f;
    if (token === undefined || token === "plain") next = rest as Field;
    else if (field.type === "string" && token === "url") next = { ...rest, format: "uri" } as Field;
    else next = (typeof field.display === "string" ? rest : { ...rest, display: token }) as Field;
  }
  if (!Array.isArray(next.categories) && Array.isArray(next.constraints?.enum)) {
    const { enum: choices, ...constraints } = next.constraints!;
    const { constraints: _c, ...rest } = next;
    next = { ...rest, categories: choices, ...(Object.keys(constraints).length > 0 ? { constraints } : {}) } as Field;
  }
  return next;
}

/** `schema` with every field in D68's form. Returns `schema` itself when nothing changed. */
export function canonicalSchema(schema: TableSchema): TableSchema {
  let changed = false;
  const fields = schema.fields.map((field) => {
    const next = canonicalField(field);
    if (next !== field) changed = true;
    return next;
  });
  return changed ? { ...schema, fields } : schema;
}
