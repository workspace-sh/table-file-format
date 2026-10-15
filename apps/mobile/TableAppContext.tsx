// The app's state, held once for every screen: table-app's reducer
// (useTableApp, as on the web, macOS and Linux), with the phone's own
// store, questions, messages and file actions. The screens (app/) read it
// with useTableAppContext.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState, Platform } from "react-native";
import { BundleEntry, HISTORY_FILE, filesOfFolder, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";
import { joinPath } from "@workspace.sh/table-core/io";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import {
  ARCHIVE_ROWS,
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  HISTORY_KEY,
  SIDEBAR_KEY,
  STORAGE_KEY,
  appendFolderHistory,
  appendStoredHistory,
  singleFileName,
  bundleOf,
  clearSaved,
  clearStoredHistory,
  closedIn,
  forgetStoredHistories,
  isSpreadsheetFile,
  keepArrivedHistories,
  storedHistory,
  withHistories,
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
  tableNameOf,
  toBundle,
  tooLargeToArchiveText,
  withNewFixtures,
  type AppAction,
  type AppCommandId,
  type AppState as TableAppState,
  type Confirm,
  type Derived,
  type KeyValueStore,
  type Library,
} from "@workspace.sh/table-app";
import { useFolderHistories, useTableApp } from "@workspace.sh/table-app/react";
import type { DisplaySettings } from "@workspace.sh/table-ui";
import { openStore } from "./store";
import { NameSheet } from "./NameSheet";
import { ZipError, readSpreadsheet, readZip, shareZip, OPEN_TYPES, type OpenedZip } from "./files";
import { OPENED_KEY, reopenDocuments, useDocuments, type Documents, type OpenedDocuments } from "./documents";
import { pickDocument, releaseDocument, type HeldDocument } from "./modules/table-files";
import { File } from "expo-file-system";
import { useIndexedTables, type IndexedTables } from "@workspace.sh/table-app/react";
import { bundleDir, openIndexDatabase, removeAllFolders, removeFolder } from "./indexHost";
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
  /** Open a .table where it is (a folder or a single file), or make one from a spreadsheet, chosen in the system's picker. */
  open: () => Promise<void>;
  /** Open a document already held (picked, or given to the app by the system), as Open… does after the picker. */
  openHeld: (held: HeldDocument) => Promise<void>;
  /** Take in a single-file .table's bytes as a copy, as measuring does; resolves with the key it is held under. */
  openBytes: (bytes: Uint8Array, name: string) => Promise<string>;
  /** The tables held in their index (large ones): the rows on screen, and how far a reading has got. */
  indexed: Pick<IndexedTables, "building" | "reading" | "source" | "stale" | "lost">;
  exportZip: () => Promise<void>;
  /** The phone's own language, which "System" in the display settings means. */
  systemLocale: string;
  /** Start again from the example tables, after asking; what the phone saved goes too. */
  resetDemo: () => void;
  /** A table's history as NDJSON, from where the phone keeps it; undefined when it has none. For the Files sheet. */
  historyText: (key: string) => string | undefined;
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
  const [loaded, setLoaded] = useState<{ store: KeyValueStore | null; reopened: OpenedDocuments } | undefined>(undefined);
  useEffect(() => {
    // No store (it failed to open) still runs, from the fixtures, unsaved. The documents
    // opened last time are held open again and read before the first screen.
    openStore([STORAGE_KEY, ARRANGEMENTS_KEY, DISPLAY_KEY, SIDEBAR_KEY, HISTORY_KEY, OPENED_KEY])
      .catch(() => null)
      .then(async (store) => ({ store, reopened: await reopenDocuments(store, Object.keys(bundleMetas)) }))
      .then(setLoaded);
  }, []);
  if (loaded === undefined) return <Context.Provider value={null}>{children}</Context.Provider>;
  return (
    <Loaded store={loaded.store} reopened={loaded.reopened}>
      {children}
    </Loaded>
  );
}

