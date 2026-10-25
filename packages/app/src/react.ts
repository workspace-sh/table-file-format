// The React binding for table-app's reducer (docs/APP-STATE.md, step 4):
// useTableApp holds an app's state in tableApp and runs the effects every
// app wrote around it. It keeps the viewer's settings in the app's store,
// writes edited bundles a moment after the last edit, and gives the display
// settings with the direction the viewer's language reads (derive's own rule). React is a peer
// of this subpath only: the rest of table-app stays renderer-free.

import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { newId, stampEdits, textDirection, type BundleMeta, type EditChange, type EditEvent, type ParsedTable, type TextDirection } from "@workspace.sh/table-core";
import type { DisplaySettings } from "@workspace.sh/table-ui/shared";

import { forViews, loadArrangements, saveArrangements } from "./arrangements.ts";
import { derive, initialAppState, tableApp, viewCallbacks, type AppAction, type AppState, type Derived, type ViewCallbacks } from "./appState.ts";
import { bundleOf, relatedTables, tableNameOf } from "./bundles.ts";
import type { EmbeddedTableFiles, EmbedShown } from "./embed.ts";
import { heldFile, noteWriting, tellHeld } from "./heldFiles.ts";
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
   * `saving`'s failure, and they stay to write. A bundle given that
   * `metas` doesn't hold was closed: what the app kept of it goes.
   * `closed`: every bundle closed here, for the app to keep with its
   * saved tables (`Saved.closed`).
   */
  write: (bundles: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>, closed: string[]) => Promise<void | false>;
  /** How long after the last edit to write. 0 (the default) writes as soon as the edit shows. */
  delayMs?: number;
  /**
   * Append these events to a table's `history.ndjson` (SPEC section 14),
   * by its `bundle/table` key. Given by an app that writes history, which
   * also starts its state with `writesHistory`. `false` when it couldn't
   * (the table has nowhere on disk yet), so they stay to write; so does a
   * rejection.
   */
  appendHistory?: (key: string, events: EditEvent[]) => Promise<void | false>;
  /** Who is editing, for each event's `by`. Left out when the app has no name for them. */
  editor?: string;
  /** How long a page being typed in is still before its changes are said as one event. 60 s, as the spec suggests. */
  pageStillMs?: number;
}

/** A page's stretch of typing is over once it has been still this long (SPEC section 14, coalescing). */
export const PAGE_STILL_MS = 60_000;

/**
 * Append what was edited to each table's history, and say it's written.
 * `sent` is this app's own note of the last change handed over for each
 * table: a second call before the state has heard of the first doesn't
 * write the same changes twice. True when nothing is left to write.
 */
export async function writeHistoryNow(
  state: Pick<AppState, "editLog">,
  adapter: Pick<TableAppAdapter, "appendHistory" | "editor">,
  dispatch: (action: AppAction) => void,
  sent: Map<string, EditChange>,
): Promise<boolean> {
  if (!adapter.appendHistory) return true;
  let all = true;
  for (const [key, pending] of Object.entries(state.editLog.pending)) {
    const last = sent.get(key);
    const changes = pending.slice(last ? pending.indexOf(last) + 1 : 0);
    if (changes.length === 0) continue;
    try {
      const done = await adapter.appendHistory(key, stampEdits(changes, adapter.editor ? { by: adapter.editor } : {}));
      if (done === false) {
        all = false;
        continue;
      }
      sent.set(key, changes.at(-1)!);
      // These only: the ones before them were said when they were written, and go first.
      dispatch({ type: "editsWritten", key, count: changes.length });
    } catch {
      all = false;
    }
  }
  return all;
}

/** Where the files stand: written, being written, or not written and why. */
export type SaveState = { kind: "saved" } | { kind: "saving" } | { kind: "failed"; message: string };

/** What a write reads of the state. */
type Writable = Pick<AppState, "dirty" | "tables" | "bundles"> & Partial<Pick<AppState, "closed">>;

/**
 * Write what's dirty now, and say it's written: true when it's all
 * written (or nothing was dirty), false when the app held it back or it
 * failed, and it stays to write. Plain, as scheduleWrite is.
 */
