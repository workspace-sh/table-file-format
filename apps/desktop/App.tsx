import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { ScrollView, Settings } from "react-native";
// Gesture handler root view enables RNGH's native gesture recognizers
// for the entire subtree. Required once per app at the root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Alert } from "react-native";
import { BundleEntry, HISTORY_FILE, newId, textDirection } from "@workspace.sh/table-core";
import type { BundleMeta, Field, ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import {
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  AttachmentsProvider,
  CellEditorContext,
  Hinted,
  DisplaySettingsProvider,
  type DisplaySettings,
  PageGutter,
  PageScrollContext,
  pageScrollOver,
  notifyLayoutChanged,
  PageReveal,
  type PageRevealRect,
  PlatformControlsProvider,
  PortalHost,
  TableView,
  ViewSettings,
  canInsertAt,
} from "@workspace.sh/table-ui";
import type { DisplaySettingKind, PlaceMeasure } from "@workspace.sh/table-ui/shared";
import { useGlassEditor } from "@workspace.sh/glass-bar";
import { inspectorStore } from "./inspectorStore";
import { windowControls } from "./Inspector";
import { watchRowMenus } from "./MacControls";
import { cancelSettingsForm, dismissSettingsForm, onSettingsFormEvent, settingsFormJson, settingsFormShown } from "./MacSettings";
import { formulaEditorJson, onFormulaEditorEvent, useMacFormulaEditor } from "./MacFormulaEditor";
import { driveFormulaEditor, onSidebar, pickInSidebar, pressInspectorCell, sendAppSettings, sendSettingsForm, setAppSettings, setInspectorCell, setInspectorShown, setSidebar, showAppSettings, toggleNativeSidebar, type InspectorCell } from "./nativeSidebar";
import {
  ARCHIVE_ROWS,
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  HISTORY_KEY,
  appendFolderHistory,
  appendStoredHistory,
  clearStoredHistory,
  keepArrivedHistories,
  storedHistory,
  withHistories,
  SIDEBAR_KEY,
  STORAGE_KEY,
  TOOLBAR_HINTS,
  appCommands,
  archiveFileName,
  asStored,
  attachmentAt,
  attachmentName,
  bundleOf,
  bundleTables,
  bundleToArchive,
  clearSaved,
  closedIn,
  derive,
  displayChoices,
  exportFailedText,
  fileText,
  flattenFilesTree,
  forgetStoredHistories,
  fromBundle,
  hintWithShortcut,
  ingestingText,
  isSpreadsheetFile,
  initialAppState,
  loadArrangements,
  loadDisplay,
  loadSaved,
  loadSidebarPrefs,
  openFailedText,
  openSpreadsheet,
  readingText,
  rowTitleFor,
  save,
  schemaVersions,
  spreadsheetText,
  tableNameOf,
  toBundle,
  tooLargeToArchiveText,
  viewCallbacks,
  withNewFixtures,
  type AppCommand,
  type AppAction,
  type AppCommandId,
  type Confirm,
  type KeyValueStore,
  type Library,
  type Making,
  type NamePrompt,
  type SheetGridShown,
} from "@workspace.sh/table-app";
import { isSheet } from "@workspace.sh/table-core";
import { openStore } from "./nativeStore";
import { checkFs } from "./fsCheck";
import { OPENED_KEY, reopenFolders, useFolders } from "./folders";
import { useFolderHistories, useIndexedTables, useTableApp, type TableAppAdapter } from "@workspace.sh/table-app/react";
import { bundleDir, openIndexDatabase, openZip, removeAllFolders, removeFolder } from "./indexHost";
import { chooseFile, chooseFolder, choosePath } from "./panels";
import { readBytes, writeBytes } from "./bytes";
import { desktopFs } from "./desktopFs";
import { FileSystem } from "react-native-file-access";
import { joinPath, writeBundleTo } from "@workspace.sh/table-core/io";
import { chooseMenuItem, copyText, firstResponder, focusSearch, menuTitles, onMenu, onQuit, onSearch, postClick, postCommand, postKey, postSearch, pressAlertButton, datePickerClose, datePickerSet, datePickerShown, popUpChoose, popUpTitles, postRightClick, postScroll, adoptToolbarInsets, setSearchText, setToolbarFilesMode, setToolbarLabel, toolbarInset, setUnsaved, setMenuItem, setUndo, setWindowTitle, setWindowWidth as resizeWindow } from "./menu";
import { attachmentUrl } from "./attachments";
import { fixtureAttachments } from "@workspace.sh/table-fixtures/native-attachments";
import { FileView } from "./FileView";
import { Tip } from "./Tip";

// Every fixture bundle's tables, keyed `bundle/table` (D37), as the web and
// Linux apps hold them, and each bundle's manifest.
const initialTables: Record<string, ParsedTable> = Object.assign(
  {},
  ...Object.entries(fixtureBundles).map(([name, b]) => fromBundle(name, b)),
);
const bundleMetas: Record<string, BundleMeta> = Object.fromEntries(
  Object.entries(fixtureBundles).map(([name, b]) => [name, b.meta]),
);
/** The content's side margin, which what scrolls sideways runs over (PageGutter). */
const CONTENT_GUTTER = 24;
/** The line under the toolbar that "how far down" is measured at, in window points. */
const PLACE_LINE = 100;
/** Where each menu's commands go: before these items, or last (Go is made new). */
const MENU_BEFORE: Record<AppCommand["menu"], string> = {
  File: "Close",
  Edit: "Paste",
  View: "Enter Full Screen",
  Go: "",
};
const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);
/** How long after the last edit it's written, so typing isn't a write a key. */
const WRITE_AFTER_MS = 400;

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "row",
    width: "100%",
    height: "100%",
    // No fill of its own: the window's background shows through, so the
    // content and the toolbar over it are one surface.
    backgroundColor: "transparent",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    paddingInline: CONTENT_GUTTER,
  },
  // A file shown in place of the view fills the pane, clear of the toolbar.
  fileShown: { display: "flex", flexDirection: "column", flex: 1, paddingBottom: 20 },
  under: (top: number) => ({ paddingTop: top + 12 }),
  breadcrumb: {
    fontSize: 12,
    marginBottom: 2,
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  titleRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sidebarTrigger: {
    fontSize: 16,
    paddingInline: 6,
    paddingBlock: 2,
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: "transparent",
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 4,
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  subtitle: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    fontSize: 12,
    marginBottom: 16,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  // What's said in place of a large table's rows, or above them while they're read.
  indexedNote: {
    fontSize: 12,
    opacity: 0.7,
    paddingBlock: 8,
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  validityOk: {
    // Hinted's span doesn't take the line's size on native, so it's said here.
    fontSize: 12,
    color: {
      default: "#1f7a2c",
      "@media (prefers-color-scheme: dark)": "#7ee08a",
    },
  },
  validityBad: {
    fontSize: 12,
    color: {
      default: "#c00",
      "@media (prefers-color-scheme: dark)": "#ff6b6b",
    },
  },
  schemaBumpBadge: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: {
      default: "#fef3c7",
      "@media (prefers-color-scheme: dark)": "#3f2e0a",
    },
    color: {
      default: "#92400e",
      "@media (prefers-color-scheme: dark)": "#fbbf24",
    },
  },
  toolbar: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  tab: {
    paddingInline: 12,
    paddingBlock: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: "transparent",
    fontSize: 12,
    fontWeight: "500",
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    cursor: "pointer",
  },
  tabActive: {
    backgroundColor: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    color: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    borderColor: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  searchInput: {
    paddingInline: 10,
    paddingBlock: 6,
    marginBottom: 16,
    fontSize: 13,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    borderRadius: 6,
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    outlineStyle: "none",
  },
});

// Every editing callback is optional: a large table still being read into its index is shown with none.
interface ViewCallbacks {
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  /** Remove a choice, or a field: table-app asks first when rows hold it. */
  onRemoveEnumValue?: (fieldName: string, value: string) => void;
  onDeleteField?: (fieldName: string) => void;
  /** Where you are in the table, for history (the cell selected), and putting it back. */
  onPlace?: (place: { rowId?: string; field?: string }) => void;
  restorePlace?: { place: { rowId?: string; field?: string }; n: number } | null;
  onPlaceMeasure?: (measure: PlaceMeasure | null) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  onRestoreSchema?: (schema: TableSchema) => void;
  onAddField?: (field: Field, place?: { name: string; side: "before" | "after" }) => void;
  /** Opens a table's new-field editor each time it changes: File › New Field and the toolbar's "+". */
  newFieldRequest?: number;
  onAddRow?: () => string | void;
  onDeleteRow?: (rowId: string) => void;
  onOpenBody?: (rowId: string) => void;
  onUpdateView?: (patch: Partial<View>) => void;
  relatedTables: Record<string, ParsedTable>;
  onOpenRelation: (address: string) => void;
  /** Every row of the table, for formulas that read another row (D34). */
  allRows: Row[];
  /** This table's key among `relatedTables`. */
  tableKey: string;
  sheet?: SheetGridShown;
  /** A large table's rows, from its index (useIndexedTables): the view reads a window of them at a time. */
  source?: ViewRows;
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
  onAttachFile?: (rowId: string, fieldName: string) => void;
}

const NO_ROWS: Row[] = [];

function renderView(
  view: View,
  rows: Row[],
  schema: TableSchema,
  bodies: Record<string, string> | undefined,
  cb: ViewCallbacks,
) {
  const common = {
    view,
    rows,
    schema,
    bodies,
    relatedTables: cb.relatedTables,
    onOpenRelation: cb.onOpenRelation,
  };
  switch (view.layout) {
    case "board":
      return (
        <BoardView {...common} onUpdateRow={cb.onUpdateRow} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />
      );
    case "gallery":
      return <GalleryView {...common} onOpenBody={cb.onOpenBody} />;
    case "list":
      return <ListView {...common} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />;
    case "calendar":
      return <CalendarView {...common} onOpenBody={cb.onOpenBody} />;
    default:
      return (
        <TableView
          {...common}
          onUpdateView={cb.onUpdateView}
          onUpdateRow={cb.onUpdateRow}
          onUpdateField={cb.onUpdateField}
          onAddEnumValue={cb.onAddEnumValue}
          onRemoveEnumValue={cb.onRemoveEnumValue}
          onDeleteField={cb.onDeleteField}
          onPlace={cb.onPlace}
          restorePlace={cb.restorePlace}
          onPlaceMeasure={cb.onPlaceMeasure}
          onMoveField={cb.onMoveField}
          onRestoreSchema={cb.onRestoreSchema}
          onAddField={cb.onAddField}
          newFieldRequest={cb.newFieldRequest}
          onAddRow={cb.onAddRow}
          onDeleteRow={cb.onDeleteRow}
          onOpenBody={cb.onOpenBody}
          allRows={cb.allRows}
          tableKey={cb.tableKey}
          sheet={cb.sheet}
          source={cb.source}
          onInsertRow={cb.onInsertRow}
          onAttachFile={cb.onAttachFile}
        />
      );
  }
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
  );
}

