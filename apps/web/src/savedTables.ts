// The demo's bundles, kept in the browser so a reload doesn't lose edits
// (#86, step 1): every table under its `bundle/table` key, and each
// bundle's manifest (D37). Both are plain JSON, so they're stored as they are.
//
// Pre-alpha: the stored shape has no version. Anything that doesn't read
// back as bundles (including what earlier demos saved) is discarded, and
// the demo starts from the fixtures.

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

export interface Saved {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
}

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

/** The saved bundles, or null when nothing usable is saved. */
export function loadSaved(store: KeyValueStore | null): Saved | null {
  let raw: string | null;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSaved(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function save(store: KeyValueStore | null, saved: Saved): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(saved));
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
 * What was saved, plus any fixture table or bundle added to the demo
 * since: a table added to a fixture (the household budget's ledger, say)
 * appears in a browser that saved its edits before it existed. Saved
 * tables and edits are kept as they are; the demo can't delete a table,
 * so a fixture table missing from what's saved is always a new one.
 */
export function withNewFixtures(saved: Saved, fixtures: Saved): Saved {
  const tables = { ...saved.tables };
  const bundles = { ...saved.bundles };
  let changed = false;
  for (const [key, table] of Object.entries(fixtures.tables)) {
    if (key in tables) continue;
    const bundle = key.slice(0, key.indexOf("/"));
    const name = key.slice(bundle.length + 1);
    tables[key] = table;
    changed = true;
    const manifest = bundles[bundle];
    if (!manifest) {
      bundles[bundle] = fixtures.bundles[bundle]!;
    } else if (Array.isArray(manifest.tables) && !manifest.tables.includes(name)) {
      // Where the fixture puts it, so the sidebar's order matches the file's.
      const order = fixtures.bundles[bundle]?.tables ?? [];
      const at = order.indexOf(name);
      const next = [...manifest.tables];
      const before = order.slice(at + 1).map((t) => next.indexOf(t)).filter((i) => i !== -1);
      next.splice(before.length ? Math.min(...before) : next.length, 0, name);
      bundles[bundle] = { ...manifest, tables: next };
    }
  }
  return changed ? { tables, bundles } : saved;
}

/** Bundles, and tables that each belong to one of them. */
function isSaved(value: unknown): value is Saved {
  if (!isObject(value) || !isObject(value.bundles) || !isTables(value.tables)) return false;
  const bundles = value.bundles as Record<string, unknown>;
  return Object.keys(value.tables).every((key) => {
    const slash = key.indexOf("/");
    return slash > 0 && isObject(bundles[key.slice(0, slash)]);
  });
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