export async function writeNow(
  state: Writable,
  adapter: Pick<TableAppAdapter, "write">,
  dispatch: (action: AppAction) => void,
  onSaving: (saving: SaveState) => void,
): Promise<boolean> {
  if (state.dirty.length === 0) return true;
  const { dirty: which, tables, bundles } = state;
  onSaving({ kind: "saving" });
  try {
    const done = await adapter.write(which, tables, bundles, state.closed ?? []);
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
  state: Writable,
  adapter: Pick<TableAppAdapter, "write" | "delayMs">,
  dispatch: (action: AppAction) => void,
  onSaving: (saving: SaveState) => void,
): () => void {
  if (state.dirty.length === 0) return () => {};
  const timer = setTimeout(() => void writeNow(state, adapter, dispatch, onSaving), adapter.delayMs ?? 0);
  return () => clearTimeout(timer);
}

/**
 * Everything still to write, written now: the bundles edited, and what
 * was edited for each table's history, with a page still being typed in
 * said first (the app may be about to close). True once it's all written.
 */
export async function flushNow(
  state: AppState,
  adapter: Pick<TableAppAdapter, "write" | "appendHistory" | "editor">,
  dispatch: (action: AppAction) => void,
  onSaving: (saving: SaveState) => void,
  sent: Map<string, EditChange>,
): Promise<boolean> {
  const settled = tableApp(state, { type: "pagesSettled" });
  if (settled !== state) dispatch({ type: "pagesSettled" });
  const written = await writeNow(state, adapter, dispatch, onSaving);
  const logged = await writeHistoryNow(settled, adapter, dispatch, sent);
  return written && logged;
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
  const [state, reactDispatch] = useReducer(tableApp, undefined, init);
  const { store } = adapter;
  // The latest adapter, so a write that fires later uses it.
  const latest = useRef(adapter);
  latest.current = adapter;
  const latestState = useRef(state);
  latestState.current = state;
  // Each action is applied to the latest state at once as well as handed to React, so what is
  // still to write is known even when the view goes in the same moment as an edit (an editor that
  // commits as its document closes): React drops a gone view's last update, the flush doesn't.
  const dispatch = useCallback((action: AppAction) => {
    latestState.current = tableApp(latestState.current, action);
    reactDispatch(action);
  }, []);

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

  // What was edited, appended to each table's history a moment after: one write at a time, in order.
  const sent = useRef(new Map<string, EditChange>());
  const historyWrites = useRef<Promise<boolean>>(Promise.resolve(true));
  const writeHistory = useCallback((from: Pick<AppState, "editLog">) => {
    historyWrites.current = historyWrites.current.then(() => writeHistoryNow(from, latest.current, dispatch, sent.current));
    return historyWrites.current;
  }, []);
  useEffect(() => {
    if (!latest.current.appendHistory || Object.keys(state.editLog.pending).length === 0) return;
    const timer = setTimeout(() => void writeHistory(latestState.current), adapter.delayMs ?? 0);
    return () => clearTimeout(timer);
  }, [state.editLog.pending, adapter.delayMs, writeHistory]);
  // A page typed in and then left still: its changes are said as one event.
  useEffect(() => {
    if (Object.keys(state.editLog.pages).length === 0) return;
    const timer = setTimeout(() => dispatch({ type: "pagesSettled" }), adapter.pageStillMs ?? PAGE_STILL_MS);
    return () => clearTimeout(timer);
    // Each save of the page (a new `tables`) starts the wait again.
  }, [state.editLog.pages, state.tables, adapter.pageStillMs]);

  const direction = textDirection(viewerLocale(state.display, locale));
  const display = useMemo(() => ({ ...state.display, direction }), [state.display, direction]);
  const flush = useCallback(() => {
    // After any history write under way, so nothing is written twice or out of order.
    historyWrites.current = historyWrites.current.then(() => flushNow(latestState.current, latest.current, dispatch, setSaving, sent.current));
    return historyWrites.current;
  }, []);
  return { state, dispatch, display, saving, flush };
}

/** A table held for drawing inside something else: what a drop-in's views are given. */
export interface EmbeddedTable {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  derived: Derived;
  display: DisplaySettings & { direction: TextDirection };
  /** The table's name in its bundle: the views' `tableKey`. */
  tableName: string;
  /** Every table of its bundle by name: the views' `relatedTables`. */
  related: Record<string, ParsedTable>;
  /**
   * The views' callbacks, each an action on the state. Without following
   * a linked row: that would put another table here with no way back, and
   * where a link goes is for the document's app to say.
   */
  callbacks: Omit<ViewCallbacks, "onOpenRelation">;
}

/**
 * A `.table` drawn inside something else (`./embed`), held as an app of
 * its own holds it: the same state and the same actions, so a cell edited
 * in a document is written to the file, goes to its history and can be
 * undone. What is still to write is written when the drop-in goes.
 * Mount it anew (a `key`) for another table or view. `store` keeps this
 * reader's own arrangement of each view (D4) from one opening to the next;
 * absent, it lasts while the table is open.
 */
/**
 * A store kept for one file: every key it is asked for is kept under the
 * file's path, so a reader's arrangements of one `projects.table` aren't
 * another's of the same name elsewhere.
 */
export function storeFor(store: KeyValueStore, path: string): KeyValueStore {
  const at = (key: string) => `${path}\u0000${key}`;
  return { getItem: (key) => store.getItem(at(key)), setItem: (key, value) => store.setItem(at(key), value), removeItem: (key) => store.removeItem(at(key)) };
}

export function useEmbeddedTable(shown: EmbedShown, files: EmbeddedTableFiles, locale?: string, store: KeyValueStore | null = null): EmbeddedTable {
  const { library } = shown;
  const { state, dispatch, display, flush } = useTableApp(
    () =>
      initialAppState({
        tables: library.tables,
        bundles: library.bundles,
        opened: library.paths,
        start: { tablePath: shown.key, ...(shown.viewId ? { viewId: shown.viewId } : {}) },
        writesHistory: !!files.appendHistory,
        // This reader's own sorts, filters and groupings of each view (D4), as kept from before.
        ...(store ? { stored: { arrangements: loadArrangements(store) } } : {}),
      }),
    {
      store,
      write: async (bundles, tables, metas) => {
        await Promise.all(
          bundles.map((bundle) => {
            const write = files.write(library, tables, metas, bundle);
            // Another view reading this file now waits for it.
            const path = library.paths[bundle];
            if (path !== undefined) noteWriting(path, write);
            return write;
          }),
        );
      },
      ...(files.appendHistory ? { appendHistory: (key: string, events: EditEvent[]) => files.appendHistory!(library, key, events) } : {}),
    },
    locale,
  );
  const flushing = useRef(flush);
  flushing.current = flush;
  useEffect(
    () => () => {
      const written = flushing.current();
      for (const path of Object.values(library.paths)) noteWriting(path, written);
    },
    // Once, as it goes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The same file held by other views (heldFiles): kept in step with them. A table this view
  // changed is told to them; one they changed is taken as it is, and not told back.
  const self = useRef({});
  const taken = useRef(new WeakSet<ParsedTable>());
  const latestTables = useRef(state.tables);
  latestTables.current = state.tables;
  useEffect(() => {
    const stops = Object.entries(library.paths).map(([bundle, path]) =>
      heldFile(path, (name, table, from) => {
        const key = `${bundle}/${name}`;
        if (from === self.current || !latestTables.current[key] || latestTables.current[key] === table) return;
        taken.current.add(table);
        dispatch({ type: "reloaded", key, table });
      }),
    );
    return () => stops.forEach((stop) => stop());
    // The file's paths don't change while it is held.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const before = useRef(state.tables);
  useEffect(() => {
    const was = before.current;
    before.current = state.tables;
    for (const [key, table] of Object.entries(state.tables)) {
      if (was[key] === table || taken.current.has(table) || table.indexed) continue;
      const path = library.paths[bundleOf(key)];
      if (path !== undefined) tellHeld(path, tableNameOf(key), table, self.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tables]);

  const derived = derive(useSearchBehind(state), { locale, newTableIn: "none" });
  const related = useMemo(() => relatedTables(state.tables, bundleOf(state.active)), [state.tables, state.active]);
  const { onOpenRelation: _follow, ...callbacks } = viewCallbacks(state, dispatch, newId);
  return { state, dispatch, derived, display, tableName: tableNameOf(state.active), related, callbacks };
}

/**
 * The state with its search a step behind what's typed, for drawing the
 * view. What's typed shows at once in the search field, and the view's
 * rows, filtered again for each keystroke, follow when there's time: on a
 * table of thousands of rows the filtering held the keyboard, and the
 * field lost keys. The search field itself reads `state.search`.
 */
export function useSearchBehind(state: AppState): AppState {
  const search = useDeferredValue(state.search);
  return useMemo(() => (search === state.search ? state : { ...state, search }), [state, search]);
}

export { useIndexedTables, type IndexedTables } from "./useIndexedTables.ts";
export { useFolderHistories, type FolderHistories } from "./useFolderHistories.ts";
export { DEPARTED_TOAST_MS, useDepartedToast, type DepartedToast } from "./useDepartedToast.ts";