/**
 * Ask for a name in the system's own text prompt (a sheet on the window),
 * worded by table-app's namePrompt; `then` gets what was typed, which
 * table-app's creating trims (nothing is made when it's empty); `cancel`
 * when it's cancelled.
 * react-native-macos has Alert.promptMacOS, but not in its types.
 */
function askName(prompt: NamePrompt, then: (name: string) => void, cancel: () => void) {
  const alert = Alert as unknown as {
    promptMacOS: (
      title: string,
      message: string | undefined,
      buttons: { text: string; style?: string; onPress?: (value?: string) => void }[],
      type?: string,
      defaultInputs?: { default?: string; placeholder?: string }[],
    ) => void;
  };
  alert.promptMacOS(
    prompt.heading,
    undefined,
    [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: prompt.action, onPress: (value) => then(value ?? "") },
    ],
    "plain-text",
    [{ placeholder: prompt.placeholder }],
  );
}

/**
 * Edits are kept between launches (#86), as the web keeps them between
 * reloads: the saved tables and the folders opened last time are read
 * before the first screen, and nothing shows until they are (a moment,
 * from a local database and the disk).
 */
export default function App() {
  const [loaded, setLoaded] = useState<{ store: KeyValueStore | null; folders: Library } | undefined>(undefined);
  useEffect(() => {
    // No store (it failed to open) still runs, from the fixtures, unsaved.
    void openStore([STORAGE_KEY, ARRANGEMENTS_KEY, OPENED_KEY, DISPLAY_KEY, SIDEBAR_KEY, HISTORY_KEY])
      .catch(() => null)
      .then(async (store) => ({ store, folders: await reopenFolders(store, Object.keys(bundleMetas)) }))
      .then(setLoaded);
  }, []);
  return loaded === undefined ? null : <TableApp store={loaded.store} reopened={loaded.folders} />;
}

