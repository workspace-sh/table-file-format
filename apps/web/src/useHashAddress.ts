/**
 * Sync app navigation state with `location.hash` using the
 * row-address grammar (`<path>#<key>=<value>&...`). Result:
 *
 *   https://demo/#projects.table#table=tasks&row=t1&view=v5
 *   ↓ parseAddress(location.hash.slice(1))
 *   { tablePath: "projects.table", tableName: "tasks", rowId: "t1", viewId: "v5" }
 *
 * The inner `#` survives because browsers preserve the full fragment
 * after the FIRST `#` — assignments through history.replaceState keep
 * it literal. We still defensively `decodeURIComponent` on read since
 * some browser code paths do percent-encode the inner separator.
 *
 * Loop avoidance: we track the last URL we wrote ourselves so the
 * subsequent `hashchange` event (or no-op replaceState) doesn't bounce
 * back into setState. Only externally-triggered hash changes (typing in
 * the address bar) trip the listener.
 *
 * The browser's history follows the app's (table-app's history): showing
 * another view or table adds an entry, each marked with how deep it is,
 * and the browser's Back and Forward drive the app's back and forward, so
 * they return to the view as it was left (the cell selected, the page
 * open, the search, how far down). A page opened or closed only changes
 * the entry it's in.
 */

import { useEffect, useRef } from "react";
import { formatAddress, parseAddress, type Address } from "@workspace.sh/table-core";

export interface HashAddressState {
  tablePath: string;
  /** The table in the bundle (`table=`, SPEC section 10). */
  tableName?: string;
  viewId?: string;
  rowId?: string;
}

export interface UseHashAddressOpts {
  state: HashAddressState;
  /** Called when an external hash change (an edited address) needs applying. */
  onExternalChange: (addr: Address) => void;
  /** The browser's Back and Forward: the app's own, which put back the place it was left at. */
  onBack: () => void;
  onForward: () => void;
}

/**
 * The address in the page's hash, if any. Read when the app starts, so
 * the first render is already where the address says: an effect that
 * reads it later would lose to the one that writes the hash.
 */
export function addressInHash(): Address | null {
  return readHash();
}

function readHash(): Address | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  // Defensive: some assignments percent-encode the inner `#`.
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  return parseAddress(decoded);
}

function buildHash(state: HashAddressState): string {
  return formatAddress({
    tablePath: state.tablePath,
    tableName: state.tableName,
    rowId: state.rowId,
    viewId: state.viewId,
  });
}

/** How deep a browser entry is, as this app marked it. */
function depthOf(historyState: unknown): number | null {
  const d = (historyState as { tableDepth?: unknown } | null)?.tableDepth;
  return typeof d === "number" ? d : null;
}

export function useHashAddress({ state, onExternalChange, onBack, onForward }: UseHashAddressOpts) {
  // Track the last hash WE wrote so we can ignore the hashchange echo.
  const lastWritten = useRef<string | null>(null);
  // How deep the entry on screen is, and whether the next view change is
  // the browser's own Back or Forward (which already moved its history).
  const depth = useRef(0);
  const fromBrowser = useRef(false);
  const go = useRef({ onBack, onForward });
  go.current = { onBack, onForward };

  // The browser's Back and Forward, between entries this app added.
  useEffect(() => {
    if (depthOf(window.history.state) === null) {
      window.history.replaceState({ tableDepth: 0 }, "", window.location.href);
    } else depth.current = depthOf(window.history.state)!;
    const handler = (e: PopStateEvent) => {
      const to = depthOf(e.state);
      if (to === null || to === depth.current) return;
      // The hashchange that follows is this move, not an edited address.
      lastWritten.current = window.location.hash.slice(1);
      fromBrowser.current = true;
      const steps = to - depth.current;
      depth.current = to;
      for (let i = 0; i < Math.abs(steps); i++) (steps < 0 ? go.current.onBack : go.current.onForward)();
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // The hash on load isn't applied here: the app starts where addressInHash
  // says, so its first render is already there.

  // Listen for external hash changes (back/forward, address bar edits).
  useEffect(() => {
    const handler = () => {
      const raw = window.location.hash.slice(1);
      if (raw === lastWritten.current) return;
      const addr = readHash();
      if (addr) onExternalChange(addr);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [onExternalChange]);

  // Write current state to the hash on every change: another view or
  // table adds a browser entry; a page opened or closed changes this one.
  const shownView = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = buildHash(state);
    const viewKey = `${state.tablePath}#${state.tableName ?? ""}#${state.viewId ?? ""}`;
    const newView = shownView.current !== null && shownView.current !== viewKey;
    shownView.current = viewKey;
    const browserMoved = fromBrowser.current;
    fromBrowser.current = false;
    const current = window.location.hash.slice(1);
    if (next === current && !(newView && !browserMoved)) return;
    lastWritten.current = next;
    const url = `${window.location.pathname}${window.location.search}#${next}`;
    if (newView && !browserMoved) {
      depth.current += 1;
      window.history.pushState({ tableDepth: depth.current }, "", url);
    } else window.history.replaceState({ tableDepth: depth.current }, "", url);
  }, [state.tablePath, state.tableName, state.viewId, state.rowId]);
}
