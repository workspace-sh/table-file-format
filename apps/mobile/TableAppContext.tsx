// The app's state, held once for every screen: table-app's reducer
// (useTableApp, as on the web, macOS and Linux), with the phone's own
// store, questions, messages and file actions. The screens (app/) read it
// with useTableAppContext.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState, Platform } from "react-native";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import {
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  SIDEBAR_KEY,
  STORAGE_KEY,
  archiveFileName,
  bundleOf,
  clearSaved,
  derive,
  exportFailedText,
  fromBundle,
  initialAppState,
  loadArrangements,
  loadDisplay,
  loadSaved,
  loadSidebarPrefs,
  openFailedText,
  save,
  schemaVersions,
  toBundle,
  withNewFixtures,
  type AppAction,
  type AppCommandId,
  type AppState as TableAppState,
  type Confirm,
  type Derived,
  type KeyValueStore,
} from "@workspace.sh/table-app";
import { useTableApp } from "@workspace.sh/table-app/react";
import type { DisplaySettings } from "@workspace.sh/table-ui";
import { openStore } from "./store";
import { NameSheet } from "./NameSheet";
import { ZipError, chooseZip, readZip, shareZip, type OpenedZip } from "./files";
import { useIndexedTables, type IndexedTables } from "./useIndexedTables";
import { bundleDir, removeAllFolders } from "./indexHost";
import { expoFs } from "./expoFs";
import { writeBundleTo } from "@workspace.sh/table-core/io";

// Every fixture bundle's tables, keyed `bundle/table` (D37), as the web,
// macOS and Linux apps hold them, and each bundle's manifest.
const initialTables: Record<string, ParsedTable> = Object.assign(
  {},
  ...Object.entries(fixtureBundles).map(([name, b]) => fromBundle(name, b)),
);
const bundleMetas: Record<string, BundleMeta> = Object.fromEntries(
  Object.entries(fixtureBundles).map(([name, b]) => [name, b.meta]),
);
// How long after the last edit the phone saves (the Mac and Linux apps use 400 ms): typing is one write, not one a key.
const SAVE_AFTER_MS = 400;
const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

export interface TableAppContextValue {
  state: TableAppState;
  dispatch: (action: AppAction) => void;
  derived: Derived;
  /** The display settings with their direction, for DisplaySettingsProvider. */
  display: DisplaySettings;
  /** A command's label, as the other apps' menus word it. */
  labelOf: (id: AppCommandId) => string;
  openZip: () => Promise<void>;
  /** Take in a .table.zip's bytes, as choosing one does; resolves with the key it is held under. */
  openBytes: (bytes: Uint8Array, name: string) => Promise<string>;
  /** The tables held in their index (large ones): the rows on screen, and how far a reading has got. */
  indexed: Pick<IndexedTables, "building" | "reading" | "source" | "stale" | "lost">;
  exportZip: () => Promise<void>;
  /** The phone's own language, which "System" in the display settings means. */
  systemLocale: string;
  /** Start again from the example tables, after asking; what the phone saved goes too. */
  resetDemo: () => void;
}

const Context = createContext<TableAppContextValue | null>(null);

/** The app's state; null until the phone's store has been read. */
export function useTableAppContext(): TableAppContextValue | null {
  return useContext(Context);
}

/** Ask a table-app Confirm as a native alert; `then` gets the id of the response chosen. */
function ask(prompt: Confirm, then: (response: string) => void) {
  Alert.alert(
    prompt.heading,
    prompt.body,
    prompt.responses.map((r) => ({
      text: r.label,
      style: r.id === "cancel" ? ("cancel" as const) : r.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => then(r.id),
    })),
    { cancelable: true, onDismiss: () => then("cancel") },
  );
}

/**
 * Edits are kept between launches (#86): the saved tables are read before
 * the first screen, and the screens draw nothing until they are (a moment,
 * from the phone's own storage).
 */
export function TableAppProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<KeyValueStore | null | undefined>(undefined);
  useEffect(() => {
    // No store (it failed to open) still runs, from the fixtures, unsaved.
    openStore([STORAGE_KEY, ARRANGEMENTS_KEY, DISPLAY_KEY, SIDEBAR_KEY]).then(setStore, () => setStore(null));
  }, []);
  if (store === undefined) return <Context.Provider value={null}>{children}</Context.Provider>;
  return <Loaded store={store}>{children}</Loaded>;
}