function TableApp({ store, reopened }: { store: KeyValueStore | null; reopened: Library }) {
  // Everything the app holds is table-app's state (docs/APP-STATE.md): what
  // was saved, or the fixtures when nothing usable was (fixture tables
  // added since the last save still appear), the folders opened last time,
  // and the viewer's own settings.
  // The platform's language, when the viewer hasn't chosen one.
  const systemLocale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);
  // Edited bundles are written a moment after the last edit: an opened
  // folder's back to the folder (folders.ts), the rest to this Mac's store.
  const writeRef = useRef<TableAppAdapter["write"]>(async () => {});
  // Read a folder table's history again once it's been added to (useFolderHistories, below).
  const rereadHistory = useRef<(key: string) => void>(() => {});
  // The large tables' save, set once their hook is made below.
  const saveIndexed = useRef<(tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const { state, dispatch, display: shownDisplay, saving, flush } = useTableApp(
    () => {
      const fixtures = { tables: initialTables, bundles: bundleMetas };
      const saved = loadSaved(store);
      const initial = saved ? withNewFixtures(saved, fixtures) : fixtures;
      const s = initialAppState({
        tables: { ...initial.tables, ...reopened.tables },
        bundles: { ...initial.bundles, ...reopened.bundles },
        opened: reopened.paths,
        stored: { sidebar: loadSidebarPrefs(store), arrangements: loadArrangements(store), display: loadDisplay(store) },
        // Each edit goes to its table's history (SPEC section 14).
        writesHistory: true,
      });
      // "Schema changed" is since the fixtures, as saved edits carry over a launch.
      return { ...s, openedAt: { ...s.openedAt, ...INITIAL_SCHEMA_VERSIONS } };
    },
    {
      store,
      write: (...args) => writeRef.current(...args),
      // What was edited, added to the table's history: in its folder for one opened from disk or
      // a large table's (each bundle a folder), else in this Mac's store beside the table.
      appendHistory: async (key, events) => {
        const now = stateRef.current;
        const bundle = bundleOf(key);
        const folder = now.opened[bundle] ?? (now.tables[key]?.indexed ? bundleDir(bundle) : undefined);
        if (folder) {
          await appendFolderHistory(desktopFs, joinPath(folder, BundleEntry.tables, tableNameOf(key)), events);
          rereadHistory.current(key);
          return;
        }
        if (!store) return false;
        appendStoredHistory(store, key, events);
      },
      delayMs: WRITE_AFTER_MS,
    },
    systemLocale,
  );
  const { tables, bundles, active: activeTablePath, display, sidebar: sidebarPrefs, opened: folderPaths } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  // `-open crm/deals#pipeline` on the command line: the table, and optionally
  // the view, shown first, as the Linux app's `--open`. The system reads a
  // launch argument as a default of that name.
  useEffect(() => {
    const open: unknown = Settings.get("open");
    if (typeof open !== "string" || !open) return;
    const [key, viewId] = open.split("#");
    if (!key || !stateRef.current.tables[key]) return;
    dispatch(viewId ? { type: "showView", key, viewId } : { type: "showTable", key });
  }, [dispatch]);
  const showProblem = useCallback((title: string, message: string) => Alert.alert(title, message), []);
  const folders = useFolders({ store, bundles, paths: folderPaths });
  // A quit that couldn't write: the next quits whatever happens, until a write succeeds.
  const quitFailed = useRef(false);
  // A write that failed: said once, with Try Again, which writes what's left now.
  useEffect(() => {
    if (saving.kind === "saved") quitFailed.current = false;
    if (saving.kind !== "failed") return;
    Alert.alert("Couldn't save", saving.message, [
      { text: "OK", style: "cancel" },
      { text: "Try Again", onPress: () => void flush() },
    ]);
  }, [saving, flush]);
  // macOS may end an app at once (sudden termination) unless it says it has
  // unsaved work; while anything is left to write, it says so.
  useEffect(() => setUnsaved(state.dirty.length > 0), [state.dirty]);
  // Quitting writes what's left first. If that fails, the app stays open
  // and says so; quitting again tries once more, then quits whatever happens.
  useEffect(
    () =>
      onQuit(async () => {
        if ((await flush()) || quitFailed.current) return true;
        quitFailed.current = true;
        return false;
      }),
    [flush],
  );
  // The fixtures themselves are never saved, so an untouched app keeps
  // following them as they change; an opened folder's tables live in the folder.
  writeRef.current = async (edited, all, metas, closed) => {
    const opened = new Set(Object.keys(stateRef.current.opened));
    // A table held in the index has no rows here: only what's left of it is kept in this store.
    save(store, {
      tables: Object.fromEntries(Object.entries(all).filter(([key]) => !opened.has(bundleOf(key)))),
      bundles: Object.fromEntries(Object.entries(metas).filter(([key]) => !opened.has(key))),
      closed,
    });
    // A file closed: its history kept here and a large table's folder go (an opened folder stays on disk).
    for (const bundle of closedIn(edited, metas)) {
      forgetStoredHistories(store, bundle);
      await removeFolder(bundle);
    }
    await folders.write(edited.filter((b) => opened.has(b)), all, metas);
    // A large table's rows, to the file beside its index; and the rest of a bundle kept as a
    // folder for one (its index's), so the folder is the whole .table. The writer leaves an
    // indexed table's rows file to the index.
    await saveIndexed.current(all);
    const kept = new Set(Object.entries(all).flatMap(([key, table]) => (table.indexed && !opened.has(bundleOf(key)) ? [bundleOf(key)] : [])));
    for (const bundle of kept) await writeBundleTo(desktopFs, bundleDir(bundle), toBundle(all, metas, bundle));
  };
  // What reading last time's folders found wrong, once.
  useEffect(() => {
    for (const [key, messages] of Object.entries(reopened.problems)) showProblem(`Problems reading ${key}.table`, messages.join("\n"));
    // Once, at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Questions, as native alerts and the system's own text prompt; messages as alerts.
  useEffect(() => {
    const asking = state.asking;
    if (!asking) return;
    if (asking.kind === "name") {
      askName(asking.prompt, (text) => dispatch({ type: "answer", response: "create", text }), () =>
        dispatch({ type: "answer", response: "cancel" }),
      );
      return;
    }
    ask(asking.confirm, (response) => {
      // Starting again from the examples: what this Mac saved goes too; opened folders stay.
      if (asking.on.type === "reset" && response === "reset") {
        clearSaved(store);
        clearStoredHistory(store);
        // The folders this Mac kept for large tables go with it.
        void removeAllFolders().catch(() => {});
      }
      dispatch({ type: "answer", response });
    });
  }, [state.asking, store]);
  useEffect(() => {
    if (!state.telling) return;
    showProblem(state.telling.heading, state.telling.body ?? "");
    dispatch({ type: "told" });
  }, [state.telling, showProblem]);
  const fresh: Library = { tables: initialTables, bundles: bundleMetas, paths: {}, problems: {} };

  // Export: the shown table's whole bundle as a real .table.zip (D27, D37),
  // so the tables it links together travel together. `path` skips the panel.
  // What reading an archive gave: its large tables' first rows, held for showing meanwhile.
  const holdFirst = useRef<(first: Record<string, Row[]>) => void>(() => {});
  // Every row of a large table, from its index (set once the hook is made below).
  const everyRow = useRef<(key: string, table: ParsedTable) => Promise<Row[]>>(async () => []);
  const exportZip = useCallback(
    async (path?: string) => {
      const bundle = bundleOf(activeTablePath);
      const where = path ?? (await choosePath("Export as a .table.zip", archiveFileName(bundle)));
      if (!where) return;
      try {
        // A table held in the index has its rows read out of it for the archive, which is made in
        // memory; one too large for that is refused, since an archive without its rows is no copy.
        const whole = { ...tables };
        for (const [key, held] of Object.entries(tables)) {
          if (bundleOf(key) !== bundle || !held.indexed) continue;
          if (held.indexed.count > ARCHIVE_ROWS) {
            const { heading, body } = tooLargeToArchiveText(tableNameOf(key), held.indexed.count);
            return dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } });
          }
          const { indexed: _index, ...rest } = held;
          whole[key] = { ...rest, rows: await everyRow.current(key, held) };
        }
        // Each table's history goes with it, everything written so far included (SPEC section 14):
        // from its folder for one opened from disk or a large table's, else from this Mac's store.
        await flush();
        const now = stateRef.current;
        const going = await withHistories(whole, async (key) => {
          const folder = now.opened[bundleOf(key)] ?? (now.tables[key]?.indexed ? bundleDir(bundleOf(key)) : undefined);
          if (folder) return (await desktopFs.readText(joinPath(folder, BundleEntry.tables, tableNameOf(key), HISTORY_FILE))) ?? undefined;
          return (store && storedHistory(store, key)) || undefined;
        });
        await writeBytes(where, await bundleToArchive(bundle, toBundle(going, bundles, bundle)));
      } catch (error) {
        dispatch({ type: "tell", message: { heading: exportFailedText(archiveFileName(bundle), error) } });
      }
    },
    [activeTablePath, tables, bundles, flush, store],
  );
  // Import: a .table.zip becomes one more bundle here, saying what the reader
  // skipped (D25). Only a file with no table in it is refused. A spreadsheet
  // someone already has (CSV, TSV and the like) becomes a new .table file.
  // `path` skips the panel.
  const importZip = useCallback(async (path?: string) => {
    const where = path ?? (await chooseFile("Open a .table.zip or a spreadsheet", ["zip", "csv", "tsv", "tab", "txt"]));
    if (!where) return;
    const name = where.split("/").pop() ?? where;
    if (isSpreadsheetFile(name)) {
      try {
        const opened = openSpreadsheet(spreadsheetText(await readBytes(where)), name, Object.keys(stateRef.current.bundles));
        const library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
        dispatch({ type: "opened", library, skipped: opened.skipped });
      } catch (error) {
        dispatch({ type: "tell", message: { heading: openFailedText(name, error) } });
      }
      return;
    }
    try {
      // A large table in it stays compressed on its way into its index (indexHost.ts): it comes
      // with no rows, and its first rows beside it to show meanwhile.
      const { opened, first } = await openZip(await readBytes(where), Object.keys(stateRef.current.bundles));
      // An arrived table's history is kept in this Mac's store for a table kept there; a large
      // table's goes into its folder with the rest of it.
      const arrived = fromBundle(opened.key, opened.bundle);
      const stored = Object.fromEntries(Object.entries(arrived).filter(([, table]) => !table.indexed));
      const library = { tables: { ...arrived, ...keepArrivedHistories(store, stored) }, bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
      holdFirst.current(Object.fromEntries(Object.entries(first).map(([table, rows]) => [`${opened.key}/${table}`, rows])));
      dispatch({ type: "opened", library, skipped: opened.skipped });
    } catch (error) {
      dispatch({ type: "tell", message: { heading: openFailedText(where.split("/").pop() ?? where, error) } });
    }
  }, []);

  // Open a .table folder and show its first table; one already open is shown again.
  const openFolder = useCallback(
    async (path: string | null) => {
      if (!path) return;
      const { opened, tables: held } = stateRef.current;
      const heldKey = Object.entries(opened).find(([, p]) => p === path)?.[0];
      if (heldKey) {
        const first = Object.keys(held).find((t) => bundleOf(t) === heldKey);
        if (first) dispatch({ type: "showTable", key: first });
        return;
      }
      const library = await folders.open([path]);
      for (const [key, messages] of Object.entries(library.problems)) showProblem(`Problems reading ${key}.table`, messages.join("\n"));
      if (Object.keys(library.tables).length > 0) dispatch({ type: "opened", library });
    },
    [folders, showProblem],
  );

  // The Display panel, open or not, kept with the sidebar prefs as the web keeps
  // its Display group's fold. Open only when unfolded by choice: on the Mac it
  // opens in the main area, so it starts closed.
  // The viewer's language, dates and formula syntax: the app's Settings
  // window (⌘,), as a Mac app keeps its preferences, rather than a panel
  // over the table as the web has. Sent whenever they change.
  useEffect(() => {
    setAppSettings(
      displayChoices(display, systemLocale, "System").map((c) => ({
        id: c.kind,
        name: c.name,
        note: c.note ?? c.label,
        value: c.value,
        options: c.options,
      })),
    );
  }, [display, systemLocale]);
  // The sidebar hidden, kept with the other sidebar prefs as the web keeps it.
  const sidebarCollapsed = sidebarPrefs.collapsed === true;
  // The sidebar is the window's own (nativeSidebar): the split view shows,
  // hides and narrows it, and says so, which is what this choice follows.
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  // The toolbar floats over the content, which runs under it: what's in the
  // content starts this far down, and scrolls up behind the toolbar.
  const [topInset, setTopInset] = useState(52);
  useEffect(() => {
    void toolbarInset().then((inset) => inset > 0 && setTopInset(inset));
  }, []);
  const sidebarShown = !sidebarCollapsed;
  const toggleSidebar = toggleNativeSidebar;
  const filesMode = sidebarPrefs.files === true;
  const chooseFilesMode = useCallback((files: boolean) => dispatch({ type: "setFilesSide", files }), []);
  // Attachments of tables opened from disk, as their folders list them; fixtures' come with the app.
  const [diskAttachments, setDiskAttachments] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!filesMode) return;
    let cancelled = false;
    const keys = Object.keys(tables).filter((key) => folderPaths[bundleOf(key)]);
    void Promise.all(
      keys.map(async (key) => {
        const dir = joinPath(folderPaths[bundleOf(key)]!, "tables", tableNameOf(key), "attachments");
        const entries = await desktopFs.list(dir).catch(() => null);
        return [key, (entries ?? []).filter((e) => !e.directory).map((e) => e.name)] as const;
      }),
    ).then((listed) => {
      if (!cancelled) setDiskAttachments(Object.fromEntries(listed));
    });
    return () => {
      cancelled = true;
    };
  }, [filesMode, tables, folderPaths]);
  const attachmentsOf = useCallback(
    (key: string) => (folderPaths[bundleOf(key)] ? diskAttachments[key] ?? [] : fixtureAttachments(key)),
    [folderPaths, diskAttachments],
  );
  // A folder opened from disk goes by its own name.
  const folderName = (bundle: string) => folderPaths[bundle]?.split("/").pop();
  // Tables held in the index (large ones): read, edited and saved there, as on the phone.
  const tell = useCallback((heading: string, body?: string) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }), [dispatch]);
  const indexed = useIndexedTables({ state, dispatch, view: derive(state, { locale: systemLocale }).shown.view, tell, openIndexDatabase });
  saveIndexed.current = indexed.save;
  holdFirst.current = indexed.hold;
  everyRow.current = indexed.everyRow;
  // A table's folder, where its history is: one opened from disk, or a large table's.
  const historyFolder = (key: string): string | undefined =>
    state.opened[bundleOf(key)] ?? (state.tables[key]?.indexed ? bundleDir(bundleOf(key)) : undefined);
  // The folder tables' histories, read so the Files side can show them as it draws.
  const folderHistories = useFolderHistories(
    Object.keys(state.tables).filter((key) => historyFolder(key) !== undefined),
    async (key) => {
      const folder = historyFolder(key);
      return folder ? ((await desktopFs.readText(joinPath(folder, BundleEntry.tables, tableNameOf(key), HISTORY_FILE))) ?? undefined) : undefined;
    },
  );
  rereadHistory.current = folderHistories.reread;
  const historyText = (key: string): string | undefined =>
    historyFolder(key) !== undefined ? folderHistories.texts[key] || undefined : (store && storedHistory(store, key)) || undefined;
  const derived = derive(state, {
    locale: systemLocale,
    attachmentsOf,
    fileNameOf: folderName,
    hasHistory: (key) => historyText(key) !== undefined,
    ...(indexed.source ? { indexedShown: { count: indexed.source.count, inView: indexed.source.inView } } : {}),
  });
  const { table, view, summary, direction } = derived;
  // File › New Field, and the toolbar's "+": each one opens the table's new-field editor.
  const [newFieldAsk, setNewFieldAsk] = useState(0);
  const shownLayoutRef = useRef(view?.layout);
  shownLayoutRef.current = view?.layout;
  // Which tables have a history: one gaining its first lists its history.ndjson.
  const historied = Object.keys(tables).filter((key) => historyText(key) !== undefined).join("\n");
  const files = useMemo(
    () => derived.filesTree.map((b) => ({ ...b, name: folderPaths[b.bundle] ? `${folderName(b.bundle)}/` : b.name })),
    // derived.filesTree is made anew each render; it follows these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filesMode, tables, bundles, sidebarPrefs.foldedFiles, activeTablePath, state.openedDirs, attachmentsOf, folderPaths, historied],
  );
  // The file shown from the Files side, in place of the view.
  const shownFile = filesMode ? state.shownFile : null;
  const shown = useMemo(() => {
    if (!shownFile) return null;
    const bundle = files.find((b) => b.bundle === shownFile.bundle);
    const parts = shownFile.path.split("/");
    let dir = bundle?.root;
    for (const name of parts.slice(0, -1)) dir = dir?.dirs.find((d) => d.name === name);
    const file = dir?.files.find((f) => f.path === shownFile.path);
    if (!bundle || !file) return null;
    const attachment = attachmentAt(shownFile.bundle, shownFile.path);
    return {
      file,
      folder: `${bundle.name}${parts.slice(0, -1).map((p) => `${p}/`).join("")}`,
      content: attachment ? undefined : fileText(tables, bundles, shownFile.bundle, shownFile.path, historyText),
      url: attachment ? attachmentUrl(attachment.tableKey, attachment.name, folderPaths) : undefined,
    };
  }, [shownFile, files, tables, bundles, folderPaths]);

  // An attachment is a file in its table's attachments/ (SPEC section 6),
  // so a table needs a folder on disk to take one: the file chosen is copied
  // there under a name no other attachment has, and the cell names it.
  // `source` skips the panel.
  const attachFile = useCallback(
    async (rowId: string, fieldName: string, source?: string) => {
      const folder = folderPaths[bundleOf(activeTablePath)];
      if (!folder) {
        showProblem(
          "Attach files to a table on disk",
          "An attachment is copied into its table's folder. Open a .table folder (Open .table…) to attach files to it.",
        );
        return;
      }
      const from = source ?? (await chooseFile("Choose a file to attach", []));
      if (!from) return;
      const dir = joinPath(folder, "tables", tableNameOf(activeTablePath), "attachments");
      try {
        await desktopFs.mkdir(dir);
        const taken = ((await desktopFs.list(dir)) ?? []).map((e) => e.name);
        const name = attachmentName(from.split("/").pop() ?? "file", taken);
        await FileSystem.cp(from, joinPath(dir, name));
        dispatch({ type: "updateRow", rowId, field: fieldName, value: name });
      } catch (error) {
        showProblem("Couldn't attach the file", error instanceof Error ? error.message : String(error));
      }
    },
    [folderPaths, activeTablePath, showProblem],
  );
  // The view on screen's callbacks, each an action (table-app's viewCallbacks).
  const callbacks = useMemo(() => viewCallbacks(state, dispatch, newId), [tables, bundles, activeTablePath]);

  // How far down the view is, kept for history as the row at a line under
  // the toolbar and how far into it (rows measured, not pixels, so it
  // survives rows drawn a window at a time), and put back on Back or Forward.
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // The page's scroll, told to the table's rows: a large table's draws only those on screen.
  const pageScroller = useMemo(() => pageScrollOver(scroller), []);
  // Where the scroll rests at its top: the system insets it under the
  // toolbar, so that is above zero by the toolbar's height.
  const restY = useRef(0);
  const measure = useRef<PlaceMeasure | null>(null);
  const onPlaceMeasure = useCallback((m: PlaceMeasure | null) => {
    measure.current = m;
  }, []);
  const placeRest = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A Mac's scroll has no "came to rest" of its own: a pause in it is one.
  const onScrolled = (y: number) => {
    scrollY.current = y;
    if (y < restY.current) restY.current = y;
    if (placeRest.current) clearTimeout(placeRest.current);
    placeRest.current = setTimeout(() => {
      void measure.current?.rowAt(PLACE_LINE).then((top) => {
        if (top) dispatch({ type: "place", place: { top } });
      });
    }, 150);
  };
  useEffect(() => () => void (placeRest.current && clearTimeout(placeRest.current)), []);
  // A rect the view wants on screen (the cell the keyboard moved to): the
  // least scroll that brings it clear of the toolbar, which covers the top
  // of this scroll by as much as the scroll rests above zero.
  const pageReveal = useCallback((rect: PageRevealRect) => {
    const view = scroller.current as unknown as { measure?: (cb: (...a: number[]) => void) => void } | null;
    view?.measure?.((_x, _y, _w, height, _px, pageY) => {
      const margin = 12;
      const top = pageY - restY.current + margin;
      const bottom = pageY + height - margin;
      const dy = rect.top < top ? rect.top - top : rect.top + rect.height > bottom ? rect.top + rect.height - bottom : 0;
      if (dy !== 0) scroller.current?.scrollTo({ y: Math.max(restY.current, scrollY.current + dy), animated: false });
    });
  }, []);
  // A right-click on a row shows its menu (MacControls.tsx).
  useEffect(() => watchRowMenus(), []);
  const restoringN = state.restoring?.n;
  useEffect(() => {
    const top = state.restoring?.place.top;
    if (restoringN === undefined) return;
    // After the view has drawn the rows it was left at.
    const t = setTimeout(() => {
      if (!top) {
        scroller.current?.scrollTo({ y: restY.current, animated: false });
        return;
      }
      // Twice: rows drawn on the first move can shift the rest; the second puts them right.
      const settle = (left: number) =>
        void measure.current?.topOf(top.rowId).then((at) => {
          if (at === null) return;
          const off = at + top.offset - PLACE_LINE;
          if (Math.abs(off) < 2) return;
          scroller.current?.scrollTo({ y: Math.max(restY.current, scrollY.current + off), animated: false });
          if (left > 0) setTimeout(() => settle(left - 1), 120);
        });
      settle(1);
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoringN]);

  // What's selected goes to the inspector, the window's trailing pane
  // (Inspector.tsx): a cell says what it is there, and a formula is written
  // there, with its colours, its working and the click-a-cell-to-add-it of
  // iOS, from the same logic (glass-bar's useGlassEditor). Everything else
  // is edited in its cell, as a Mac expects, so only formulas are taken
  // over. Search is the toolbar's.
  const glass = useGlassEditor({
    query: state.search,
    onQuery: (text) => dispatch({ type: "search", text }),
    onFilter: () => dispatch({ type: "settings", open: true }),
    formulasOnly: true,
  });
  // A row's page is written there too.
  const openPage = state.openPage;
  const pageTable = state.active;
  const page = useMemo(
    () =>
      openPage
        ? {
            key: `${pageTable}/${openPage}`,
            rowId: openPage,
            rowTitle: rowTitleFor(table, openPage),
            content: table.bodies?.[openPage] ?? "",
            onSave: (content: string) => dispatch({ type: "updateBody", rowId: openPage, content, table: pageTable }),
            onClose: () => dispatch({ type: "openPage", rowId: null }),
          }
        : null,
    [openPage, pageTable, table],
  );
  // And the view's settings, while they're open.
  const settingsShown = state.settingsOpen && !shown;
  const viewCount = table.views.length;
  const settingsView = derived.shown.view;
  const settings = useMemo(
    () =>
      settingsShown
        ? {
            key: view.id,
            view: settingsView,
            schema: table.schema,
            // Turning a Sheet view into anything else asks first (D41): the reducer's question.
            onChange: (patch: Partial<View>) => dispatch({ type: "updateView", patch }),
            onArrange: (patch: Partial<View>) => dispatch({ type: "arrange", patch }),
            personal: derived.arranged,
            onSaveForEveryone: () => dispatch({ type: "saveForEveryone" }),
            onReset: () => dispatch({ type: "resetArrangement" }),
            onDelete: viewCount > 1 ? () => dispatch({ type: "deleteView" }) : undefined,
            onClose: () => dispatch({ type: "settings", open: false }),
            onCancel: () => dispatch({ type: "settings", open: false, revert: true }),
          }
        : null,
    [settingsShown, view.id, settingsView, table.schema, derived.arranged, viewCount],
  );
  const cellKind = glass.props.state.kind;
  useEffect(() => {
    inspectorStore.set({ page, settings, cell: glass.props, cellRef: glass.bar, display: shownDisplay });
  });
  // A cell that's only selected is said in the inspector's own form
  // (TableCellInspector.swift): its field and row, its value, what the
  // field is, and the ways on from there. The same selection the iOS bar
  // shows.
  const selected = cellKind === "selected" && page === null && !settingsShown ? glass.selection : null;
  const cellJson = selected
    ? JSON.stringify({
        field: selected.label,
        row: selected.rowLabel,
        rowLabel: "Row",
        value: selected.text,
        valueLabel: selected.formula ? "Formula" : "Value",
        formula: selected.formula,
        aboutLabel: "About This Field",
        about: (selected.facts ?? "").split("\n\n").filter(Boolean),
        editLabel: selected.formula ? "Edit Formula…" : "Edit",
        ...(glass.fieldSettings(true) ? { settingsLabel: "Field Settings…" } : {}),
      } satisfies InspectorCell)
    : null;
  useEffect(() => {
    setInspectorCell(cellJson ? (JSON.parse(cellJson) as InspectorCell) : null);
  }, [cellJson]);
  // A formula being written is the inspector's own editor too (TableFormulaEditor.swift).
  useMacFormulaEditor(glass.props, glass.bar, page === null && !settingsShown);
  const cellJsonRef = useRef<string | null>(null);
  cellJsonRef.current = cellJson;
  const inspectorCell = useRef((_action: "edit" | "settings") => {});
  inspectorCell.current = (action) => {
    if (action === "edit") glass.props.onEdit?.();
    else glass.fieldSettings();
  };
  // It opens for a page or a formula being written, and for a cell once it
  // has been opened; closing it (its toolbar button) lets go of both.
  const editingFormula = cellKind === "editing";
  useEffect(() => {
    if (page !== null || editingFormula || settingsShown) setInspectorShown(true);
  }, [page, editingFormula, settingsShown]);
  // Escape backs out one level, the innermost first, and never leaves the
  // view: a field's settings (as Cancel), a formula being edited, a row's
  // page, the view's settings, then the selected cell.
  const escape = useRef(() => {});
  escape.current = () => {
    if (settingsFormShown()) return cancelSettingsForm();
    if (editingFormula) return void glass.props.onCancel?.();
    if (openPage) return dispatch({ type: "openPage", rowId: null });
    if (settingsShown) return dispatch({ type: "settings", open: false });
    glass.props.onDeselect?.();
  };
  const closeInspected = useRef(() => {});
  closeInspected.current = () => {
    if (openPage) dispatch({ type: "openPage", rowId: null });
    if (editingFormula) glass.props.onCancel?.();
    if (settingsShown) dispatch({ type: "settings", open: false });
    // A field's settings, or a new field: dismissed, as a tap outside a sheet does.
    dismissSettingsForm();
  };

  // The menu bar: table-app's commands, each with ⌘ (and ⇧) on its key, in
  // File before Close and in View before Enter Full Screen. Choosing one,
  // or pressing its key wherever focus is, does what its button does.
  const { canGoBack, canGoForward } = derived;
  useEffect(() => {
    for (const c of appCommands({ sidebarCollapsed: !sidebarShown, filesMode, canGoBack, canGoForward })) {
      // The Edit menu has AppKit's own Undo and Redo on these keys, which a text field answers:
      // they are made the table's too, below (setUndo), not added a second time.
      if (c.id === "undo" || c.id === "redo") continue;
      setMenuItem({
        id: c.id,
        menu: c.menu,
        title: c.label,
        // AppKit's way to add Shift: the key in capitals (Redo is ⌘Z as "Z"), which
        // is what a typed ⇧⌘E matches; "e" with a Shift mask doesn't.
        key: c.shift ? c.key.toUpperCase() : c.key,
        modifiers: c.option ? ["command", "option"] : ["command"],
        before: MENU_BEFORE[c.menu],
        checked: c.checked,
        enabled: c.enabled,
      });
    }
  }, [sidebarShown, filesMode, canGoBack, canGoForward]);
  // The Mac's own commands, beside table-app's: each is a toolbar button and a menu item.
  const settingsOpen = state.settingsOpen;
  useEffect(() => {
    const own: { id: string; menu: AppCommand["menu"]; title: string; key: string; modifiers: ("command" | "shift" | "option")[] }[] = [
      { id: "new-row", menu: "File", title: "New Row", key: "N", modifiers: ["command"] },
      { id: "new-field", menu: "File", title: "New Field…", key: "N", modifiers: ["command", "option"] },
      { id: "view-settings", menu: "View", title: settingsOpen ? "Hide View Settings" : "Show View Settings", key: "v", modifiers: ["command", "option"] },
      { id: "find", menu: "Edit", title: "Find in View…", key: "f", modifiers: ["command"] },
      { id: "reset-demo", menu: "File", title: "Reset Demo Data…", key: "", modifiers: [] },
    ];
    for (const c of own) setMenuItem({ ...c, before: MENU_BEFORE[c.menu] });
    // The toolbar's "+" is a menu of both.
    setToolbarLabel("new", "New");
    setToolbarLabel("view-settings", "View Settings");
    setToolbarLabel("export-zip", commandOf("export-zip").label);
  }, [settingsOpen]);
  useEffect(() => setToolbarFilesMode(filesMode), [filesMode]);
  // The toolbar's search field: what's typed in it searches the view, and
  // leaving a view (which clears the search) clears it.
  useEffect(() => onSearch((text) => dispatch({ type: "search", text })), []);
  const searchText = state.search;
  useEffect(() => setSearchText(searchText), [searchText]);
  const commands: Record<AppCommandId | "new-row" | "new-field" | "view-settings" | "find" | "reset-demo", () => void> = {
    "new-row": () => void callbacks.onAddRow(),
    // A table's own: in another layout there's no header to add it from.
    "new-field": () => {
      if ((shownLayoutRef.current ?? "table") === "table") setNewFieldAsk((n) => n + 1);
    },
    "view-settings": () => dispatch({ type: "settings", open: !stateRef.current.settingsOpen }),
    find: focusSearch,
    "reset-demo": () => dispatch({ type: "reset", fresh }),
    "new-file": () => dispatch({ type: "create", making: { kind: "file" } }),
    "open-folder": () => void chooseFolder("Choose a .table folder to open").then(openFolder),
    "open-zip": () => void importZip(),
    "export-zip": () => void exportZip(),
    "toggle-sidebar": toggleSidebar,
    "tables-mode": () => chooseFilesMode(false),
    "files-mode": () => chooseFilesMode(true),
    "go-back": () => dispatch({ type: "back" }),
    "go-forward": () => dispatch({ type: "forward" }),
    // The view's address as text, with the open page's row as the web's address has it;
    // opening one from outside the app waits on a link scheme.
    "copy-link": () => copyText(derived.address),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
  };
  // The latest handlers, so the subscription is made once.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => onMenu((id) => commandsRef.current[id as keyof typeof commands]?.()), []);
  // Edit › Undo and Redo: the table's when no text has the keyboard, on as it can be undone and redone.
  // They say what the commands say: what will be undone, once the app knows it.
  const { canUndo, canRedo } = derived;
  const undoTitle = derived.commands.find((c) => c.id === "undo")?.label ?? "Undo";
  const redoTitle = derived.commands.find((c) => c.id === "redo")?.label ?? "Redo";
  useEffect(() => setUndo(canUndo, canRedo, undoTitle, redoTitle), [canUndo, canRedo, undoTitle, redoTitle]);

  // Development only: lets a script open a table and view through
  // React Native's debugger connection, to check each layout without
  // clicking. Not in release builds (__DEV__ is false there).
  useEffect(() => {
    if (!__DEV__) return;
    const named = (making: Making, title: string) => {
      dispatch({ type: "create", making });
      dispatch({ type: "answer", response: "create", text: title });
    };
    (globalThis as { __tableDesktop?: unknown }).__tableDesktop = {
      tables: () => Object.keys(stateRef.current.tables),
      show: (key: string, viewId?: string) => {
        if (!stateRef.current.tables[key]) return `no table ${key}`;
        dispatch(viewId ? { type: "showView", key, viewId } : { type: "showTable", key });
        return `showing ${key}${viewId ? ` / ${viewId}` : ""}`;
      },
      settings: (open: boolean) => {
        dispatch({ type: "settings", open });
        return open ? "settings open" : "settings closed";
      },
      // Arranging is of the view on screen, so it shows first.
      arrange: (key: string, viewId: string, patch: Partial<View>) => {
        dispatch({ type: "showView", key, viewId });
        dispatch({ type: "arrange", patch });
        return "arranged";
      },
      // Check the file adapter against core's contract; the lines land in
      // globalThis.__fsCheck (the debugger connection can't await).
      checkFs: () => {
        (globalThis as { __fsCheck?: unknown }).__fsCheck = "running";
        void checkFs().then(
          (lines) => ((globalThis as { __fsCheck?: unknown }).__fsCheck = lines),
          (error) => ((globalThis as { __fsCheck?: unknown }).__fsCheck = String(error)),
        );
        return "checking";
      },
      // Open a folder without the panel, as the Open button does after it.
      open: (path: string) => {
        void openFolder(path);
        return `opening ${path}`;
      },
      folders: () => stateRef.current.opened,
      // What the New buttons do once a name is given (the prompt can't be typed into from here).
      newTable: (title: string) => {
        named({ kind: "table", bundle: bundleOf(stateRef.current.active) }, title);
        return `made table ${title}`;
      },
      newFile: (title: string) => {
        named({ kind: "file" }, title);
        return `made .table ${title}`;
      },
      attach: (rowId: string, fieldName: string, source: string) => {
        void attachFile(rowId, fieldName, source);
        return `attaching ${source}`;
      },
      exportZip: (path: string) => {
        void exportZip(path);
        return `exporting to ${path}`;
      },
      importZip: (path: string) => {
        void importZip(path);
        return `importing ${path}`;
      },
      newView: () => {
        dispatch({ type: "addView", id: newId() });
        return "made view";
      },
      // Set display settings, as the Display controls will.
      display: (next: DisplaySettings) => {
        dispatch({ type: "display", choice: { kind: "locale", value: next.locale ?? "" } });
        dispatch({ type: "display", choice: { kind: "dateFormat", value: next.dateFormat ?? "iso" } });
        dispatch({ type: "display", choice: { kind: "formulaSyntax", value: next.formulaSyntax ?? "excel" } });
        return "display set";
      },
      attachmentUrl: (key: string, file: string) => attachmentUrl(key, file, stateRef.current.opened) ?? null,
      // The sidebar, as its button does; and a key pressed as if typed (⌘B is postKey("b", 11, ["command"])).
      sidebar: () => {
        toggleSidebar();
        return "sidebar toggled";
      },
      inspector: (shown: boolean) => {
        setInspectorShown(shown);
        return `inspector ${shown ? "shown" : "hidden"}`;
      },
      postKey: (characters: string, keyCode: number, modifiers: ("command" | "shift" | "option" | "control")[]) => {
        postKey(characters, keyCode, modifiers);
        return `posted ${modifiers.join("+")}+${characters}`;
      },
      // A sidebar row picked, or text typed in the search field, as a click or typing would send it.
      pick: (tag: string) => {
        pickInSidebar(tag);
        return `picked ${tag}`;
      },
      typeSearch: (text: string) => {
        postSearch(text);
        return `searched ${text}`;
      },
      // What has the keyboard, left in globalThis.__responder (the debugger connection can't await).
      // A menu bar item, by its menu and title, as choosing it does: answered in __menuChoice.
      chooseMenuItem: (menu: string, title: string) => {
        void chooseMenuItem(menu, title).then((said) => ((globalThis as { __menuChoice?: string }).__menuChoice = said));
        return "asking";
      },
      responder: () => {
        void firstResponder().then((said) => ((globalThis as { __responder?: unknown }).__responder = said));
        return "asking";
      },
      // A toolbar button, by its command's id, as pressing it would send it.
      command: (id: string) => {
        postCommand(id);
        return `sent ${id}`;
      },
      // A click at a point, as the mouse would make it: it lands on whatever is under it.
      click: (x: number, y: number) => {
        postClick(x, y);
        return `clicked ${x}, ${y}`;
      },
      // A right-click there. The system menu it (or a choice cell) opens:
      // the last one's titles, and choosing from the next one by title,
      // `seconds` after it opens ("" dismisses), set before it opens.
      rightClick: (x: number, y: number) => {
        postRightClick(x, y);
        return `right-clicked ${x}, ${y}`;
      },
      // The scroll wheel turned over a point in the window (from its top left), for panes outside React's view.
      scroll: (x: number, y: number, lines: number) => {
        postScroll(x, y, lines);
        return `scrolled ${lines}`;
      },
      popUpTitles,
      popUpChoose: (title: string, seconds = 1) => {
        popUpChoose(title, seconds);
        return `will choose ${title || "nothing"}`;
      },
      // The date picker a date cell opens: whether it's showing (left in globalThis.__datePicker), setting its date as a click in it would, closing it.
      datePickerShown: () => {
        void datePickerShown().then((shown) => ((globalThis as { __datePicker?: boolean }).__datePicker = shown));
        return "asking";
      },
      datePickerSet: (iso: string) => {
        datePickerSet(new Date(iso).getTime());
        return `set ${iso}`;
      },
      datePickerClose: () => {
        datePickerClose();
        return "closed";
      },
      // The inspector's settings form: what it was sent, and what a control in it would send back
      // ({ what: "change", id, value }, { what: "press", id }, { what: "confirm" }, ...).
      settingsForm: settingsFormJson,
      // The Settings window (⌘,): open or close it, and do what a control in it would.
      appSettings: (shown: boolean) => showAppSettings(shown),
      chooseAppSetting: (id: string, value: string) => sendAppSettings({ what: "change", id, value }),
      sendSettingsForm: (event: object) => {
        sendSettingsForm(event);
        return "sent";
      },
      // The inspector's account of the selected cell: what it was sent, and pressing its buttons.
      inspectorCell: () => cellJsonRef.current,
      formulaEditor: formulaEditorJson,
      driveFormulaEditor: (what: Parameters<typeof driveFormulaEditor>[0], text = "") => {
        driveFormulaEditor(what, text);
        return `formula editor: ${what}`;
      },
      pressInspectorCell: (action: "edit" | "settings") => {
        pressInspectorCell(action);
        return `pressed ${action}`;
      },
      menuTitles,
      // Answer the alert on screen, as clicking its button would (#274). A promise: read the result later.
      pressAlert: (title: string) => {
        void pressAlertButton(title).then((pressed) => ((globalThis as { __pressed?: unknown }).__pressed = pressed));
        return `pressing ${title}`;
      },
      history: () => stateRef.current.history,
      state: () => stateRef.current,
      // Any of table-app's actions, as the app's own handlers dispatch them.
      dispatch: (action: AppAction) => {
        dispatch(action);
        return action.type;
      },
      // The window's width, as dragging its edge would set it; and what the sidebar is doing.
      resize: (width: number) => {
        resizeWindow(width);
        return `resizing to ${width}`;
      },
      sidebarState: () => ({ windowWidth, shown: sidebarShown }),
      // The reset, as if Reset were chosen in its alert (the alert itself can't be pressed from a script).
      reset: () => {
        clearSaved(store);
        clearStoredHistory(store);
        dispatch({ type: "reset", fresh });
        dispatch({ type: "answer", response: "reset" });
        return `reset; kept ${Object.keys(stateRef.current.opened).join(", ") || "no folders"}`;
      },
      resetPrompt: () => dispatch({ type: "reset", fresh }),
      // Files mode, as the sidebar's switch, folders and files do.
      files: (on: boolean) => {
        chooseFilesMode(on);
        return `files mode ${on}`;
      },
      toggleDir: (bundle: string, path: string, open: boolean) => {
        dispatch({ type: "toggleDir", id: `${bundle}/${path}`, open });
        return `${bundle}/${path} ${open ? "open" : "closed"}`;
      },
      showFile: (bundle: string | null, path?: string) => {
        dispatch({ type: "showFile", file: bundle && path ? { bundle, path } : null });
        return bundle ? `showing ${bundle}/${path}` : "back to the view";
      },
      // Forget saved edits, opened folders, arrangements and the sidebar's folds; the next launch starts from the fixtures.
      clearSaved: () => {
        clearSaved(store);
        clearStoredHistory(store);
        store?.removeItem(OPENED_KEY);
        store?.removeItem(ARRANGEMENTS_KEY);
        store?.removeItem(SIDEBAR_KEY);
        return "saved edits, opened folders, arrangements and sidebar forgotten";
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, openFolder, exportZip, importZip, attachFile, chooseFilesMode, toggleSidebar, windowWidth, sidebarShown]);

  // Hint wording, shared with the web and Linux (table-app's commands).
  const commandOf = (id: AppCommandId) => derived.commands.find((c) => c.id === id)!;
  // The sidebar's lines, as table-app works them out; an opened folder under its own name.
  const sidebarTree = useMemo(
    () => derived.sidebarTree.map((file) => ({ ...file, file: folderName(file.bundle) ?? file.file })),
    [derived.sidebarTree, folderPaths],
  );
  const filesLines = useMemo(() => flattenFilesTree(files), [files]);
  useEffect(() => {
    setSidebar({ tree: sidebarTree, active: activeTablePath, filesMode, files: filesLines, shownFile });
  }, [sidebarTree, activeTablePath, filesMode, filesLines, shownFile]);
  // What's clicked in it, each as the action its row stands for.
  const activeRef = useRef(activeTablePath);
  activeRef.current = activeTablePath;
  useEffect(
    () =>
      onSidebar((e) => {
        if (e.type === "selectTable") dispatch({ type: "showTable", key: e.key });
        else if (e.type === "selectView") dispatch({ type: "showView", key: e.key, viewId: e.viewId });
        else if (e.type === "toggleFile") dispatch({ type: "toggleFile", bundle: e.bundle });
        else if (e.type === "newView") dispatch({ type: "addView", id: newId() });
        else if (e.type === "close") dispatch({ type: "close", bundle: e.bundle });
        else if (e.type === "newTable") dispatch({ type: "create", making: { kind: "table", bundle: bundleOf(activeRef.current) } });
        else if (e.type === "filesMode") chooseFilesMode(e.files);
        else if (e.type === "toggleDir") dispatch({ type: "toggleDir", id: `${e.bundle}/${e.path}`, open: e.open });
        else if (e.type === "showFile") dispatch({ type: "showFile", file: { bundle: e.bundle, path: e.path } });
        else if (e.type === "shown") dispatch({ type: "setSidebarCollapsed", collapsed: !e.shown });
        else if (e.type === "inspector" && !e.shown) closeInspected.current();
        else if (e.type === "inspectorCell") inspectorCell.current(e.action);
        else if (e.type === "escape") escape.current();
        else if (e.type === "settingsForm") onSettingsFormEvent(e);
        else if (e.type === "formulaEditor") onFormulaEditorEvent(e);
        else if (e.type === "appSettings" && e.what === "change") dispatch({ type: "display", choice: { kind: e.id as DisplaySettingKind, value: e.value } });
      }),
    [chooseFilesMode],
  );
  // The window is titled for the view on screen, with where it lives under it (D37).
  const windowTitle = shown ? shown.file.name : view.name;
  useEffect(() => {
    setWindowTitle(windowTitle, derived.breadcrumb.text);
  }, [windowTitle, derived.breadcrumb.text]);

  // The view's rows and a Sheet view's saved grid, worked out as on the web (table-app).
  const { view: shownView, rows: visibleRows, sheet } = derived.shown;
  // The rows of a large table still being read, shown until its own view's rows are here.
  const reading = view.layout === "table" && !indexed.source ? indexed.reading : undefined;

  return (
    <GestureHandlerRootView
      style={{ flex: 1 }}
      onLayout={(e) => {
        setWindowWidth(e.nativeEvent.layout.width);
        // The pane is as wide as the window, its sidebar and its inspector leave it: what measured itself measures again.
        notifyLayoutChanged();
      }}
    >
      <AttachmentsProvider value={(file) => attachmentUrl(activeTablePath, file, folderPaths)}>
      <PortalHost>
        <PlatformControlsProvider value={windowControls}>
        <DisplaySettingsProvider value={shownDisplay}>
        <html.div dir={direction} style={styles.root}>
          <html.div style={styles.content}>
            {shown ? (
              <html.div style={[styles.fileShown, styles.under(topInset)]}>
                <FileView {...shown} onClose={() => dispatch({ type: "showFile", file: null })} />
              </html.div>
            ) : (
            <>
            {/* Out to the content's edges, its margin inside, so what scrolls
                sideways (a table, a board) can run over the margin to the
                edges (PageGutter) rather than be cut off by this view. */}
            <PageGutter.Provider value={CONTENT_GUTTER}>
            <PageReveal.Provider value={pageReveal}>
            <ScrollView
              ref={scroller}
              onScroll={(e) => {
                onScrolled(e.nativeEvent.contentOffset.y);
                pageScroller.onScroll(e);
              }}
              scrollEventThrottle={16}
              onContentSizeChange={pageScroller.onContentSizeChange}
              style={{ flex: 1, marginHorizontal: -CONTENT_GUTTER }}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, paddingHorizontal: CONTENT_GUTTER }}
              showsVerticalScrollIndicator
              // The system keeps this scroll's top clear of the toolbar once
              // it's told this is the pane's own scroll (React Native turns
              // that off). It is also what the system's scroll-edge effect
              // behind the toolbar needs. TODO(#383): the soft style; see
              // native/TablePanels/TableShell.swift.
              onLayout={(e) => {
                void adoptToolbarInsets();
                pageScroller.onLayout(e);
                // (The scroll view measures as any view does; its type doesn't say so.)
                (scroller.current as unknown as { measureInWindow?: (done: (x: number, y: number) => void) => void } | null)?.measureInWindow?.(
                  (_x, y) => pageScroller.setWindowTop(y),
                );
              }}
            >
              <PageScrollContext.Provider value={pageScroller.pageScroll}>
              <html.div style={styles.subtitle}>
                {/* While a large table is read, how far that has got is in the count's place, and nothing is said of its rows yet. */}
                {indexed.building ? (
                  <html.span>{readingText(indexed.building)}</html.span>
                ) : (
                  // A search of a large table takes a moment: the count waits for its rows.
                  <html.span>{indexed.stale && state.search.trim().length > 0 ? "Searching…" : summary.count}</html.span>
                )}
                {!indexed.building && <html.span>·</html.span>}
                {/* Hover for the errors, or the rule they'd break: the system tooltip. */}
                {!indexed.building && (
                  <Hinted hint={summary.validityHint} style={summary.valid ? styles.validityOk : styles.validityBad}>
                    {summary.validity}
                  </Hinted>
                )}
                {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
                {summary.schemaChanged && (
                  <>
                    <html.span>·</html.span>
                    <Hinted hint={summary.schemaChangedHint} style={styles.schemaBumpBadge}>
                      {summary.schemaChangedLabel}
                    </Hinted>
                  </>
                )}
              </html.div>

              <CellEditorContext.Provider value={glass.editor}>
              {indexed.lost ? (
                <html.span style={styles.indexedNote}>This table's rows are no longer on this Mac. Open its .table.zip again to bring them back.</html.span>
              ) : table.indexed && view.layout !== "table" ? (
                <html.span style={styles.indexedNote}>This layout isn't shown for a table this large yet. Change the view's layout to Table in its settings.</html.span>
              ) : table.indexed && !indexed.source && !reading ? null : (
                // A large table shows its rows at once, as its file has them, and as many as
                // have been read so far, while it is read into its index (LARGE-TABLES-PLAN,
                // decision 1): to scroll through and look at. The view's own order, filters and
                // groups, search and editing come with the index. One table view for both, so
                // where you had scrolled to is where you still are when the reading is done.
                <>
                  {reading && <html.span style={styles.indexedNote}>{ingestingText(shownView)}</html.span>}
                  {renderView(
                    reading ? asStored(shownView) : shownView,
                    reading ? NO_ROWS : visibleRows,
                    table.schema,
                    reading ? undefined : table.bodies,
                    reading
                      ? {
                          source: reading,
                          relatedTables: bundleTables(tables, bundleOf(activeTablePath)),
                          onOpenRelation: () => {},
                          allRows: NO_ROWS,
                          tableKey: tableNameOf(activeTablePath),
                        }
                      : {
                          ...callbacks,
                          onPlace: (p) => dispatch({ type: "place", place: { rowId: p.rowId, field: p.field } }),
                          restorePlace: state.restoring ? { place: state.restoring.place, n: state.restoring.n } : null,
                          onPlaceMeasure,
                          relatedTables: bundleTables(tables, bundleOf(activeTablePath)),
                          allRows: table.rows,
                          tableKey: tableNameOf(activeTablePath),
                          sheet,
                          onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
                          onAttachFile: attachFile,
                          newFieldRequest: newFieldAsk,
                          ...(table.indexed
                            ? {
                                source: indexed.source,
                                // Removing a choice takes it out of every row that holds it, which the index can't yet do in place.
                                onRemoveEnumValue: undefined,
                                onDeleteField: undefined,
                              }
                            : {}),
                        },
                  )}
                </>
              )}
              </CellEditorContext.Provider>
              </PageScrollContext.Provider>
            </ScrollView>
            </PageReveal.Provider>
            </PageGutter.Provider>
            </>
            )}
          </html.div>
        </html.div>
        </DisplaySettingsProvider>
        </PlatformControlsProvider>
      </PortalHost>
      </AttachmentsProvider>
    </GestureHandlerRootView>
  );
}
