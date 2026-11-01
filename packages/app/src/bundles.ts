// The demo holds every table in one map keyed `bundle/table` (a `.table`
// holds one or more tables, D37), with each bundle's manifest beside it.
// These turn that into what core deals in: a bundle, its tables by name,
// and an address resolved within the right bundle.

import { addressedView, parseAddress, tableOrder } from "@workspace.sh/table-core";
import type { Address, BundleMeta, ParsedBundle, ParsedTable } from "@workspace.sh/table-core";

/** `crm/deals` → `crm` */
export function bundleOf(key: string): string {
  return key.slice(0, key.indexOf("/"));
}

/** `crm/deals` → `deals` */
export function tableNameOf(key: string): string {
  return key.slice(key.indexOf("/") + 1);
}

/** One bundle's tables by their names, as relations and formulas name them. */
export function bundleTables(tables: Record<string, ParsedTable>, bundle: string): Record<string, ParsedTable> {
  const prefix = `${bundle}/`;
  return Object.fromEntries(
    Object.entries(tables)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, t]) => [key.slice(prefix.length), t]),
  );
}

/**
 * A table that a relation names and its bundle doesn't hold, in another
 * `.table` (SPEC section 2, "relation"): the file of that name beside the
 * bundle, held under its own name as a bundle key. Its table of that name,
 * or its only table. Undefined when no such file is held.
 */
export function otherFileTable(tables: Record<string, ParsedTable>, name: string): string | undefined {
  if (name.length === 0 || name.includes("/")) return undefined;
  if (tables[`${name}/${name}`]) return `${name}/${name}`;
  const prefix = `${name}/`;
  const keys = Object.keys(tables).filter((key) => key.startsWith(prefix));
  return keys.length === 1 ? keys[0] : undefined;
}

/**
 * The tables a bundle's relations, lookups and rollups reach, by the names
 * they use: the bundle's own, and, for a name it doesn't hold, the table of
 * that name in the `.table` beside it (otherFileTable), when that is held.
 */
export function relatedTables(tables: Record<string, ParsedTable>, bundle: string): Record<string, ParsedTable> {
  const own = bundleTables(tables, bundle);
  const reached: Record<string, ParsedTable> = { ...own };
  for (const table of Object.values(own)) {
    for (const field of table.schema.fields) {
      const name = field.relation?.table;
      if (!name || reached[name]) continue;
      const key = otherFileTable(tables, name);
      if (key) reached[name] = tables[key]!;
    }
  }
  return reached;
}

/** The `.table` files a bundle's relations name and it doesn't hold, by name (SPEC section 2): to be read beside it. */
export function otherFilesNamed(tables: Record<string, ParsedTable>, bundle: string): string[] {
  const own = bundleTables(tables, bundle);
  const names = new Set<string>();
  for (const table of Object.values(own)) {
    for (const field of table.schema.fields) {
      const name = field.relation?.table;
      if (name && !own[name] && !name.includes("/")) names.add(name);
    }
  }
  return [...names].sort();
}

/** One bundle as core's `ParsedBundle`, ready to download. */
export function toBundle(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  bundle: string,
): ParsedBundle {
  return { path: `${bundle}.table`, meta: bundles[bundle] ?? {}, tables: bundleTables(tables, bundle) };
}

/** A bundle's tables as demo entries: `bundle/table` keys, in display order. */
export function fromBundle(bundle: string, b: ParsedBundle): Record<string, ParsedTable> {
  return Object.fromEntries(tableOrder(b).map((name) => [`${bundle}/${name}`, b.tables[name]!]));
}

/** Each bundle's table keys, in the order its manifest gives. */
export function tableKeysIn(
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  bundle: string,
): string[] {
  return tableOrder({ meta: bundles[bundle], tables: bundleTables(tables, bundle) }).map((name) => `${bundle}/${name}`);
}

/**
 * The demo key an address points at, or null when it isn't here.
 * - `crm.table#table=deals` is a bundle and a table in it (SPEC section 10).
 *   Without `table=`, it's the bundle's only table.
 * - `crm/deals` is a demo key already.
 * - A bare name, `deals`, is what a relation writes: it resolves within
 *   the bundle being looked at first (D37).
 */
export function keyForAddress(
  addr: Address,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  fromBundle: string,
): string | null {
  const path = addr.tablePath;
  if (path.endsWith(".table")) {
    const bundle = path.slice(0, -".table".length);
    if (!(bundle in bundles)) return null;
    const keys = tableKeysIn(tables, bundles, bundle);
    if (addr.tableName) return keys.includes(`${bundle}/${addr.tableName}`) ? `${bundle}/${addr.tableName}` : null;
    return keys.length === 1 ? keys[0]! : null;
  }
  if (tables[path]) return path;
  const within = `${fromBundle}/${path}`;
  if (tables[within]) return within;
  // A name the bundle doesn't hold: the .table of that name beside it (SPEC section 2).
  return otherFileTable(tables, path) ?? null;
}

/** Where an address leads: a held table, the view it names, and the row whose page opens. */
export interface AddressTarget {
  key: string;
  viewId?: string;
  openBody: string | null;
}

/**
 * Where following an address leads (a relation's link, or the page's own
 * address): the table's key, the view it names if any, and the row whose
 * page opens: the named row's, when it has one, else none, so a
 * page left open from elsewhere closes. Null when the address doesn't
 * parse or its table isn't here.
 */
export function addressTarget(
  address: Address | string,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  fromBundle: string,
): AddressTarget | null {
  const addr = typeof address === "string" ? parseAddress(address) : address;
  if (!addr) return null;
  const key = keyForAddress(addr, tables, bundles, fromBundle);
  if (!key) return null;
  const openBody = addr.rowId && tables[key]?.bodies?.[addr.rowId] !== undefined ? addr.rowId : null;
  // By id or by name; one no view has stays as written, so a stale address reads as one.
  const viewId = addr.viewId ? (addressedView(tables[key]?.views ?? [], addr.viewId)?.id ?? addr.viewId) : undefined;
  return { key, ...(viewId ? { viewId } : {}), openBody };
}

/** What following an address sets in an app, as addressTarget found it. */
export interface AppliedTarget {
  /** The table to show. */
  activeKey: string;
  /** Each table's view, with the target's view for its table when it names one. */
  viewIds: Record<string, string>;
  /** The row whose page opens, or null to close any open one. */
  openBody: string | null;
  /** The main pane shows the view, not a file. */
  mode: "tables";
}

/**
 * Following an address (a relation's link, the page's address, Back or
 * Forward): the one rule each app applies, so all three land alike.
 */
export function applyTarget(
  target: AddressTarget,
  current: { viewIds: Record<string, string> },
): AppliedTarget {
  return {
    activeKey: target.key,
    viewIds: target.viewId ? { ...current.viewIds, [target.key]: target.viewId } : current.viewIds,
    openBody: target.openBody,
    mode: "tables",
  };
}