function Loaded({ store, children }: { store: KeyValueStore | null; children: ReactNode }) {
  // The platform's language, when the viewer hasn't chosen one.
  const systemLocale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);
  const saveIndexed = useRef<(tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const { state, dispatch, display, flush } = useTableApp(
    () => {
      const fixtures = { tables: initialTables, bundles: bundleMetas };
      const saved = loadSaved(store);
      const initial = saved ? withNewFixtures(saved, fixtures) : fixtures;
      const s = initialAppState({
        ...initial,
        stored: { sidebar: loadSidebarPrefs(store), arrangements: loadArrangements(store), display: loadDisplay(store) },
      });
      // "Schema changed" is since the fixtures, as saved edits carry over a launch.
      return { ...s, openedAt: { ...s.openedAt, ...INITIAL_SCHEMA_VERSIONS } };
    },
    // Saved on the phone a moment after the last edit. The fixtures themselves are
    // never saved, so an untouched app keeps following them as they change.
    {
      store,
      write: async (_edited, tables, bundles) => {
        // A table held in the index has no rows here: only what's left of it is kept in this store.
        save(store, { tables, bundles });
        await saveIndexed.current(tables);
        // A bundle kept as a folder (it has a large table) has the rest of its files written there too,
        // so the folder is the whole .table; the writer leaves an indexed table's rows file to the index.
        const folders = new Set(Object.entries(tables).flatMap(([key, table]) => (table.indexed ? [bundleOf(key)] : [])));
        for (const bundle of folders) await writeBundleTo(expoFs, bundleDir(bundle), toBundle(tables, bundles, bundle));
      },
      delayMs: SAVE_AFTER_MS,
    },
    systemLocale,
  );
  const tell = useCallback((heading: string, body?: string) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }), [dispatch]);
  // Tables held in the index (large ones): read, edited and saved there.
  const indexed = useIndexedTables({ state, dispatch, view: derive(state, { locale: systemLocale }).shown.view, tell });
  saveIndexed.current = indexed.save;
  const derived = derive(state, {
    locale: systemLocale,
    ...(indexed.source ? { indexedShown: { count: indexed.source.count, inView: indexed.source.inView } } : {}),
  });
  /** What reading an archive gave, taken in: its large tables' first rows are held for showing meanwhile. */
  const take = (opened: OpenedZip): string => {
    indexed.hold(opened.first);
    dispatch({ type: "opened", library: opened.library, skipped: opened.skipped });
    return Object.keys(opened.library.bundles)[0]!;
  };

  // Going to the background may be the last the app sees before it's
  // ended: what's left is written first.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void flush();
    });
    return () => sub.remove();
  }, [flush]);

  // Questions as native alerts: on iOS a name too, in the system's alert
  // with a text field; Android asks for a name in the NameSheet below.
  useEffect(() => {
    const asking = state.asking;
    if (!asking) return;
    if (asking.kind === "confirm")
      return ask(asking.confirm, (response) => {
        // Starting again from the examples: what the phone saved goes too,
        // or the old edits would come back at the next launch.
        if (asking.on.type === "reset" && response === "reset") {
          clearSaved(store);
          // The folders the phone kept for large tables go with it.
          void removeAllFolders().catch(() => {});
        }
        dispatch({ type: "answer", response });
      });
    if (Platform.OS !== "ios") return;
    Alert.prompt(asking.prompt.heading, undefined, [
      { text: "Cancel", style: "cancel", onPress: () => dispatch({ type: "answer", response: "cancel" }) },
      { text: asking.prompt.action, isPreferred: true, onPress: (text?: string) => dispatch({ type: "answer", response: "create", text: text ?? "" }) },
    ]);
  }, [state.asking, dispatch]);
  useEffect(() => {
    if (!state.telling) return;
    Alert.alert(state.telling.heading, state.telling.body);
    dispatch({ type: "told" });
  }, [state.telling, dispatch]);

  const value: TableAppContextValue = {
    state,
    dispatch,
    derived,
    display,
    labelOf: (id) => derived.commands.find((c) => c.id === id)!.label,
    systemLocale,
    // The reducer asks first; on yes the saved edits are cleared above.
    resetDemo: () => dispatch({ type: "reset", fresh: { tables: initialTables, bundles: bundleMetas, paths: {}, problems: {} } }),
    // A .table.zip from the Files app or elsewhere becomes one more file here, saying what was skipped (D25).
    openZip: async () => {
      try {
        const opened = await chooseZip(Object.keys(state.bundles));
        if (opened) take(opened);
      } catch (error) {
        const heading = error instanceof ZipError ? openFailedText(error.fileName, error.reason) : openFailedText(".table.zip", error);
        dispatch({ type: "tell", message: { heading } });
      }
    },
    openBytes: async (bytes, name) => take(await readZip(bytes, Object.keys(state.bundles), name)),
    indexed,
    // The file on screen as a .table.zip, to the share sheet (Save to Files, AirDrop, Mail…).
    exportZip: async () => {
      const bundle = bundleOf(state.active);
      try {
        await shareZip(bundle, state.tables, state.bundles);
      } catch (error) {
        dispatch({ type: "tell", message: { heading: exportFailedText(archiveFileName(bundle), error) } });
      }
    },
  };

  return (
    <Context.Provider value={value}>
      {children}
      <NameSheet
        prompt={Platform.OS !== "ios" && state.asking?.kind === "name" ? state.asking.prompt : null}
        onAnswer={(text) =>
          dispatch(text === null ? { type: "answer", response: "cancel" } : { type: "answer", response: "create", text })
        }
      />
    </Context.Provider>
  );
}
