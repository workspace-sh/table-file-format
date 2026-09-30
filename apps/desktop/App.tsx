import { useCallback, useEffect, useMemo, useState } from "react";
import { html, css } from "react-strict-dom";
import { ScrollView } from "react-native";
// Gesture handler root view enables RNGH's native gesture recognizers
// for the entire subtree. Required once per app at the root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Alert } from "react-native";
import { newId, parseAddress, textDirection, validate } from "@workspace.sh/table-core";
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
  DisplaySettingsProvider,
  type DisplaySettings,
  PortalHost,
  TableView,
  ViewSettings,
  canInsertAt,
  sheetDependents,
} from "@workspace.sh/table-ui";
import {
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  SIDEBAR_KEY,
  loadSidebarPrefs,
  saveSidebarPrefs,
  sidebarTree,
  type SidebarPrefs,
  displayChoices,
  withDisplayChoice,
  newView,
  withNewFile,
  withNewTable,
  withView,
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
  savedPatch,
  withoutView,
  deleteViewPrompt,
  type Arrangements,
  bundleOf,
  bundleTables,
  fromBundle,
  keyForAddress,
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
} from "@workspace.sh/table-app";
import { isSheet } from "@workspace.sh/table-core";
import { openStore } from "./nativeStore";
import { checkFs } from "./fsCheck";
import { OPENED_KEY, useFolders } from "./folders";
import { chooseFile, chooseFolder, choosePath } from "./panels";
import { readBytes, writeBytes } from "./bytes";
import { Sidebar } from "./Sidebar";
import { attachmentUrl } from "./attachments";

// Every fixture bundle's tables, keyed `bundle/table` (D37), as the web and
// Linux apps hold them, and each bundle's manifest.
const initialTables: Record<string, ParsedTable> = Object.assign(
  {},
  ...Object.entries(fixtureBundles).map(([name, b]) => fromBundle(name, b)),
);
const bundleMetas: Record<string, BundleMeta> = Object.fromEntries(
  Object.entries(fixtureBundles).map(([name, b]) => [name, b.meta]),
);
const DEFAULT_TABLE_PATH = "projects/projects";
const INITIAL_SCHEMA_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.entries(initialTables).map(([key, t]) => [
    key,
    (t.schema["schema-version"] as number | undefined) ?? 1,
  ]),
);

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
    color: {
      default: "#1f7a2c",
      "@media (prefers-color-scheme: dark)": "#7ee08a",
    },
  },
  validityBad: {
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
        />
      );
  }
}

/**
 * Ask for a name in the system's own text prompt (a sheet on the window);
 * `then` gets it trimmed, unless it's empty or the prompt is cancelled.
 * react-native-macos has Alert.promptMacOS, but not in its types.
 */
