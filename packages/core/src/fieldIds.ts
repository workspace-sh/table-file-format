// A field's permanent identity (D62): an `id` minted once, never shown,
// never changed. `name` stays the readable key rows and formulas use.

import { strToU8 } from "fflate";
import { FIELD_ID_LENGTH, ID_ALPHABET } from "./id.js";
import type { Field, TableSchema } from "./types.js";

/**
 * The id a field without one takes: derived from its name (FNV-1a, mixed by MurmurHash3's
 * finaliser: 64 bits, as 13 z-base-32 characters). The same on every device and at every save,
 * so a file written without ids gets the same ones wherever it's opened, and
 * saving it twice doesn't change them. Names are unique within a table, so
 * these are too.
 */
export function derivedFieldId(name: string, salt = 0): string {
  let h = 0xcbf29ce484222325n;
  // strToU8, not a global TextEncoder: portable across Hermes.
  for (const b of strToU8(salt === 0 ? name : `${name}\u0000${salt}`)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  // MurmurHash3's finaliser, so names alike ("q1", "q2") don't give ids alike.
  h = BigInt.asUintN(64, (h ^ (h >> 33n)) * 0xff51afd7ed558ccdn);
  h = BigInt.asUintN(64, (h ^ (h >> 33n)) * 0xc4ceb9fe1a85ec53n);
  h ^= h >> 33n;
  let out = "";
  for (let i = 0; i < FIELD_ID_LENGTH; i++) {
    out = ID_ALPHABET[Number(h & 31n)] + out;
    h >>= 5n;
  }
  return out;
}

/**
 * `schema` with an `id` on every field, as a reader and a writer hold it: a
 * field without one (a file from before D62, or another tool's), or with an
 * id an earlier field already has, takes the id its name derives. The `id`
 * leads the field's keys. Returns `schema` itself when nothing changed.
 */
export function withFieldIds(schema: TableSchema): TableSchema {
  const taken = new Set(schema.fields.map((f) => f.id).filter((id): id is string => typeof id === "string" && id !== ""));
  const seen = new Set<string>();
  let changed = false;
  const fields = schema.fields.map((field): Field => {
    if (typeof field.id === "string" && field.id !== "" && !seen.has(field.id)) {
      seen.add(field.id);
      return field;
    }
    changed = true;
    let salt = 0;
    let fresh = derivedFieldId(field.name);
    while (seen.has(fresh) || (taken.has(fresh) && fresh !== field.id)) fresh = derivedFieldId(field.name, ++salt);
    seen.add(fresh);
    taken.add(fresh);
    const { id: _dropped, ...rest } = field;
    return { id: fresh, ...rest };
  });
  return changed ? { ...schema, fields } : schema;
}

/** The field an address's `field=` names (SPEC section 10): by its `id`, else by its `name`. */
export function addressedField(schema: TableSchema, key: string): Field | undefined {
  return schema.fields.find((f) => f.id === key) ?? schema.fields.find((f) => f.name === key);
}
