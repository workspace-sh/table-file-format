import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { ScrollView } from "react-native";
// Gesture handler root view enables RNGH's native gesture recognizers
// for the entire subtree. Required once per app at the root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Alert } from "react-native";
import { newId, textDirection } from "@workspace.sh/table-core";
import type { BundleMeta, Field, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import {
  BodyEditor,
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  AttachmentsProvider,
  DisplayControls,
  Hinted,
  DisplaySettingsProvider,
  type DisplaySettings,
  PortalHost,
  TableView,
  ViewSettings,
  canInsertAt,
} from "@workspace.sh/table-ui";
import {
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  SIDEBAR_KEY,
  loadSidebarPrefs,
  saveSidebarPrefs,
  sidebarTree,
  filesTree,
  flattenFilesTree,
  fileText,
  attachmentAt,
  type SidebarPrefs,
  displayChoices,
  withDisplayChoice,
  newView,
  withView,
  attachmentName,
  archiveFileName,
  bundleToArchive,
  openArchive,
  toBundle,
  loadDisplay,
  saveDisplay,
  STORAGE_KEY,
  clearSaved,
  forViews,
  loadArrangements,
  loadSaved,
  save,
  saveArrangements,
  withNewFixtures,
  type KeyValueStore,
  arrange,
  isArranged,
  reset as resetArrangement,
  withoutView,
  deletingRow,
  deletingView,
  viewPatchPrompt,
  type Confirm,
  type Arrangements,
  bundleOf,
  bundleTables,
  fromBundle,
  onTable,
  rowTitleFor,
  sheetShown,
  showView,
  tableNameOf,
  withBody,
  withCell,
  withChoice,
  withField,
  withFieldMoved,
  withFieldPatch,
  withRow,
  withRowAt,
  withViewPatch,
  withoutRow,
  type SheetGridShown,
  schemaVersions,
  viewSummary,
  appCommands,
  importSkippedText,
  openFailedText,
  hintWithShortcut,
  TOOLBAR_HINTS,
  leaving,
  DEFAULT_TABLE_KEY,
  firstTableKey,
  firstViews,
  withFileUnfolded,
  type AppCommand,
  NO_HISTORY,
  addressLive,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  viewAddress,
  visited,
  type History,
  tableBreadcrumb,
  afterReset,
  resetPrompt,
  type AppCommandId,
  addressTarget,
  savingForEveryone,
  creating,
  namePrompt,
  type NamePrompt,
} from "@workspace.sh/table-app";
import { isSheet } from "@workspace.sh/table-core";
import { openStore } from "./nativeStore";
import { checkFs } from "./fsCheck";
import { OPENED_KEY, useFolders } from "./folders";
import { chooseFile, chooseFolder, choosePath } from "./panels";
import { readBytes, writeBytes } from "./bytes";
import { desktopFs } from "./desktopFs";
import { FileSystem } from "react-native-file-access";
import { joinPath } from "@workspace.sh/table-core/io";
import { Sidebar } from "./Sidebar";
import { copyText, menuTitles, onMenu, postKey, setMenuItem, setWindowWidth as resizeWindow } from "./menu";
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
/** Shown only if no table is held at all, which the examples prevent: a table with one view and nothing in it. */
const NO_TABLE: ParsedTable = {
  path: "",
  schema: { fields: [] },
  rows: [],
  views: [{ id: "all", name: "All", layout: "table" }],
  meta: {},
};
/** At or below this window width (points) the sidebar hides on its own: the web's breakpoint (useNarrow). */
const NARROW_AT_MOST = 760;
/** Where each menu's commands go: before these items, or last (Go is made new). */
const MENU_BEFORE: Record<AppCommand["menu"], string> = {
  File: "Close",
  Edit: "Paste",
  View: "Enter Full Screen",
  Go: "",
};
const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "row",
    width: "100%",
    height: "100%",
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#0e0e10",
    },
  },
  content: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    paddingInline: 24,
    paddingBlock: 20,
  },
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
  displayPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxWidth: 340,
    marginBottom: 16,
    paddingBlock: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
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

interface ViewCallbacks {
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue: (fieldName: string, value: string) => void;
  onMoveField: (fieldName: string, delta: -1 | 1) => void;
  onAddField: (field: Field) => void;
  onAddRow: () => string;
  onDeleteRow: (rowId: string) => void;
  onOpenBody: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
  relatedTables: Record<string, ParsedTable>;
  onOpenRelation: (address: string) => void;
  /** Every row of the table, for formulas that read another row (D34). */
  allRows: Row[];
  /** This table's key among `relatedTables`. */
  tableKey: string;
  sheet?: SheetGridShown;
  onInsertRow?: (anchor: string, where: "above" | "below") => void;
  onAttachFile?: (rowId: string, fieldName: string) => void;
}

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
          onMoveField={cb.onMoveField}
          onAddField={cb.onAddField}
          onAddRow={cb.onAddRow}
          onDeleteRow={cb.onDeleteRow}
          onOpenBody={cb.onOpenBody}
          allRows={cb.allRows}
          tableKey={cb.tableKey}
          sheet={cb.sheet}
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
 * table-app's creating trims (nothing is made when it's empty). Cancel
 * calls nothing.
 * react-native-macos has Alert.promptMacOS, but not in its types.
 */