function askName(title: string, then: (name: string) => void) {
  const alert = Alert as unknown as {
    promptMacOS: (
      title: string,
      message: string | undefined,
      buttons: { text: string; style?: string; onPress?: (value?: string) => void }[],
      type?: string,
    ) => void;
  };
  alert.promptMacOS(title, undefined, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Create",
      onPress: (value) => {
        const name = (value ?? "").trim();
        if (name) then(name);
      },
    },
  ], "plain-text");
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
  const [activeTablePath, setActiveTablePath] = useState<string>(DEFAULT_TABLE_PATH);
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial.tables).map(([key, t]) => [key, t.views[0]?.id ?? ""])),
  );
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

  // Show what was just made: its first view, from the top.
  const showMade = useCallback((key: string, viewId: string) => {
    setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
    setActiveTablePath(key);
    setQuery("");
    setActiveBodyRowId(null);
  }, []);
  // A new table goes into the bundle on show, as a new sheet into a workbook (D37).
  const createTable = useCallback(
    (title: string) => {
      const made = withNewTable(tables, bundles, bundleOf(activeTablePath), title);
      setTables(made.tables);
      setBundles(made.bundles);
      showMade(made.key, made.viewId);
    },
    [tables, bundles, activeTablePath, showMade],
  );
  // A new .table: a bundle holding one new table.
  const createFile = useCallback(
    (title: string) => {
      const made = withNewFile(tables, bundles, title);
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
        if (opened.skipped.length > 0) {
          const n = opened.skipped.length;
          showProblem(
            `Opened "${opened.bundle.meta.title ?? opened.key}", but skipped ${n} ${n === 1 ? "thing" : "things"} it couldn't read`,
            opened.skipped.join("\n"),
          );
        }
      } catch (error) {
        showProblem(`Couldn't open ${where.split("/").pop()}`, error instanceof Error ? error.message : String(error));
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
  const [showDisplay, setShowDisplay] = useState(false);
  // Which files are folded in the sidebar, kept as the web keeps them.
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPrefs>(() => loadSidebarPrefs(store));
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

  const table = tables[activeTablePath]!;
  const activeViewId = activeViewIds[activeTablePath] ?? table.views[0]?.id ?? "";

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
      const addr = parseAddress(address);
      if (!addr) return;
      const key = keyForAddress(addr, tables, bundles, bundleOf(activeTablePath));
      if (!key) return;
      setActiveTablePath(key);
      if (addr.viewId) setActiveViewIds((prev) => ({ ...prev, [key]: addr.viewId! }));
      setActiveBodyRowId(addr.rowId && tables[key]?.bodies?.[addr.rowId] ? addr.rowId : null);
    },
    [tables, activeTablePath],
  );

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => edit((t) => withCell(t, rowId, fieldName, value)),
    [edit],
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
      const hasBody = table.bodies?.[rowId] !== undefined;
      Alert.alert(`Delete "${rowTitleFor(table, rowId)}"?`, hasBody ? "Its document goes too." : undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => edit((t) => withoutRow(t, rowId)) },
      ]);
    },
    [edit, table],
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
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: made.id }));
    setShowViewSettings(true);
  }, [edit, activeTablePath]);

  const deleteView = useCallback(() => {
    const viewId = activeViewId;
    const view = table.views.find((v) => v.id === viewId);
    // The same question the web asks (table-app); null when it's the last view.
    const prompt = view ? deleteViewPrompt(tables, activeTablePath, view) : null;
    if (!prompt) return;
    Alert.alert(
      prompt.heading,
      prompt.body,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const next = table.views.find((v) => v.id !== viewId)?.id ?? "";
            edit((t) => withoutView(t, viewId));
            setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: next }));
            setShowViewSettings(false);
          },
        },
      ],
    );
  }, [activeViewId, activeTablePath, edit, table, tables]);
  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

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
      // Forget saved edits, opened folders, arrangements and the sidebar's folds; the next launch starts from the fixtures.
      clearSaved: () => {
        clearSaved(store);
        store?.removeItem(OPENED_KEY);
        store?.removeItem(ARRANGEMENTS_KEY);
        store?.removeItem(SIDEBAR_KEY);
        return "saved edits, opened folders, arrangements and sidebar forgotten";
      },
    };
  }, [store, tables, openFolder, folders.paths, changeDisplay, createTable, createFile, addView, exportZip, importZip]);

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0]!;
  // The view's rows and a Sheet view's saved grid, worked out as on the web (table-app).
  const sheet = useMemo(() => sheetShown(tables, activeTablePath, view), [tables, activeTablePath, view]);
  const personal = arrangements[activeTablePath]?.[view.id];
  const { view: shownView, rows: visibleRows, inView } = showView(tables, activeTablePath, view, {
    arrangement: personal,
    search: query,
    viewerText,
  });
  const inBundle = bundleTables(tables, bundleOf(activeTablePath));
  const errors = validate(table.schema, table.rows);
  const searching = query.trim().length > 0;
  const currentSchemaVersion = (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped = currentSchemaVersion > (INITIAL_SCHEMA_VERSIONS[activeTablePath] ?? 1);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AttachmentsProvider value={(file) => attachmentUrl(activeTablePath, file, folders.paths)}>
      <PortalHost>
        <DisplaySettingsProvider value={shownDisplay}>
        <html.div dir={direction} style={styles.root}>
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
            onSelectTable={(key) => {
              setActiveTablePath(key);
              setQuery("");
              setActiveBodyRowId(null);
            }}
            onSelectView={(key, viewId) => {
              setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
              setShowViewSettings(false);
            }}
            onNewTable={() => askName("Name the new table", createTable)}
            onNewView={addView}
            footer={[
              { label: "New .table…", onPress: () => askName("Name the new .table file", createFile) },
              { label: "Open .table…", onPress: () => void chooseFolder("Choose a .table folder to open").then(openFolder) },
              { label: "Open .table.zip…", onPress: () => void importZip() },
              { label: "Display", onPress: () => setShowDisplay((open) => !open), active: showDisplay },
            ]}
          />
          <html.div style={styles.content}>
            <html.span style={styles.title}>{view.name}</html.span>
            <html.div style={styles.subtitle}>
              <html.span>
                {searching
                  ? `${visibleRows.length} of ${inView} matching`
                  : `${visibleRows.length} of ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`}
              </html.span>
              <html.span>·</html.span>
              <html.span
                style={errors.length === 0 ? styles.validityOk : styles.validityBad}
              >
                {errors.length === 0
                  ? "schema valid"
                  : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`}
              </html.span>
              {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
              {schemaBumped && (
                <html.span style={styles.schemaBumpBadge}>
                  schema changed
                </html.span>
              )}
            </html.div>
            {/* The view's own actions; the tables, views and files are in the sidebar. */}
            <html.div style={styles.toolbar}>
              <html.button
                onClick={() => setShowViewSettings((open) => !open)}
                style={[styles.tab, showViewSettings && styles.tabActive]}
              >
                View settings
              </html.button>
              <html.button onClick={() => void exportZip()} style={styles.tab}>
                Export .table.zip…
              </html.button>
            </html.div>
            <html.input
              type="text"
              placeholder="Search..."
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
                    const readers =
                      isSheet(view) && !isSheet({ ...view, ...patch })
                        ? sheetDependents(inBundle, tableNameOf(activeTablePath), view.id).length
                        : 0;
                    if (readers === 0) return updateActiveView(patch);
                    Alert.alert(
                      `${readers === 1 ? "A formula reads" : `${readers} formulas read`} this sheet by place and will show #REF!.`,
                      "Stop showing it as a sheet?",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Stop", style: "destructive", onPress: () => updateActiveView(patch) },
                      ],
                    );
                  }}
                  onArrange={(patch) => setArrangements((all) => arrange(all, activeTablePath, view.id, patch))}
                  personal={isArranged(personal)}
                  onSaveForEveryone={() => {
                    updateActiveView(savedPatch(personal));
                    setArrangements((all) => resetArrangement(all, activeTablePath, view.id));
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
              })}
            </ScrollView>
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
