// The demo's tables, kept in the browser so a reload doesn't lose edits
// (#86, step 1). `ParsedTable` is plain JSON, so it is stored as it is.
//
// Pre-alpha: the stored shape has no version. Anything that doesn't read
// back as tables is discarded, and the demo starts from the fixtures.

import type { ParsedTable } from "@workspace.sh/table-core";

export const STORAGE_KEY = "table-demo:tables";

/** The part of `Storage` this uses, so tests can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's storage, or null where there is none or it refuses access. */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved tables, or null when nothing usable is saved. */
export function loadSaved(store: KeyValueStore | null): Record<string, ParsedTable> | null {
  let raw: string | null;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isTables(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function save(store: KeyValueStore | null, tables: Record<string, ParsedTable>): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(tables));
  } catch {
    // Full or refused: the edit still stands on screen; it just won't survive a reload.
  }
}

export function clearSaved(store: KeyValueStore | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the next load falls back to the fixtures anyway.
  }
}

/**
 * Enough of a table for the demo to render: a schema with fields, rows and
 * at least one view. What each holds is left to the demo's own validation,
 * which already reports a bad row rather than refusing the table.
 */
function isTables(value: unknown): value is Record<string, ParsedTable> {
  if (!isObject(value)) return false;
  const tables = Object.values(value);
  if (tables.length === 0) return false;
  return tables.every(
    (t) =>
      isObject(t) &&
      isObject(t.schema) &&
      Array.isArray(t.schema.fields) &&
      Array.isArray(t.rows) &&
      t.rows.every(isObject) &&
      Array.isArray(t.views) &&
      t.views.length > 0 &&
      t.views.every((v) => isObject(v) && typeof v.id === "string") &&
      isObject(t.meta),
  );
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