function askName(prompt: NamePrompt, then: (name: string) => void) {
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
      { text: "Cancel", style: "cancel" },
      { text: prompt.action, onPress: (value) => then(value ?? "") },
    ],
    "plain-text",
    [{ placeholder: prompt.placeholder }],
  );
}

/**
 * Edits are kept between launches (#86), as the web keeps them between
 * reloads: the saved tables are read before the first screen, and nothing
 * shows until they are (a moment, from a local database).
 */
export default function App() {
  const [store, setStore] = useState<KeyValueStore | null | undefined>(undefined);
  useEffect(() => {
    // No store (it failed to open) still runs, from the fixtures, unsaved.
    openStore([STORAGE_KEY, ARRANGEMENTS_KEY, OPENED_KEY, DISPLAY_KEY, SIDEBAR_KEY]).then(setStore, () => setStore(null));
  }, []);
  return store === undefined ? null : <TableApp store={store} />;
}

function TableApp({ store }: { store: KeyValueStore | null }) {
  // What was saved, or the fixtures when nothing usable was; fixture
  // tables added since the last save still appear.
  const [initial] = useState(() => {
    const fixtures = { tables: initialTables, bundles: bundleMetas };
    const saved = loadSaved(store);
    return saved ? withNewFixtures(saved, fixtures) : fixtures;
  });
  const [tables, setTables] = useState<Record<string, ParsedTable>>(initial.tables);
  // Each bundle's manifest (D37): the fixtures', and any folder opened.
  const [bundles, setBundles] = useState<Record<string, BundleMeta>>(initial.bundles);
  const showProblem = useCallback((title: string, message: string) => Alert.alert(title, message), []);
  const folders = useFolders({ store, tables, setTables, bundles, setBundles, onProblem: showProblem });
  const [activeTablePath, setActiveTablePath] = useState<string>(() => firstTableKey(initial.tables) ?? DEFAULT_TABLE_KEY);
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(() => firstViews(initial.tables));
  // Saved after every change. The fixtures themselves are never saved, so
  // an untouched app keeps following them as they change. An opened
  // folder's tables live in the folder (folders.ts), so they're left out.
  useEffect(() => {
    if (tables === initialTables) return;
    const opened = new Set(Object.keys(folders.paths));
    save(store, {
      tables: Object.fromEntries(Object.entries(tables).filter(([key]) => !opened.has(bundleOf(key)))),
      bundles: Object.fromEntries(Object.entries(bundles).filter(([key]) => !opened.has(key))),
    });
  }, [store, tables, bundles, folders.paths]);

  // Start again from the example tables (table-app's resetPrompt and
  // afterReset): edits to them go, and so do tables made or imported here;
  // a .table folder opened from disk is the person's own, and stays open as
  // it is. What's on screen stays if it's in one of those folders.
  const doReset = useCallback(() => {
    const opened = Object.keys(folders.paths);
    clearSaved(store);
    const after = afterReset(tables, bundles, { tables: initialTables, bundles: bundleMetas }, opened);
    setTables(after.tables);
    setBundles(after.bundles);
    if (!opened.includes(bundleOf(activeTablePath))) setActiveTablePath(firstTableKey(after.tables) ?? DEFAULT_TABLE_KEY);
    setActiveViewIds((prev) => ({
      ...Object.fromEntries(Object.entries(prev).filter(([key]) => opened.includes(bundleOf(key)))),
      ...firstViews(initialTables),
    }));
    setQuery("");
    setActiveBodyRowId(null);
    setShownFile(null);
    return opened;
  }, [folders.paths, store, tables, bundles, activeTablePath]);
  const resetDemo = useCallback(() => {
    ask(resetPrompt({ openedFolders: Object.keys(folders.paths).length > 0 }), (response) => {
      if (response === "reset") doReset();
    });
  }, [folders.paths, doReset]);

  // Show what was just made: its first view, from the top.
  const showMade = useCallback((key: string, viewId: string) => {
    setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
    setActiveTablePath(key);
    setQuery("");
    setActiveBodyRowId(null);
  }, []);
  // A new table goes into the bundle on show, as a new sheet into a workbook (D37).
  const createTable = useCallback(
    (name: string) => {
      const made = creating(tables, bundles, { kind: "table", bundle: bundleOf(activeTablePath) }, name);
      if (!made) return;
      setTables(made.tables);
      setBundles(made.bundles);
      showMade(made.key, made.viewId);
    },
    [tables, bundles, activeTablePath, showMade],
  );
  // A new .table: a bundle holding one new table.
  const createFile = useCallback(
    (name: string) => {
      const made = creating(tables, bundles, { kind: "file" }, name);
      if (!made) return;
      setTables(made.tables);
      setBundles(made.bundles);
      showMade(made.key, made.viewId);
    },
    [tables, bundles, showMade],
  );

  // Export: the shown table's whole bundle as a real .table.zip (D27, D37),
  // so the tables it links together travel together. `path` skips the panel.
  const exportZip = useCallback(
    async (path?: string) => {
      const bundle = bundleOf(activeTablePath);
      const where = path ?? (await choosePath("Export as a .table.zip", archiveFileName(bundle)));
      if (!where) return;
      try {
        await writeBytes(where, await bundleToArchive(bundle, toBundle(tables, bundles, bundle)));
      } catch (error) {
        showProblem(`Couldn't export ${archiveFileName(bundle)}`, error instanceof Error ? error.message : String(error));
      }
    },
    [activeTablePath, tables, bundles, showProblem],
  );
  // Import: a .table.zip becomes one more bundle here, saying what the reader
  // skipped (D25). Only a file with no table in it is refused. `path` skips the panel.
  const importZip = useCallback(
    async (path?: string) => {
      const where = path ?? (await chooseFile("Open a .table.zip", ["zip"]));
      if (!where) return;
      try {
        const opened = await openArchive(await readBytes(where), Object.keys(bundles));
        const entries = fromBundle(opened.key, opened.bundle);
        setTables((all) => ({ ...all, ...entries }));
        setBundles((all) => ({ ...all, [opened.key]: opened.bundle.meta }));
        const first = Object.keys(entries)[0]!;
        showMade(first, entries[first]!.views[0]?.id ?? "");
        // What was skipped, and a failure, in the words the web and Linux use (table-app).
        const skipped = importSkippedText(opened);
        if (skipped) showProblem(skipped.heading, skipped.body);
      } catch (error) {
        showProblem(openFailedText(where.split("/").pop() ?? where, error), "");
      }
    },
    [bundles, showMade, showProblem],
  );

  // Open a .table folder and show its first table; one already open is shown again.
  const openFolder = useCallback(
    async (path: string | null) => {
      if (!path) return;
      const held = Object.entries(folders.paths).find(([, p]) => p === path)?.[0];
      const library = held ? null : await folders.open([path]);
      for (const [key, messages] of Object.entries(library?.problems ?? {}))
        showProblem(`Problems reading ${key}.table`, messages.join("\n"));
      const key = held ?? Object.keys(library?.paths ?? {})[0];
      const first = key ? (library ? Object.keys(library.tables) : Object.keys(tables)).find((t) => bundleOf(t) === key) : undefined;
      if (first) {
        setActiveTablePath(first);
        setQuery("");
        setActiveBodyRowId(null);
      }
    },
    [folders, showProblem, tables],
  );
  const [query, setQuery] = useState<string>("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);
  const [showViewSettings, setShowViewSettings] = useState(false);
  // Which files are folded in the sidebar, kept as the web keeps them.
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPrefs>(() => loadSidebarPrefs(store));
  // The Display panel, open or not, kept with the sidebar prefs as the web keeps
  // its Display group's fold. Open only when unfolded by choice: on the Mac it
  // opens in the main area, so it starts closed.
  const showDisplay = sidebarPrefs.foldedDisplay === false;
  const toggleDisplay = useCallback(
    () =>
      setSidebarPrefs((prefs) => {
        const next = { ...prefs, foldedDisplay: prefs.foldedDisplay !== false ? false : true };
        saveSidebarPrefs(store, next);
        return next;
      }),
    [store],
  );
  const toggleFile = useCallback(
    (bundle: string) =>
      setSidebarPrefs((prefs) => {
        const folded = prefs.foldedFiles ?? [];
        const next = {
          ...prefs,
          foldedFiles: folded.includes(bundle) ? folded.filter((b) => b !== bundle) : [...folded, bundle],
        };
        saveSidebarPrefs(store, next);
        return next;
      }),
    [store],
  );
  // The sidebar hidden, kept with the other sidebar prefs as the web keeps it.
  const sidebarCollapsed = sidebarPrefs.collapsed === true;
  // A narrow window (the web's breakpoint) hides the sidebar on its own, as
  // a Mac sidebar collapses, without touching that choice: widening again
  // brings back what was chosen. ⌘B while narrow shows it anyway, until
  // the window next narrows. The window's width, not the screen's
  // (useWindowDimensions is the screen on macOS), from the root's layout.
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const narrow = windowWidth !== null && windowWidth <= NARROW_AT_MOST;
  const [shownWhileNarrow, setShownWhileNarrow] = useState(false);
  useEffect(() => {
    if (narrow) setShownWhileNarrow(false);
  }, [narrow]);
  const sidebarShown = narrow ? shownWhileNarrow : !sidebarCollapsed;
  const toggleSidebar = useCallback(() => {
    if (narrow) return setShownWhileNarrow((shown) => !shown);
    setSidebarPrefs((prefs) => {
      const { collapsed: _was, ...rest } = prefs;
      const next = prefs.collapsed ? rest : { ...rest, collapsed: true };
      saveSidebarPrefs(store, next);
      return next;
    });
  }, [store, narrow]);
  const filesMode = sidebarPrefs.files === true;
  const setFilesMode = useCallback(
    (files: boolean) =>
      setSidebarPrefs((prefs) => {
        const { files: _was, ...rest } = prefs;
        const next = files ? { ...rest, files } : rest;
        saveSidebarPrefs(store, next);
        return next;
      }),
    [store],
  );
  // Files mode: the folders opened or closed by hand, and the file shown in place of the view.
  const [openedDirs, setOpenedDirs] = useState<Record<string, boolean>>({});
  const [shownFile, setShownFile] = useState<{ bundle: string; path: string } | null>(null);
  // Attachments of tables opened from disk, as their folders list them; fixtures' come with the app.
  const [diskAttachments, setDiskAttachments] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!filesMode) return;
    let cancelled = false;
    const keys = Object.keys(tables).filter((key) => folders.paths[bundleOf(key)]);
    void Promise.all(
      keys.map(async (key) => {
        const dir = joinPath(folders.paths[bundleOf(key)]!, "tables", tableNameOf(key), "attachments");
        const entries = await desktopFs.list(dir).catch(() => null);
        return [key, (entries ?? []).filter((e) => !e.directory).map((e) => e.name)] as const;
      }),
    ).then((listed) => {
      if (!cancelled) setDiskAttachments(Object.fromEntries(listed));
    });
    return () => {
      cancelled = true;
    };
  }, [filesMode, tables, folders.paths]);
  const attachmentsOf = useCallback(
    (key: string) => (folders.paths[bundleOf(key)] ? diskAttachments[key] ?? [] : fixtureAttachments(key)),
    [folders.paths, diskAttachments],
  );
  const files = useMemo(
    () =>
      filesMode
        ? filesTree(tables, bundles, {
            folded: sidebarPrefs.foldedFiles ?? [],
            activeTable: activeTablePath,
            opened: openedDirs,
            attachmentsOf,
          }).map((b) => ({ ...b, name: folders.paths[b.bundle] ? `${folders.paths[b.bundle]!.split("/").pop()}/` : b.name }))
        : [],
    [filesMode, tables, bundles, sidebarPrefs.foldedFiles, activeTablePath, openedDirs, attachmentsOf, folders.paths],
  );
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
      content: attachment ? undefined : fileText(tables, bundles, shownFile.bundle, shownFile.path),
      url: attachment ? attachmentUrl(attachment.tableKey, attachment.name, folders.paths) : undefined,
    };
  }, [shownFile, files, tables, bundles, folders.paths]);

  // This viewer's own filters, sorts and grouping, over the saved views
  // (D4, D41), as on the web; a sort of their own follows their language.
  const [arrangements, setArrangements] = useState<Arrangements>(() => loadArrangements(store));
  useEffect(() => {
    // Only views that still exist: a deleted view's arrangement goes with it.
    saveArrangements(store, forViews(arrangements, tables));
  }, [store, arrangements, tables]);
  // This viewer's language, default date format and formula syntax: theirs,
  // not the tables' (SPEC section 4), kept as the web keeps them. The layout
  // reads the way the language does (D40): the chosen one, or the system's.
  const [display, setDisplay] = useState<DisplaySettings>(() => loadDisplay(store));
  const systemLocale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);
  const locale = display.locale ?? systemLocale;
  const direction = textDirection(locale);
  const shownDisplay = useMemo(() => ({ ...display, direction }), [display, direction]);
  const changeDisplay = useCallback(
    (next: DisplaySettings) => {
      setDisplay(next);
      saveDisplay(store, next);
    },
    [store],
  );
  // A sort of the viewer's own follows their language.
  const viewerText = useMemo(() => new Intl.Collator(locale, { numeric: true }).compare, [locale]);

  // The table on screen; the first held when it's gone (NO_TABLE only if none is held at all).
  const table = tables[activeTablePath] ?? tables[firstTableKey(tables) ?? ""] ?? NO_TABLE;
  useEffect(() => {
    const first = firstTableKey(tables);
    if (!tables[activeTablePath] && first) setActiveTablePath(first);
  }, [tables, activeTablePath]);
  // Opening a table unfolds its file, so the sidebar always shows where you are.
  const activeBundle = bundleOf(activeTablePath);
  useEffect(() => {
    setSidebarPrefs((prefs) => {
      const next = withFileUnfolded(prefs, activeBundle);
      if (next !== prefs) saveSidebarPrefs(store, next);
      return next;
    });
  }, [activeBundle, store]);
  const activeViewId = activeViewIds[activeTablePath] ?? table.views[0]?.id ?? "";
  // Back and forward between views (table-app's history): each view shown is
  // recorded by its address; going back or forward skips ones since deleted.
  const [history, setHistory] = useState<History>(NO_HISTORY);
  const shownViewId = table.views.some((v) => v.id === activeViewId) ? activeViewId : (table.views[0]?.id ?? "");
  const here = viewAddress(activeTablePath, shownViewId);
  useEffect(() => setHistory((h) => visited(h, here)), [here]);
  const live = useCallback((address: string) => addressLive(address, tables, bundles), [tables, bundles]);
  const go = useCallback(
    (step: typeof goBack) => {
      const moved = step(history, live);
      const target = moved && addressTarget(moved.address, tables, bundles, "");
      if (!moved || !target) return;
      setHistory(moved.history);
      setActiveTablePath(target.key);
      if (target.viewId) setActiveViewIds((prev) => ({ ...prev, [target.key]: target.viewId! }));
      setActiveBodyRowId(null);
      setShownFile(null);
    },
    [history, live, tables, bundles],
  );

  const setActiveViewId = useCallback(
    (viewId: string) => setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: viewId })),
    [activeTablePath],
  );

  // Every change goes through the shared edits (table-app), as on the web
  // and Linux, so a .table is changed the same way on every platform.
  const edit = useCallback(
    (change: (t: ParsedTable) => ParsedTable) => setTables((all) => onTable(all, activeTablePath, change)),
    [activeTablePath],
  );

  // A relation click or deep link: the same resolution as the web app.
  const openRelation = useCallback(
    (address: string) => {
      const target = addressTarget(address, tables, bundles, bundleOf(activeTablePath));
      if (!target) return;
      setActiveTablePath(target.key);
      if (target.viewId) setActiveViewIds((prev) => ({ ...prev, [target.key]: target.viewId! }));
      setActiveBodyRowId(target.openBody);
    },
    [tables, bundles, activeTablePath],
  );

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => edit((t) => withCell(t, rowId, fieldName, value)),
    [edit],
  );
  // An attachment is a file in its table's attachments/ (SPEC section 6),
  // so a table needs a folder on disk to take one: the file chosen is copied
  // there under a name no other attachment has, and the cell names it.
  // `source` skips the panel.
  const attachFile = useCallback(
    async (rowId: string, fieldName: string, source?: string) => {
      const folder = folders.paths[bundleOf(activeTablePath)];
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
        updateRow(rowId, fieldName, name);
      } catch (error) {
        showProblem("Couldn't attach the file", error instanceof Error ? error.message : String(error));
      }
    },
    [folders.paths, activeTablePath, showProblem, updateRow],
  );
  const updateField = useCallback(
    (fieldName: string, patch: Partial<Field>) => edit((t) => withFieldPatch(t, fieldName, patch)),
    [edit],
  );
  const addEnumValue = useCallback(
    (fieldName: string, value: string) => edit((t) => withChoice(t, fieldName, value)),
    [edit],
  );
  const moveField = useCallback(
    (fieldName: string, delta: -1 | 1) => edit((t) => withFieldMoved(t, fieldName, delta)),
    [edit],
  );
  const addField = useCallback((field: Field) => edit((t) => withField(t, field, activeViewId)), [edit, activeViewId]);
  const addRow = useCallback(() => {
    const id = newId();
    edit((t) => withRow(t, id));
    return id;
  }, [edit]);
  const insertRow = useCallback(
    (anchor: string, where: "above" | "below") => edit((t) => withRowAt(t, activeViewId, anchor, where, newId())),
    [edit, activeViewId],
  );
  const deleteRow = useCallback(
    (rowId: string) => {
      const { prompt, closeBody } = deletingRow(table, rowId, activeBodyRowId);
      ask(prompt, (response) => {
        if (response !== "delete") return;
        edit((t) => withoutRow(t, rowId));
        if (closeBody) setActiveBodyRowId(null);
      });
    },
    [edit, table, activeBodyRowId],
  );
  const updateBody = useCallback(
    (rowId: string, content: string) => edit((t) => withBody(t, rowId, content)),
    [edit],
  );
  const updateActiveView = useCallback(
    (patch: Partial<View>) => edit((t) => withViewPatch(t, activeViewId, patch)),
    [edit, activeViewId],
  );
  // A new view starts as a plain table of everything, with its settings open.
  const addView = useCallback(() => {
    const made = newView();
    edit((t) => withView(t, made));
    keepSettingsOpen.current = true;
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: made.id }));
    setShowViewSettings(true);
  }, [edit, activeTablePath]);

  const deleteView = useCallback(() => {
    const viewId = activeViewId;
    const view = table.views.find((v) => v.id === viewId);
    // The same question the web asks (table-app); null when it's the last view.
    const deleting = view ? deletingView(tables, activeTablePath, view) : null;
    if (!deleting) return;
    ask(deleting.prompt, (response) => {
      if (response !== "delete") return;
      edit((t) => withoutView(t, viewId));
      setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: deleting.nextViewId }));
      setShowViewSettings(false);
    });
  }, [activeViewId, activeTablePath, edit, table, tables]);
  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  // The menu bar: table-app's commands, each with ⌘ (and ⇧) on its key, in
  // File before Close and in View before Enter Full Screen. Choosing one,
  // or pressing its key wherever focus is, does what its button does.
  const chooseFilesMode = useCallback(
    (on: boolean) => {
      if (!on) setShownFile(null);
      setFilesMode(on);
    },
    [setFilesMode],
  );
  useEffect(() => {
    const state = {
      sidebarCollapsed: !sidebarShown,
      filesMode,
      canGoBack: canGoBack(history, live),
      canGoForward: canGoForward(history, live),
    };
    for (const c of appCommands(state)) {
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
  }, [sidebarShown, filesMode, history, live]);
  const commands: Record<AppCommandId, () => void> = {
    "new-file": () => askName(namePrompt({ kind: "file" }, bundles), createFile),
    "open-folder": () => void chooseFolder("Choose a .table folder to open").then(openFolder),
    "open-zip": () => void importZip(),
    "export-zip": () => void exportZip(),
    "toggle-sidebar": toggleSidebar,
    "tables-mode": () => chooseFilesMode(false),
    "files-mode": () => chooseFilesMode(true),
    "go-back": () => go(goBack),
    "go-forward": () => go(goForward),
    // The view's address as text, with the open document's row as the web's address has it;
    // opening one from outside the app waits on a link scheme.
    "copy-link": () => copyText(viewAddress(activeTablePath, shownViewId, activeBodyRowId ?? undefined)),
  };
  // The latest handlers, so the subscription is made once.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => onMenu((id) => commandsRef.current[id as AppCommandId]?.()), []);

  // Development only: lets a script open a table and view through
  // React Native's debugger connection, to check each layout without
  // clicking. Not in release builds (__DEV__ is false there).
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __tableDesktop?: unknown }).__tableDesktop = {
      tables: () => Object.keys(tables),
      show: (key: string, viewId?: string) => {
        if (!tables[key]) return `no table ${key}`;
        setActiveTablePath(key);
        if (viewId) setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
        setQuery("");
        setActiveBodyRowId(null);
        return `showing ${key}${viewId ? ` / ${viewId}` : ""}`;
      },
      settings: (open: boolean) => {
        setShowViewSettings(open);
        return open ? "settings open" : "settings closed";
      },
      arrange: (key: string, viewId: string, patch: Partial<View>) => {
        setArrangements((all) => arrange(all, key, viewId, patch));
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
      folders: () => folders.paths,
      // What the New buttons do once a name is given (the prompt can't be typed into from here).
      newTable: (title: string) => {
        createTable(title);
        return `made table ${title}`;
      },
      newFile: (title: string) => {
        createFile(title);
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
        addView();
        return "made view";
      },
      // Set display settings, as the Display controls will.
      display: (next: DisplaySettings) => {
        changeDisplay(next);
        return "display set";
      },
      attachmentUrl: (key: string, file: string) => attachmentUrl(key, file, folders.paths) ?? null,
      // The sidebar, as its button does; and a key pressed as if typed (⌘B is postKey("b", 11, ["command"])).
      sidebar: () => {
        toggleSidebar();
        return "sidebar toggled";
      },
      postKey: (characters: string, keyCode: number, modifiers: ("command" | "shift" | "option" | "control")[]) => {
        postKey(characters, keyCode, modifiers);
        return `posted ${modifiers.join("+")}+${characters}`;
      },
      menuTitles,
      history: () => history,
      // The window's width, as dragging its edge would set it; and what the sidebar is doing.
      resize: (width: number) => {
        resizeWindow(width);
        return `resizing to ${width}`;
      },
      sidebarState: () => ({ windowWidth, narrow, shownWhileNarrow, chosenCollapsed: sidebarCollapsed, shown: sidebarShown }),
      // The reset, as if Reset were chosen in its alert (the alert itself can't be pressed from a script).
      reset: () => `reset; kept ${doReset().join(", ") || "no folders"}`,
      resetPrompt: () => resetDemo(),
      // Files mode, as the sidebar's switch, folders and files do.
      files: (on: boolean) => {
        if (!on) setShownFile(null);
        setFilesMode(on);
        return `files mode ${on}`;
      },
      toggleDir: (bundle: string, path: string, open: boolean) => {
        setOpenedDirs((o) => ({ ...o, [`${bundle}/${path}`]: open }));
        return `${bundle}/${path} ${open ? "open" : "closed"}`;
      },
      showFile: (bundle: string | null, path?: string) => {
        setShownFile(bundle && path ? { bundle, path } : null);
        return bundle ? `showing ${bundle}/${path}` : "back to the view";
      },
      // Forget saved edits, opened folders, arrangements and the sidebar's folds; the next launch starts from the fixtures.
      clearSaved: () => {
        clearSaved(store);
        store?.removeItem(OPENED_KEY);
        store?.removeItem(ARRANGEMENTS_KEY);
        store?.removeItem(SIDEBAR_KEY);
        return "saved edits, opened folders, arrangements and sidebar forgotten";
      },
    };
  }, [store, tables, openFolder, folders.paths, changeDisplay, createTable, createFile, addView, exportZip, importZip, attachFile, setFilesMode, toggleSidebar, doReset, resetDemo, windowWidth, narrow, shownWhileNarrow, sidebarCollapsed, sidebarShown, history]);

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0] ?? NO_TABLE.views[0]!;
  // Hint wording, shared with the web and Linux (table-app's commands).
  const commandOf = (id: AppCommandId) =>
    appCommands({ sidebarCollapsed: !sidebarShown, filesMode }).find((c) => c.id === id)!;
  // Whatever changes the view on screen (the sidebar, a relation, an
  // address, Back or Forward), its search and settings go with it (table-app's
  // leaving); choosing the view already there changes nothing. A new view
  // is the exception: it opens on its settings.
  const onScreen = useRef({ key: activeTablePath, viewId: view.id });
  const keepSettingsOpen = useRef(false);
  useEffect(() => {
    const from = onScreen.current;
    onScreen.current = { key: activeTablePath, viewId: view.id };
    const left = leaving(from.key, from.viewId, activeTablePath, view.id);
    if (left.clearSearch) setQuery("");
    if (left.closeSettings && !keepSettingsOpen.current) setShowViewSettings(false);
    keepSettingsOpen.current = false;
  }, [activeTablePath, view.id]);
  // The view's rows and a Sheet view's saved grid, worked out as on the web (table-app).
  const sheet = useMemo(() => sheetShown(tables, activeTablePath, view), [tables, activeTablePath, view]);
  const personal = arrangements[activeTablePath]?.[view.id];
  const { view: shownView, rows: visibleRows, inView } = showView(tables, activeTablePath, view, {
    arrangement: personal,
    search: query,
    viewerText,
  });
  const inBundle = bundleTables(tables, bundleOf(activeTablePath));
  const summary = viewSummary(table, {
    shown: visibleRows.length,
    inView,
    searching: query.trim().length > 0,
    openedAt: INITIAL_SCHEMA_VERSIONS[activeTablePath],
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={(e) => setWindowWidth(e.nativeEvent.layout.width)}>
      <AttachmentsProvider value={(file) => attachmentUrl(activeTablePath, file, folders.paths)}>
      <PortalHost>
        <DisplaySettingsProvider value={shownDisplay}>
        <html.div dir={direction} style={styles.root}>
          {sidebarShown && (
            <Sidebar
              tree={sidebarTree(tables, bundles, {
                folded: sidebarPrefs.foldedFiles ?? [],
                expanded: [activeTablePath],
                active: { key: activeTablePath, viewId: activeViewId },
              }).map((file) => ({
                ...file,
                // A folder opened from disk goes by its own name.
                file: folders.paths[file.bundle]?.split("/").pop() ?? file.file,
              }))}
              onToggleFile={toggleFile}
              filesMode={filesMode}
              onFilesMode={chooseFilesMode}
              files={flattenFilesTree(files)}
              onToggleDir={(bundle, path, open) => setOpenedDirs((o) => ({ ...o, [`${bundle}/${path}`]: open }))}
              shownFile={shownFile}
              onShowFile={(bundle, path) => setShownFile({ bundle, path })}
              onSelectTable={(key) => {
                setShownFile(null);
                setActiveTablePath(key);
                setActiveBodyRowId(null);
              }}
              onSelectView={(key, viewId) => {
                setShownFile(null);
                setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
              }}
              onNewTable={() => askName(namePrompt({ kind: "table", bundle: bundleOf(activeTablePath) }, bundles), createTable)}
              onNewView={addView}
              footer={[
                { label: "New .table…", onPress: () => askName(namePrompt({ kind: "file" }, bundles), createFile) },
                { label: "Open .table…", onPress: () => void chooseFolder("Choose a .table folder to open").then(openFolder) },
                { label: "Open .table.zip…", onPress: () => void importZip() },
                { label: "Display", onPress: toggleDisplay, active: showDisplay },
                { label: "Reset demo data…", onPress: resetDemo },
              ]}
            />
          )}
          <html.div style={styles.content}>
            {shown ? (
              <FileView {...shown} onClose={() => setShownFile(null)} />
            ) : (
            <>
            {/* Where this view is: its file and its table (D37); an opened folder by its own name. */}
            <html.span style={styles.breadcrumb}>
              {tableBreadcrumb(activeTablePath, tables, bundles, folders.paths[bundleOf(activeTablePath)]?.split("/").pop()).text}
            </html.span>
            <html.div style={styles.titleRow}>
              <Hinted hint={hintWithShortcut(commandOf("toggle-sidebar"), "mac")}>
                <html.button
                  aria-label={sidebarShown ? "Hide the sidebar" : "Show the sidebar"}
                  aria-expanded={sidebarShown}
                  onClick={toggleSidebar}
                  style={styles.sidebarTrigger}
                >
                  ◧
                </html.button>
              </Hinted>
              <html.span style={styles.title}>{view.name}</html.span>
            </html.div>
            <html.div style={styles.subtitle}>
              <html.span>{summary.count}</html.span>
              <html.span>·</html.span>
              {/* Hover for the errors, or the rule they'd break: the system tooltip. */}
              <Hinted hint={summary.validityHint} style={summary.valid ? styles.validityOk : styles.validityBad}>
                {summary.validity}
              </Hinted>
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
            {/* The view's own actions; the tables, views and files are in the sidebar. */}
            <html.div style={styles.toolbar}>
              <Tip text={TOOLBAR_HINTS.viewSettings}>
                <html.button
                  onClick={() => setShowViewSettings((open) => !open)}
                  style={[styles.tab, showViewSettings && styles.tabActive]}
                >
                  View settings
                </html.button>
              </Tip>
              <Tip text={hintWithShortcut(commandOf("export-zip"), "mac")}>
                <html.button onClick={() => void exportZip()} style={styles.tab}>
                  Export .table.zip…
                </html.button>
              </Tip>
            </html.div>
            <html.input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e: { target: { value: string } }) => setQuery(e.target.value)}
              style={styles.searchInput}
            />
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator
            >
              {/* The viewer's own language, dates and formula syntax: the web's Display group. */}
              {showDisplay && (
                <html.div style={styles.displayPanel}>
                  <DisplayControls
                    rows={displayChoices(display, systemLocale, "System")}
                    onChoose={(kind, value) => changeDisplay(withDisplayChoice(display, kind, value))}
                  />
                </html.div>
              )}
              {/* Scrolls with the view: above it, a tall panel squeezed every control into the window. */}
              {showViewSettings && (
                <ViewSettings
                  key={view.id}
                  view={shownView}
                  schema={table.schema}
                  onChange={(patch) => {
                    // Turning a Sheet view into anything else loses its grid (D41).
                    const prompt = viewPatchPrompt(tables, activeTablePath, view, patch);
                    if (!prompt) return updateActiveView(patch);
                    ask(prompt, (response) => {
                      if (response === "stop") updateActiveView(patch);
                    });
                  }}
                  onArrange={(patch) => setArrangements((all) => arrange(all, activeTablePath, view.id, patch))}
                  personal={isArranged(personal)}
                  onSaveForEveryone={() => {
                    const saving = savingForEveryone(arrangements, activeTablePath, view.id);
                    updateActiveView(saving.patch);
                    setArrangements(saving.arrangements);
                  }}
                  onReset={() => setArrangements((all) => resetArrangement(all, activeTablePath, view.id))}
                  onDelete={table.views.length > 1 ? deleteView : undefined}
                  onClose={() => setShowViewSettings(false)}
                />
              )}
              {renderView(shownView, visibleRows, table.schema, table.bodies, {
                onUpdateRow: updateRow,
                onUpdateField: updateField,
                onAddEnumValue: addEnumValue,
                onMoveField: moveField,
                onAddField: addField,
                onAddRow: addRow,
                onDeleteRow: deleteRow,
                onOpenBody: openBody,
                onUpdateView: updateActiveView,
                relatedTables: inBundle,
                onOpenRelation: openRelation,
                allRows: table.rows,
                tableKey: tableNameOf(activeTablePath),
                sheet,
                onInsertRow: isSheet(view) && canInsertAt(view) ? insertRow : undefined,
                onAttachFile: attachFile,
              })}
            </ScrollView>
            </>
            )}
          </html.div>
          {activeBodyRowId && (
            <BodyEditor
              rowId={activeBodyRowId}
              rowTitle={rowTitleFor(table, activeBodyRowId)}
              content={table.bodies?.[activeBodyRowId] ?? ""}
              onSave={(content) => updateBody(activeBodyRowId, content)}
              onClose={closeBody}
            />
          )}
        </html.div>
        </DisplaySettingsProvider>
      </PortalHost>
      </AttachmentsProvider>
    </GestureHandlerRootView>
  );
}