function Loaded({ store, reopened, children }: { store: KeyValueStore | null; reopened: OpenedDocuments; children: ReactNode }) {
  // The platform's language, when the viewer hasn't chosen one.
  const systemLocale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);
  const saveIndexed = useRef<(tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  // The tables as they are now, for where a table's history goes: a large table's folder, or the store.
  const tablesNow = useRef<Record<string, ParsedTable>>({});
  // Read a folder table's history again once it's been added to (useFolderHistories, below).
  const rereadHistory = useRef<(key: string) => void>(() => {});
  // The documents opened where they are (documents.ts), set once its hook is made below.
  const documentsRef = useRef<Documents | null>(null);
  // Each opened document's folder, by bundle key, as the state has it now.
  const openedNow = useRef<Record<string, string>>({});
  const { state, dispatch, display, flush } = useTableApp(
    () => {
      const fixtures = { tables: initialTables, bundles: bundleMetas };
      const saved = loadSaved(store);
      const initial = saved ? withNewFixtures(saved, fixtures) : fixtures;
      const s = initialAppState({
        tables: { ...initial.tables, ...reopened.library.tables },
        bundles: { ...initial.bundles, ...reopened.library.bundles },
        opened: reopened.library.paths,
        ...(reopened.library.singleFiles ? { singleFiles: reopened.library.singleFiles } : {}),
        stored: { sidebar: loadSidebarPrefs(store), arrangements: loadArrangements(store), display: loadDisplay(store) },
        // Each edit goes to its table's history (SPEC section 14).
        writesHistory: true,
      });
      // "Schema changed" is since the fixtures, as saved edits carry over a launch.
      return { ...s, openedAt: { ...s.openedAt, ...INITIAL_SCHEMA_VERSIONS } };
    },
    // Saved on the phone a moment after the last edit. The fixtures themselves are
    // never saved, so an untouched app keeps following them as they change.
    {
      store,
      write: async (edited, tables, bundles, closed) => {
        // An opened document's tables live in the document: the rest are kept in this store.
        const opened = new Set(Object.keys(openedNow.current));
        // A table held in the index has no rows here: only what's left of it is kept in this store.
        save(store, {
          tables: Object.fromEntries(Object.entries(tables).filter(([key]) => !opened.has(bundleOf(key)))),
          bundles: Object.fromEntries(Object.entries(bundles).filter(([key]) => !opened.has(key))),
          closed,
        });
        // A file closed: its history kept here and a large table's folder go (an opened document stays where it is).
        for (const bundle of closedIn(edited, bundles)) {
          forgetStoredHistories(store, bundle);
          await removeFolder(bundle);
        }
        await documentsRef.current?.write(edited.filter((b) => opened.has(b)), tables, bundles);
        await saveIndexed.current(tables);
        // An opened single file holding a large table: its rows, saved above, packed back into it too.
        await documentsRef.current?.pack([...new Set(Object.entries(tables).flatMap(([key, table]) => (table.indexed && opened.has(bundleOf(key)) ? [bundleOf(key)] : [])))]);
        // A bundle kept as a folder (it has a large table) has the rest of its files written there too,
        // so the folder is the whole .table; the writer leaves an indexed table's rows file to the index.
        const folders = new Set(Object.entries(tables).flatMap(([key, table]) => (table.indexed && !opened.has(bundleOf(key)) ? [bundleOf(key)] : [])));
        for (const bundle of folders) await writeBundleTo(expoFs, bundleDir(bundle), toBundle(tables, bundles, bundle));
      },
      // What was edited, added to the table's history: in its document's folder for one opened
      // where it is, in its folder for a large table (the bundle is a folder on the phone), else
      // in the phone's store beside the table.
      appendHistory: async (key, events) => {
        const folder = openedNow.current[bundleOf(key)];
        if (folder) {
          await appendFolderHistory(expoFs, joinPath(folder, BundleEntry.tables, tableNameOf(key)), events);
          await documentsRef.current?.pack([bundleOf(key)]);
          rereadHistory.current(key);
          return;
        }
        if (tablesNow.current[key]?.indexed) {
          await appendFolderHistory(expoFs, joinPath(bundleDir(bundleOf(key)), BundleEntry.tables, tableNameOf(key)), events);
          rereadHistory.current(key);
          return;
        }
        if (!store) return false;
        appendStoredHistory(store, key, events);
      },
      delayMs: SAVE_AFTER_MS,
    },
    systemLocale,
  );
  tablesNow.current = state.tables;
  openedNow.current = state.opened;
  const documents = useDocuments({ store, bundles: state.bundles, paths: state.opened, reopened });
  documentsRef.current = documents;
  // A table's folder, where its history is: its document's, or a large table's.
  const historyFolder = (key: string): string | undefined =>
    state.opened[bundleOf(key)] ?? (state.tables[key]?.indexed ? bundleDir(bundleOf(key)) : undefined);
  // A table's history, from where appendHistory puts it: a folder, or the store.
  const historyOf = async (key: string): Promise<string | undefined> => {
    const folder = openedNow.current[bundleOf(key)];
    if (folder) return (await expoFs.readText(joinPath(folder, BundleEntry.tables, tableNameOf(key), HISTORY_FILE))) ?? undefined;
    if (tablesNow.current[key]?.indexed) {
      return (await expoFs.readText(joinPath(bundleDir(bundleOf(key)), BundleEntry.tables, tableNameOf(key), HISTORY_FILE))) ?? undefined;
    }
    return (store && storedHistory(store, key)) || undefined;
  };
  // The folder tables' histories (an opened document's, a large table's), read so the Files sheet can show them as it draws.
  const folderHistories = useFolderHistories(
    Object.keys(state.tables).filter((key) => historyFolder(key) !== undefined),
    historyOf,
  );
  rereadHistory.current = folderHistories.reread;
  const historyText = (key: string): string | undefined =>
    historyFolder(key) !== undefined ? folderHistories.texts[key] || undefined : (store && storedHistory(store, key)) || undefined;
  const tell = useCallback((heading: string, body?: string) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }), [dispatch]);
  // Tables held in the index (large ones): read, edited and saved there.
  const indexed = useIndexedTables({ state, dispatch, view: derive(state, { locale: systemLocale }).shown.view, tell, openIndexDatabase });
  saveIndexed.current = indexed.save;
  const derived = derive(state, {
    locale: systemLocale,
    hasHistory: (key) => historyText(key) !== undefined,
    ...(indexed.source ? { indexedShown: { count: indexed.source.count, inView: indexed.source.inView } } : {}),
  });
  /** What reading an archive gave, taken in: its large tables' first rows are held for showing meanwhile. */
  const take = (opened: OpenedZip): string => {
    indexed.hold(opened.first);
    // An arrived table's history is kept in the store for a table kept there; a large table's
    // goes into its folder with the rest of it.
    const arrived = opened.library.tables;
    const stored = Object.fromEntries(Object.entries(arrived).filter(([, table]) => !table.indexed));
    const tables = { ...arrived, ...keepArrivedHistories(store, stored) };
    dispatch({ type: "opened", library: { ...opened.library, tables }, skipped: opened.skipped });
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
          clearStoredHistory(store);
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
    historyText,
    // The reducer asks first; on yes the saved edits are cleared above.
    resetDemo: () => dispatch({ type: "reset", fresh: { tables: initialTables, bundles: bundleMetas, paths: {}, problems: {} } }),
    // A .table from the Files app or elsewhere, opened where it is: a folder, or a single file
    // edited in place (documents.ts). A spreadsheet someone already has becomes a new .table
    // file here, saying what was skipped (D25). One already open is shown again.
    open: async () => {
      let held;
      try {
        held = await pickDocument(OPEN_TYPES);
      } catch (error) {
        return dispatch({ type: "tell", message: { heading: openFailedText(".table", error) } });
      }
      if (held) await value.openHeld(held);
    },
    openHeld: async (held) => {
      if (!held.directory && isSpreadsheetFile(held.name)) {
        try {
          take(readSpreadsheet(await new File(held.uri).bytes(), Object.keys(state.bundles), held.name));
        } catch (error) {
          dispatch({ type: "tell", message: { heading: error instanceof ZipError ? openFailedText(error.fileName, error.reason) : openFailedText(held.name, error) } });
        } finally {
          releaseDocument(held.path);
        }
        return;
      }
      const uri = held.uri.replace(/\/+$/, "");
      const heldKey = Object.entries(state.opened).find(([, folder]) => documents.documentOf(folder) === uri)?.[0];
      if (heldKey) {
        const first = Object.keys(state.tables).find((t) => bundleOf(t) === heldKey);
        if (first) dispatch({ type: "showTable", key: first });
        return;
      }
      const library: Library = await documents.open([held]);
      for (const [key, messages] of Object.entries(library.problems)) tell(`Problems reading ${key}.table`, messages.join("\n"));
      if (Object.keys(library.tables).length > 0) dispatch({ type: "opened", library });
    },
    openBytes: async (bytes, name) =>
      take(isSpreadsheetFile(name) ? readSpreadsheet(bytes, Object.keys(state.bundles), name) : await readZip(bytes, Object.keys(state.bundles), name)),
    indexed,
    // The file on screen as a .table.zip, to the share sheet (Save to Files, AirDrop, Mail…).
    exportZip: async () => {
      const bundle = bundleOf(state.active);
      try {
        // A table held in the index has its rows read out of it for the archive, which is made in
        // memory; one too large for that is refused, since an archive without its rows is no copy.
        const whole = { ...state.tables };
        for (const [key, held] of Object.entries(state.tables)) {
          if (bundleOf(key) !== bundle || !held.indexed) continue;
          if (held.indexed.count > ARCHIVE_ROWS) {
            const { heading, body } = tooLargeToArchiveText(tableNameOf(key), held.indexed.count);
            return tell(heading, body);
          }
          const { indexed: _index, ...rest } = held;
          whole[key] = { ...rest, rows: await indexed.everyRow(key, held) };
        }
        // Each table's history goes with it, everything written so far included (SPEC section 14);
        // and an opened document's attachments and files no reader knows.
        await flush();
        const folder = state.opened[bundle];
        const files = folder ? await filesOfFolder(expoFs, folder) : {};
        if (files[".gitignore"] && new TextDecoder().decode(files[".gitignore"]).trim() === "index.sqlite*") delete files[".gitignore"];
        await shareZip(bundle, await withHistories(whole, historyOf), state.bundles, files);
      } catch (error) {
        dispatch({ type: "tell", message: { heading: exportFailedText(singleFileName(bundle), error) } });
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
