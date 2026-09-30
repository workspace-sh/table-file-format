// The demo holds every table in one map keyed `bundle/table` (a `.table`
// holds one or more tables, D37), with each bundle's manifest beside it.
// These turn that into what core deals in: a bundle, its tables by name,
// and an address resolved within the right bundle.

import { parseAddress, tableOrder } from "@workspace.sh/table-core";
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
  return tables[within] ? within : null;
}

/** Where an address leads: a held table, the view it names, and the row whose document opens. */
export interface AddressTarget {
  key: string;
  viewId?: string;
  openBody: string | null;
}

/**
 * Where following an address leads (a relation's link, or the page's own
 * address): the table's key, the view it names if any, and the row whose
 * document opens: the named row's, when it has one, else none, so a
 * document left open from elsewhere closes. Null when the address doesn't
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
  return { key, ...(addr.viewId ? { viewId: addr.viewId } : {}), openBody };
}

/** What following an address sets in an app, as addressTarget found it. */
export interface AppliedTarget {
  /** The table to show. */
  activeKey: string;
  /** Each table's view, with the target's view for its table when it names one. */
  viewIds: Record<string, string>;
  /** The row whose document opens, or null to close any open one. */
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
