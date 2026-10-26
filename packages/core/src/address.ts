/**
 * Address parsing / formatting / resolution for the `.table/` fragment
 * grammar (see docs/SPEC.md, "Addressing").
 *
 *   <path>[#<key>=<value>[&<key>=<value>]*]
 *
 * Reserved keys: `table`, `row`, `view`, `field`. Unknown keys round-trip via
 * `extra` so apps can layer their own conventions (e.g. `query=`,
 * `highlight=`) without losing them on parse/format.
 *
 * Resolution is callback-driven — the format library doesn't know how
 * apps locate sibling `.table/` directories (filesystem scan, in-memory
 * map, HTTP fetch). Callers supply a `TableLookup` function.
 */

import type { ParsedTable, Row } from "./types.js";

export interface Address {
  /**
   * The path component — everything before the `#`. App-resolved.
   * Relative paths recommended in stored relations / markdown links;
   * absolute paths fine for in-app deep links.
   */
  tablePath: string;
  /**
   * `table=<name>`: the table in the bundle (SPEC section 1). May be
   * absent when the bundle holds exactly one table.
   */
  tableName?: string;
  /** `row=<id>` — system id of the target row. */
  rowId?: string;
  /**
   * `view=<id or name>`: the view to show. As written: `addressedView`
   * finds it, by id or by name.
   */
  viewId?: string;
  /** `field=<name>` — reserved for cell-level addressing. */
  fieldName?: string;
  /**
   * Any keys not in the reserved set above. Preserved through
   * parse → format so app-defined conventions (`query=`, `highlight=`,
   * etc.) survive round-tripping.
   */
  extra?: Record<string, string>;
}

/**
 * A key or value as written: percent-decoded (SPEC section 10). One that
 * isn't valid percent-encoding, as an address written before values were
 * encoded may be, is read as it stands.
 */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Parse an address string. Returns `null` when the input is empty or
 * has no path component (the path is the only required part).
 *
 * Tolerant of empty fragments, missing values, and unknown keys —
 * matches the spec requirement that readers MUST tolerate unknown
 * keys silently.
 */
/**
 * The view an address's `view=` names (SPEC section 10): the view with that
 * `id`, else the first whose `name` matches it, ignoring case ("pipeline"
 * finds "Pipeline"). Ids are opaque (D23); a name is what a reader types.
 */
export function addressedView<V extends { id: string; name: string }>(views: readonly V[], key: string): V | undefined {
  const lower = key.toLowerCase();
  return views.find((v) => v.id === key) ?? views.find((v) => v.name.toLowerCase() === lower);
}

export function parseAddress(input: string): Address | null {
  if (!input) return null;
  const hashIdx = input.indexOf("#");
  const tablePath = hashIdx === -1 ? input : input.slice(0, hashIdx);
  if (!tablePath) return null;

  const out: Address = { tablePath };
  if (hashIdx === -1) return out;

  const fragment = input.slice(hashIdx + 1);
  if (!fragment) return out;

  const extra: Record<string, string> = {};
  for (const pair of fragment.split("&")) {
    if (!pair) continue;
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decoded(pair.slice(0, eqIdx));
    const value = decoded(pair.slice(eqIdx + 1));
    if (!key || !value) continue;
    switch (key) {
      case "table":
        out.tableName = value;
        break;
      case "row":
        out.rowId = value;
        break;
      case "view":
        out.viewId = value;
        break;
      case "field":
        out.fieldName = value;
        break;
      default:
        extra[key] = value;
    }
  }
  if (Object.keys(extra).length > 0) out.extra = extra;
  return out;
}

/**
 * Format an address back into a string. Round-trips with `parseAddress`
 * for all reserved keys + `extra`. Output omits the `#` when no
 * fragment keys are set, so a bare table-path round-trips cleanly.
 */
export function formatAddress(addr: Address): string {
  const parts: string[] = [];
  const pair = (key: string, value: string) => parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  if (addr.tableName) pair("table", addr.tableName);
  if (addr.rowId) pair("row", addr.rowId);
  if (addr.viewId) pair("view", addr.viewId);
  if (addr.fieldName) pair("field", addr.fieldName);
  if (addr.extra) {
    for (const [k, v] of Object.entries(addr.extra)) pair(k, v);
  }
  return parts.length === 0 ? addr.tablePath : `${addr.tablePath}#${parts.join("&")}`;
}

/**
 * Look up a table by its bundle's path and, when the address names one,
 * the table's name in that bundle (`table=`; absent for a one-table
 * bundle). Apps decide how: scan the workspace filesystem, look in an
 * in-memory map, fetch over the network. May be sync or async; the
 * resolver awaits it either way.
 *
 * Returning `null` signals "not found" (the address is dangling).
 */
export type TableLookup = (
  path: string,
  tableName?: string,
) => ParsedTable | null | Promise<ParsedTable | null>;

/**
 * Resolve an address to a row. Returns:
 * - the matched `Row` when the lookup finds the table AND the table
 *   contains a row with the matching system `id`
 * - `null` when:
 *   - the address has no `rowId` (it's just a table / view address)
 *   - the lookup returns `null` (table not found)
 *   - the table is loaded but no row matches the id (dangling)
 *
 * Apps SHOULD surface the dangling case visibly rather than silently
 * rendering nothing.
 */
export async function resolveRow(
  address: string | Address,
  lookup: TableLookup,
): Promise<Row | null> {
  const addr = typeof address === "string" ? parseAddress(address) : address;
  if (!addr || !addr.rowId) return null;
  const table = await lookup(addr.tablePath, addr.tableName);
  if (!table) return null;
  return table.rows.find((r) => r.id === addr.rowId) ?? null;
}
