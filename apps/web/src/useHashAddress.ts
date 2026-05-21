/**
 * Sync app navigation state with `location.hash` using the
 * row-address grammar (`<path>#<key>=<value>&...`). Result:
 *
 *   https://demo/#projects#row=p1&view=v5
 *   ↓ parseAddress(location.hash.slice(1))
 *   { tablePath: "projects", rowId: "p1", viewId: "v5" }
 *
 * The inner `#` survives because browsers preserve the full fragment
 * after the FIRST `#` — assignments through history.replaceState keep
 * it literal. We still defensively `decodeURIComponent` on read since
 * some browser code paths do percent-encode the inner separator.
 *
 * Loop avoidance: we track the last URL we wrote ourselves so the
 * subsequent `hashchange` event (or no-op replaceState) doesn't bounce
 * back into setState. Only externally-triggered hash changes — typing
 * in the address bar, browser back/forward — trip the listener.
 */

import { useEffect, useRef } from "react";
import { formatAddress, parseAddress, type Address } from "@workspace.sh/table-core";

export interface HashAddressState {
  tablePath: string;
  viewId?: string;
  rowId?: string;
}

export interface UseHashAddressOpts {
  state: HashAddressState;
  /** Called when an external hash change (load / back / forward) needs applying. */
  onExternalChange: (addr: Address) => void;
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
    rowId: state.rowId,
    viewId: state.viewId,
  });
}

export function useHashAddress({ state, onExternalChange }: UseHashAddressOpts) {
  // Track the last hash WE wrote so we can ignore the hashchange echo.
  const lastWritten = useRef<string | null>(null);

  // On mount: pull initial state from the hash (if present). Runs once.
  useEffect(() => {
    const addr = readHash();
    if (addr) onExternalChange(addr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Write current state to the hash on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = buildHash(state);
    const current = window.location.hash.slice(1);
    if (next === current) return;
    lastWritten.current = next;
    // replaceState (not pushState) — every keystroke / cell edit isn't
    // worth a history entry. Coarser navigations (table / view switch)
    // could be promoted to pushState later if the back-button UX needs
    // it.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
  }, [state.tablePath, state.viewId, state.rowId]);
}
