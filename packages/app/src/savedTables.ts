// The demo's bundles, kept in the browser so a reload doesn't lose edits
// (#86, step 1): every table under its `bundle/table` key, and each
// bundle's manifest (D37). Both are plain JSON, so they're stored as they are.
// An example is kept only once it differs from the app's own copy
// (savedFrom), so an app follows the examples as they change until one is
// edited (#592). It's kept whole, every table of the file: its tables link to
// each other by row id, and a table kept from one version of an example beside
// one taken from the next would break every link between them.
//
// Pre-alpha: the stored shape has no version. Anything that doesn't read
// back as bundles (including what earlier demos saved) is discarded, and
// the demo starts from the fixtures.

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

export interface Saved {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  /** Bundles closed here (closing.ts): an example among them isn't added back. */
  closed?: string[];
  /**
   * Set when an example edited here is kept whole (savedFrom). What demos
   * saved before kept an edited example's tables one by one, so an
   * example's tables there are dropped on load and the example comes back
   * as it is now (withNewFixtures).
   */
  whole?: true;
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

/**
 * What an app keeps of `tables` and `bundles`: every file that isn't an
 * example, and every example where anything (a table, or its manifest)
 * differs from `fixtures`, whole. An example left as it is isn't kept, so the
 * next launch shows the example as it is then; one edited is kept as edited,
 * whatever the example becomes. An edit undone back to the example is the
 * example again.
 */
export function savedFrom(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  closed: string[],
  fixtures: Saved,
): Saved {
  const edited = new Set<string>();
  for (const [key, t] of Object.entries(tables)) if (!same(t, fixtures.tables[key])) edited.add(bundleOfKey(key));
  for (const [key, b] of Object.entries(bundles)) if (!same(b, fixtures.bundles[key])) edited.add(key);
  return {
    tables: Object.fromEntries(Object.entries(tables).filter(([key]) => edited.has(bundleOfKey(key)))),
    bundles: Object.fromEntries(Object.entries(bundles).filter(([key]) => edited.has(key))),
    closed,
    whole: true,
  };
}

function bundleOfKey(key: string): string {
  return key.slice(0, key.indexOf("/"));
}

// The examples' JSON, made once each: they're compared on every write.
const json = new WeakMap<object, string>();
function jsonOf(value: object): string {
  let s = json.get(value);
  if (s === undefined) json.set(value, (s = JSON.stringify(value)));
  return s;
}

/** Whether `value` is the example `fixture`: the same object, as it is until edited, or the same JSON. */
function same(value: object, fixture: object | undefined): boolean {
  if (fixture === undefined) return false;
  return value === fixture || JSON.stringify(value) === jsonOf(fixture);
}

export function clearSaved(store: KeyValueStore | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the next load falls back to the fixtures anyway.
  }
}

/**
 * What was saved, with the examples it doesn't hold: an example left as it
 * is isn't saved (savedFrom), so it comes from `fixtures` as it is now, and a
 * table added to an example (the household budget's ledger, say) appears
 * beside saved edits from before it existed. A saved table whose manifest
 * wasn't saved takes the example's; one with neither is dropped. Saved tables
 * and edits are kept as they are. A file closed here (`saved.closed`) stays
 * closed.
 */
export function withNewFixtures(saved: Saved, fixtures: Saved): Saved {
  const tables = { ...saved.tables };
  const bundles = { ...saved.bundles };
  const closed = new Set(saved.closed ?? []);
  let changed = false;
  if (!saved.whole) {
    // Saved table by table: an example's tables may be from another version of it than the rest.
    for (const key of Object.keys(tables)) {
      if (fixtures.bundles[bundleOfKey(key)]) {
        delete tables[key];
        changed = true;
      }
    }
    for (const key of Object.keys(bundles)) {
      if (fixtures.bundles[key]) {
        delete bundles[key];
        changed = true;
      }
    }
  }
  for (const key of Object.keys(tables)) {
    const bundle = key.slice(0, key.indexOf("/"));
    if (bundles[bundle]) continue;
    const manifest = fixtures.bundles[bundle];
    if (manifest) bundles[bundle] = manifest;
    else delete tables[key];
    changed = true;
  }
  for (const [key, table] of Object.entries(fixtures.tables)) {
    if (key in tables) continue;
    const bundle = key.slice(0, key.indexOf("/"));
    if (closed.has(bundle)) continue;
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
  return changed ? { tables, bundles, ...(saved.closed ? { closed: saved.closed } : {}), whole: true } : saved;
}

/**
 * Bundles, and tables under `bundle/table` keys. A table's manifest may be
 * missing, as an example's isn't saved while it's left as it is
 * (withNewFixtures takes it from the examples).
 */
function isSaved(value: unknown): value is Saved {
  if (!isObject(value) || !isObject(value.bundles) || !isTables(value.tables)) return false;
  if (value.closed !== undefined && !(Array.isArray(value.closed) && value.closed.every((b) => typeof b === "string"))) return false;
  if (value.whole !== undefined && value.whole !== true) return false;
  if (!Object.values(value.bundles).every(isObject)) return false;
  return Object.keys(value.tables).every((key) => key.indexOf("/") > 0);
}

/**
 * Enough of a table for the demo to render: a schema with fields, rows and
 * at least one view. What each holds is left to the demo's own validation,
 * which already reports a bad row rather than refusing the table. None at
 * all is an app whose examples are all as they were.
 */
function isTables(value: unknown): value is Record<string, ParsedTable> {
  if (!isObject(value)) return false;
  return Object.values(value).every(
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
