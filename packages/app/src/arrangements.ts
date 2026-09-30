// How this viewer has sorted, filtered or grouped each view for
// themselves (D4, D41). Personal: kept in this browser, never in a table,
// and it changes only their screen, never a Sheet view's grid or a
// formula's answer. "Save for everyone" writes it into the view; "Reset"
// drops it.

import type { View, ViewFilter, ViewGroup, ViewSort } from "@workspace.sh/table-core";
import type { KeyValueStore } from "./savedTables.ts";

export const ARRANGEMENTS_KEY = "table-demo:arrangements";

/**
 * One view, arranged for this viewer. A key that's present replaces the
 * view's saved one; `null` means "none, for me", over a saved one.
 */
export interface Arrangement {
  filter?: ViewFilter[] | null;
  sort?: ViewSort[] | null;
  group?: ViewGroup | null;
}

/** By table (its path, as the app names it), then view id. */
export type Arrangements = Record<string, Record<string, Arrangement>>;

const KEYS = ["filter", "sort", "group"] as const;

const isFilter = (f: unknown): f is ViewFilter =>
  typeof f === "object" && f !== null && typeof (f as ViewFilter).field === "string" && typeof (f as ViewFilter).operator === "string";
const isSort = (s: unknown): s is ViewSort =>
  typeof s === "object" && s !== null && typeof (s as ViewSort).field === "string" && ["asc", "desc"].includes((s as ViewSort).direction);
const isGroup = (g: unknown): g is ViewGroup => typeof g === "object" && g !== null && typeof (g as ViewGroup).field === "string";

function readArrangement(raw: unknown): Arrangement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { filter, sort, group } = raw as Record<string, unknown>;
  const out: Arrangement = {};
  if (filter === null || (Array.isArray(filter) && filter.every(isFilter))) out.filter = filter as ViewFilter[] | null;
  if (sort === null || (Array.isArray(sort) && sort.every(isSort))) out.sort = sort as ViewSort[] | null;
  if (group === null || isGroup(group)) out.group = group as ViewGroup | null;
  return Object.keys(out).length > 0 ? out : null;
}

export function loadArrangements(store: KeyValueStore | null): Arrangements {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(ARRANGEMENTS_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Arrangements = {};
    for (const [table, views] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof views !== "object" || views === null) continue;
      for (const [viewId, raw] of Object.entries(views as Record<string, unknown>)) {
        const a = readArrangement(raw);
        if (a) (out[table] ??= {})[viewId] = a;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveArrangements(store: KeyValueStore | null, all: Arrangements): void {
  try {
    store?.setItem(ARRANGEMENTS_KEY, JSON.stringify(all));
  } catch {
    // Not kept past a reload; still applied now.
  }
}

/** Whether this viewer has arranged a view differently from how it's saved. */
export function isArranged(a: Arrangement | undefined): boolean {
  return !!a && KEYS.some((k) => k in a);
}

/**
 * The view as this viewer sees it: their arrangement over the saved one.
 * Their own sort replaces a dragged order too, as a saved sort would.
 */
export function arrangedView(view: View, a: Arrangement | undefined): View {
  if (!isArranged(a)) return view;
  const out: View = { ...view };
  for (const k of KEYS) {
    if (!(k in a!)) continue;
    const v = a![k];
    if (v === null) delete out[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  if ("sort" in a!) delete out.order;
  return out;
}

/**
 * A change to a view's filters, sorts or grouping, as this viewer's own.
 * `undefined` in the patch (the setting cleared) becomes `null`: none,
 * for them, whatever is saved.
 */
export function arrange(all: Arrangements, table: string, viewId: string, patch: Partial<View>): Arrangements {
  const next: Arrangement = { ...(all[table]?.[viewId] ?? {}) };
  for (const k of KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    (next as Record<string, unknown>)[k] = v === undefined ? null : v;
  }
  return { ...all, [table]: { ...(all[table] ?? {}), [viewId]: next } };
}

/** What "Save for everyone" writes into the view: this viewer's arrangement, and no dragged order if it sorts. */
export function savedPatch(a: Arrangement | undefined): Partial<View> {
  const patch: Partial<View> = {};
  if (!a) return patch;
  for (const k of KEYS) {
    if (!(k in a)) continue;
    const v = a[k];
    (patch as Record<string, unknown>)[k] = v === null || (Array.isArray(v) && v.length === 0) ? undefined : v;
  }
  if ("sort" in a) patch.order = undefined;
  return patch;
}

/**
 * "Save for everyone": the patch that writes this viewer's arrangement of
 * a view into the saved view, and the arrangements without it (it's the
 * saved view now).
 */
export function savingForEveryone(
  all: Arrangements,
  table: string,
  viewId: string,
): { patch: Partial<View>; arrangements: Arrangements } {
  return { patch: savedPatch(all[table]?.[viewId]), arrangements: reset(all, table, viewId) };
}

/** Drop this viewer's arrangement of a view: "Reset", or after saving it for everyone. */
export function reset(all: Arrangements, table: string, viewId: string): Arrangements {
  if (!all[table]?.[viewId]) return all;
  const views = { ...all[table] };
  delete views[viewId];
  const out = { ...all, [table]: views };
  if (Object.keys(views).length === 0) delete out[table];
  return out;
}

/** Only the arrangements of views that still exist. */
export function forViews(all: Arrangements, tables: Record<string, { views: View[] }>): Arrangements {
  const out: Arrangements = {};
  for (const [table, views] of Object.entries(all)) {
    const ids = new Set(tables[table]?.views.map((v) => v.id) ?? []);
    for (const [viewId, a] of Object.entries(views)) if (ids.has(viewId)) (out[table] ??= {})[viewId] = a;
  }
  return out;
}
