// The React binding for table-app's reducer (docs/APP-STATE.md, step 4):
// useTableApp holds an app's state in tableApp and runs the effects every
// app wrote around it. It keeps the viewer's settings in the app's store,
// writes edited bundles a moment after the last edit, and gives the display
// settings with the direction the viewer's language reads (derive's own rule). React is a peer
// of this subpath only: the rest of table-app stays renderer-free.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { textDirection, type BundleMeta, type ParsedTable, type TextDirection } from "@workspace.sh/table-core";
import type { DisplaySettings } from "@workspace.sh/table-ui/shared";

import { forViews, saveArrangements } from "./arrangements.ts";
import { tableApp, type AppAction, type AppState } from "./appState.ts";
import { saveDisplay, viewerLocale } from "./displaySettings.ts";
import type { KeyValueStore } from "./savedTables.ts";
import { saveSidebarPrefs } from "./sidebarPrefs.ts";

/** Where an app keeps what the reducer holds. */
export interface TableAppAdapter {
  /** Where the viewer's sidebar, arrangements and display settings are kept; null keeps them only while the app runs. */
  store: KeyValueStore | null;
  /**
   * Write the bundles edited, as `tables` and `metas` hold them. Resolves
   * once they're written; `false` when the app held the write back (a
   * reset under way), so they stay to write. A rejection is shown as
   * `saving`'s failure, and they stay to write.
   */
  write: (bundles: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => Promise<void | false>;
  /** How long after the last edit to write. 0 (the default) writes as soon as the edit shows. */
  delayMs?: number;
}

/** Where the files stand: written, being written, or not written and why. */
export type SaveState = { kind: "saved" } | { kind: "saving" } | { kind: "failed"; message: string };

/**
 * Write what's dirty now, and say it's written: true when it's all
 * written (or nothing was dirty), false when the app held it back or it
 * failed, and it stays to write. Plain, as scheduleWrite is.
 */
export async function writeNow(
  state: Pick<AppState, "dirty" | "tables" | "bundles">,
  adapter: Pick<TableAppAdapter, "write">,
  dispatch: (action: AppAction) => void,
  onSaving: (saving: SaveState) => void,
): Promise<boolean> {
  if (state.dirty.length === 0) return true;
  const { dirty: which, tables, bundles } = state;
  onSaving({ kind: "saving" });
  try {
    const done = await adapter.write(which, tables, bundles);
    // `tables` as written: a bundle edited again meanwhile stays to write.
    if (done !== false) dispatch({ type: "written", bundles: which, tables });
    onSaving({ kind: "saved" });
    return done !== false;
  } catch (error) {
    onSaving({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Write what's dirty `delayMs` after now, then say it's written. Returns
 * what cancels it, for an edit that comes first. Plain, so it's tested
 * without a renderer; useTableApp runs it after every edit.
 */
export function scheduleWrite(
  state: Pick<AppState, "dirty" | "tables" | "bundles">,
  adapter: Pick<TableAppAdapter, "write" | "delayMs">,
  dispatch: (action: AppAction) => void,
  onSaving: (saving: SaveState) => void,
): () => void {
  if (state.dirty.length === 0) return () => {};
  const timer = setTimeout(() => void writeNow(state, adapter, dispatch, onSaving), adapter.delayMs ?? 0);
  return () => clearTimeout(timer);
}

export interface TableApp {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  /** The display settings, with the direction the viewer's language reads (D40): what DisplaySettingsProvider takes. */
  display: DisplaySettings & { direction: TextDirection };
  saving: SaveState;
  /**
   * Write what's dirty now, without waiting for the delay: before the app
   * closes, or to try a failed write again. Resolves true once it's all
   * written.
   */
  flush: () => Promise<boolean>;
}

/**
 * An app's state in table-app's reducer, from `init` (initialAppState and
 * whatever the app lays over it), with the effects every app runs.
 * `locale` is the platform's own (the browser's, the system's), for the
 * direction when the viewer hasn't chosen a language. What to draw is
 * derive's, which each app calls with its own options.
 */
export function useTableApp(init: () => AppState, adapter: TableAppAdapter, locale?: string): TableApp {
  const [state, dispatch] = useReducer(tableApp, undefined, init);
  const { store } = adapter;
  // The latest adapter, so a write that fires later uses it.
  const latest = useRef(adapter);
  latest.current = adapter;
  const latestState = useRef(state);
  latestState.current = state;

  // This viewer's own settings, kept as they change. Arrangements only of views that still exist.
  useEffect(() => saveSidebarPrefs(store, state.sidebar), [store, state.sidebar]);
  useEffect(() => saveArrangements(store, forViews(state.arrangements, state.tables)), [store, state.arrangements, state.tables]);
  useEffect(() => saveDisplay(store, state.display), [store, state.display]);

  // Edited bundles, written a moment after the last edit.
  const [saving, setSaving] = useState<SaveState>({ kind: "saved" });
  useEffect(
    () => scheduleWrite(state, { write: (...a) => latest.current.write(...a), delayMs: adapter.delayMs }, dispatch, setSaving),
    // The state's parts a write reads; a new edit reschedules it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.dirty, state.tables, state.bundles, adapter.delayMs],
  );

  const direction = textDirection(viewerLocale(state.display, locale));
  const display = useMemo(() => ({ ...state.display, direction }), [state.display, direction]);
  const flush = useCallback(() => writeNow(latestState.current, latest.current, dispatch, setSaving), []);
  return { state, dispatch, display, saving, flush };
}
