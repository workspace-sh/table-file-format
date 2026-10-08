// Back and forward between views, as plain data: each entry is a view's
// address (formatAddress), followed with addressTarget, and the place in it
// as it was left (the cell selected, the page open, the search, how far
// down), so going back returns to where you were, not to the view's top.
// Recording the view on screen is `visited`; going back or forward skips
// entries that no longer lead anywhere (a deleted table or view), so they
// never land on nothing. Each app keeps one and binds its own keys (⌘[ ⌘]
// on the Mac, Alt+Left/Right on GNOME, a Back button on iOS, the browser's
// own on the web).

import { formatAddress, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";

import { addressTarget, bundleOf, tableNameOf } from "./bundles.ts";

/** Where you were in a view: restored on going back or forward to it. */
export interface Place {
  /** The cell selected, by row and field. */
  rowId?: string;
  field?: string;
  /** The row whose page was open. */
  page?: string;
  search?: string;
  /**
   * How far down: the row at the top and how far into it, which survives
   * rows drawn a window at a time, where a pixel offset alone would not.
   */
  top?: { rowId: string; offset: number };
}

export interface HistoryEntry {
  address: string;
  /** As it was left; absent until it has been. */
  place?: Place;
}

export interface History {
  back: HistoryEntry[];
  /** The view on screen, once one has been recorded. */
  at: HistoryEntry | null;
  forward: HistoryEntry[];
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

/** The entry being left, with its place as it's left. */
function left(at: HistoryEntry, place: Place | undefined): HistoryEntry {
  return place && Object.keys(place).length > 0 ? { address: at.address, place } : { address: at.address };
}

/**
 * The view now on screen: nothing when it's where history already is; else
 * the one left is pushed, with `leaving` (its place as it was left), and
 * forward is cleared.
 */
export function visited(h: History, address: string, leaving?: Place): History {
  if (address === h.at?.address) return h;
  const back = h.at === null ? h.back : [...h.back, left(h.at, leaving)].slice(-HISTORY_LIMIT);
  return { back, at: { address }, forward: [] };
}

type Live = (address: string) => boolean;
type Moved = { history: History; address: string; place?: Place };

/** Back one live entry, dropping stale ones on the way; null when there's none. `leaving`: the place on screen now. */
export function goBack(h: History, live: Live = () => true, leaving?: Place): Moved | null {
  for (let i = h.back.length - 1; i >= 0; i--) {
    const entry = h.back[i]!;
    if (entry.address === h.at?.address || !live(entry.address)) continue;
    const forward = h.at === null ? h.forward : [left(h.at, leaving), ...h.forward].slice(0, HISTORY_LIMIT);
    return { history: { back: h.back.slice(0, i), at: { address: entry.address }, forward }, address: entry.address, place: entry.place };
  }
  return null;
}

/** Forward one live entry, dropping stale ones on the way; null when there's none. `leaving`: the place on screen now. */
export function goForward(h: History, live: Live = () => true, leaving?: Place): Moved | null {
  for (let i = 0; i < h.forward.length; i++) {
    const entry = h.forward[i]!;
    if (entry.address === h.at?.address || !live(entry.address)) continue;
    const back = h.at === null ? h.back : [...h.back, left(h.at, leaving)].slice(-HISTORY_LIMIT);
    return { history: { back, at: { address: entry.address }, forward: h.forward.slice(i + 1) }, address: entry.address, place: entry.place };
  }
  return null;
}

export function canGoBack(h: History, live?: Live): boolean {
  return goBack(h, live) !== null;
}

export function canGoForward(h: History, live?: Live): boolean {
  return goForward(h, live) !== null;
}
