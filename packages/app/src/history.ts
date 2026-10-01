// Back and forward between views, as plain data: each entry is a view's
// address (formatAddress), followed with addressTarget. Recording the view
// on screen is `visited`; going back or forward skips entries that no
// longer lead anywhere (a deleted table or view), so they never land on
// nothing. Each app keeps one and binds its own keys (⌘[ ⌘] on the Mac,
// Alt+Left/Right on GNOME).

import { formatAddress, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";

import { addressTarget, bundleOf, tableNameOf } from "./bundles.ts";

export interface History {
  back: string[];
  /** The address on screen, once one has been recorded. */
  at: string | null;
  forward: string[];
}

/** How many entries each way are kept. */
export const HISTORY_LIMIT = 100;

export const NO_HISTORY: History = { back: [], at: null, forward: [] };

/**
 * The address of a view of the table under `key`; with `rowId`, of that
 * row's page open in it (what Copy Link gives, as the web's address
 * does). History records views only, so it leaves the row out.
 */
export function viewAddress(key: string, viewId: string, rowId?: string): string {
  return formatAddress({ tablePath: `${bundleOf(key)}.table`, tableName: tableNameOf(key), viewId, ...(rowId ? { rowId } : {}) });
}

/** Whether an address still leads somewhere: its table is held, and the view it names, if any, is in it. */
export function addressLive(
  address: string,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
): boolean {
  const target = addressTarget(address, tables, bundles, "");
  if (!target) return false;
  return !target.viewId || (tables[target.key]?.views.some((v) => v.id === target.viewId) ?? false);
}

/** The view now on screen: nothing when it's where history already is; else it's pushed and forward is cleared. */
export function visited(h: History, address: string): History {
  if (address === h.at) return h;
  const back = h.at === null ? h.back : [...h.back, h.at].slice(-HISTORY_LIMIT);
  return { back, at: address, forward: [] };
}

type Live = (address: string) => boolean;

/** Back one live entry, dropping stale ones on the way; null when there's none. */
export function goBack(h: History, live: Live = () => true): { history: History; address: string } | null {
  for (let i = h.back.length - 1; i >= 0; i--) {
    const address = h.back[i]!;
    if (address === h.at || !live(address)) continue;
    const forward = h.at === null ? h.forward : [h.at, ...h.forward].slice(0, HISTORY_LIMIT);
    return { history: { back: h.back.slice(0, i), at: address, forward }, address };
  }
  return null;
}

/** Forward one live entry, dropping stale ones on the way; null when there's none. */
export function goForward(h: History, live: Live = () => true): { history: History; address: string } | null {
  for (let i = 0; i < h.forward.length; i++) {
    const address = h.forward[i]!;
    if (address === h.at || !live(address)) continue;
    const back = h.at === null ? h.back : [...h.back, h.at].slice(-HISTORY_LIMIT);
    return { history: { back, at: address, forward: h.forward.slice(i + 1) }, address };
  }
  return null;
}

export function canGoBack(h: History, live?: Live): boolean {
  return goBack(h, live) !== null;
}

export function canGoForward(h: History, live?: Live): boolean {
  return goForward(h, live) !== null;
}
