import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import {
  textDirection,
  isSheet,
  newId,
  parseAddress,
} from "@workspace.sh/table-core";
import type {
  Address,
  BundleMeta,
  Field,
  ParsedTable,
  Row,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import {
  AttachmentsProvider,
  BodyEditor,
  BoardView,
  DisplaySettingsProvider,
  Hinted,
  ViewSettings,
  CalendarView,
  GalleryView,
  ListView,
  TableView,
  canInsertAt,
  type DisplaySettings,
} from "@workspace.sh/table-ui";
import { attachmentUrls, bundles as initialBundles, tables as initialTables } from "./loadFixture";
import { schemaVersions, viewSummary } from "@workspace.sh/table-app";
import { addressTarget, afterReset, savingForEveryone, tableBreadcrumb } from "@workspace.sh/table-app";
import { DEFAULT_TABLE_KEY, firstTableKey, firstViews, leaving, withFileUnfolded } from "@workspace.sh/table-app";
import { appCommands, hintWithShortcut, TOOLBAR_HINTS, type AppCommandId } from "@workspace.sh/table-app";
import { attachmentShown, type AttachmentShown } from "@workspace.sh/table-app";
import { loadDisplay, saveDisplay } from "@workspace.sh/table-app";
import { viewPatchPrompt } from "@workspace.sh/table-app";
import { archiveFileName, bundleToArchive, openArchive } from "@workspace.sh/table-app";
import { attachmentAt, fileText } from "@workspace.sh/table-app";
import { bundleOf, bundleTables, fromBundle, keyForAddress, tableNameOf, toBundle } from "@workspace.sh/table-app";
import { creating, namePrompt, newView } from "@workspace.sh/table-app";
import { browserStore, clearSaved, loadSaved, save, withNewFixtures } from "@workspace.sh/table-app";
import { Sidebar, type ShownFile } from "./Sidebar";
import { FileView } from "./FileView";
import { addressInHash, useHashAddress } from "./useHashAddress";
import { useNarrow } from "./useNarrow";
import { loadSidebarPrefs, saveSidebarPrefs, type SidebarPrefs } from "@workspace.sh/table-app";
import {
  arrange,
  deletingRow,
  deletingView,
  confirmText,
  onTable,
  rowTitleFor,
  withBody,
  withCell,
  withChoice,
  withField,
  withFieldMoved,
  withFieldPatch,
  withoutRow,
  withoutView,
  withRow,
  withRowAt,
  withView,
  withViewPatch,
  sheetShown,
  showView,
  forViews,
  isArranged,
  loadArrangements,
  reset as resetArrangement,
  saveArrangements,
  type Arrangements,
} from "@workspace.sh/table-app";

const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "row",
    flex: 1,
    minHeight: "100vh",
  },
  main: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    // --page-gutter (strict.css), so what bleeds over it knows how far.
    paddingInline: "var(--page-gutter)",
    paddingBlock: 20,
    overflow: "auto",
  },
  /** Holds the sidebar at full width, or slides it to nothing when collapsed. */
  sidebarSlot: {
    display: "flex",
    flexShrink: 0,
    maxWidth: 320,
    overflow: "hidden",
    visibility: "visible",
    transitionProperty: "max-width, visibility",
    transitionDuration: "200ms",
    transitionTimingFunction: "ease",
  },
  sidebarSlotCollapsed: {
    maxWidth: 0,
    visibility: "hidden",
  },
  titleRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sidebarTrigger: {
    fontSize: 16,
    lineHeight: "16px",
    paddingInline: 6,
    paddingBlock: 4,
    borderRadius: 6,
    borderWidth: 0,
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": { default: "#ececf0", "@media (prefers-color-scheme: dark)": "#1f1f23" },
    },
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  mainNarrow: {
    paddingBlock: 12,
  },
  topBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  menuButton: {
    fontSize: 18,
    paddingInline: 10,
    paddingBlock: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#17171a" },
    color: { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" },
  },
  topBarTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" },
  },
  drawerBackdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 69,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  drawer: {
    position: "fixed",
    top: 0,
    // From the start side: the left, or the right in a right-to-left layout.
    insetInlineStart: 0,
    bottom: 0,
    zIndex: 70,
    display: "flex",
    // The sidebar is as tall as its contents, and the drawer scrolls it.
    // Stretched to the drawer's height instead, a long sidebar spilled
    // past its own background over the page.
    alignItems: "flex-start",
    overflowY: "auto",
    boxShadow: "0 0 32px rgba(0, 0, 0, 0.25)",
    backgroundColor: {
      default: "#fafafa",
      "@media (prefers-color-scheme: dark)": "#0a0a0c",
    },
  },
  searchNarrow: {
    width: "100%",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 16,
  },
  headerTopRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  /** Where the view lives: its .table file, then its table. */
  breadcrumb: {
    fontSize: 12,
    marginBottom: 2,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  subtitle: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    fontSize: 12,
    marginTop: 4,
    gap: 8,
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
  buttonOn: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  headerActions: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  downloadButton: {
    paddingInline: 10,
    paddingBlock: 6,
    fontSize: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  searchInput: {
    width: 240,
    paddingInline: 10,
    paddingBlock: 6,
    fontSize: 13,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 6,
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#17171a",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
    outlineStyle: "none",
  },
});

export function App() {
  // Edits survive a reload (#86): what was saved, or the fixtures when
  // nothing usable was.
  const [initial] = useState(() => {
    const fixtures = { tables: initialTables, bundles: initialBundles };
    const saved = loadSaved(browserStore());
    // Fixture tables added since this browser saved its edits still appear.
    return saved ? withNewFixtures(saved, fixtures) : fixtures;
  });
  const [tables, setTables] = useState<Record<string, ParsedTable>>(initial.tables);
  // Each bundle's manifest (D37): its title and the order of its tables.
  const [bundles, setBundles] = useState<Record<string, BundleMeta>>(initial.bundles);
  // Start where the address says, if it names a table here.
  const [start] = useState(() => {
    const addr = addressInHash();
    const key = addr ? keyForAddress(addr, initial.tables, initial.bundles, "") : null;
    return key ? { key, viewId: addr!.viewId } : null;
  });
  const [activeTablePath, setActiveTablePath] = useState<string>(() => start?.key ?? firstTableKey(tables) ?? DEFAULT_TABLE_KEY);
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(() => ({
    ...firstViews(tables),
    ...(start?.viewId ? { [start.key]: start.viewId } : {}),
  }));

  // Saved after every change. The fixtures themselves are never saved, so
  // an untouched demo keeps following them as they change.
  useEffect(() => {
    if (tables !== initialTables || bundles !== initialBundles) save(browserStore(), { tables, bundles });
  }, [tables, bundles]);

  const openKey = (key: string, viewId: string) => {
    setActiveViewIds((prev) => ({ ...prev, [key]: viewId }));
    setActiveTablePath(key);
    setSearchQuery("");
    setActiveBodyRowId(null);
  };

  // A new table goes into a bundle, as a new sheet goes into a workbook (D37).
  const createTable = useCallback(
    (bundle: string) => {
      const making = { kind: "table", bundle } as const;
      const made = creating(tables, bundles, making, window.prompt(namePrompt(making, bundles).heading));
      if (!made) return;
      setTables(made.tables);
      setBundles(made.bundles);
      openKey(made.key, made.viewId);
    },
    [tables, bundles],
  );

  // A new `.table` file: a bundle holding one new table.
  const createFile = useCallback(() => {
    const making = { kind: "file" } as const;
    const made = creating(tables, bundles, making, window.prompt(namePrompt(making, bundles).heading));
    if (!made) return;
    setTables(made.tables);
    setBundles(made.bundles);
    openKey(made.key, made.viewId);
  }, [tables, bundles]);

  // Download: the whole bundle as a real `.table.zip` (D27, D37), so the
  // tables it links together travel together.
  const downloadTable = useCallback(async () => {
    const bundle = bundleOf(activeTablePath);
    const bytes = await bundleToArchive(bundle, toBundle(tables, bundles, bundle));
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = archiveFileName(bundle);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [tables, bundles, activeTablePath]);

  // Open: a `.table.zip` becomes one more table here, saying what the
  // reader skipped (D25). Only a file with no table in it is refused.
  const openTableFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const opened = await openArchive(new Uint8Array(await file.arrayBuffer()), Object.keys(bundles));
        const entries = fromBundle(opened.key, opened.bundle);
        setTables((all) => ({ ...all, ...entries }));
        setBundles((all) => ({ ...all, [opened.key]: opened.bundle.meta }));
        const first = Object.keys(entries)[0]!;
        openKey(first, entries[first]!.views[0]?.id ?? "");
        if (opened.skipped.length > 0) {
          const n = opened.skipped.length;
          window.alert(
            `Opened "${opened.bundle.meta.title ?? opened.key}", but skipped ${n} ${n === 1 ? "thing" : "things"} it couldn't read:\n\n${opened.skipped.join("\n")}`,
          );
        }
      } catch (error) {
        window.alert(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    document.body.appendChild(input);
    input.click();
  }, [bundles]);

  const resetDemo = useCallback(() => {
    clearSaved(browserStore());
    // The web opens no folders from disk, so nothing is kept: the examples themselves.
    const after = afterReset(tables, bundles, { tables: initialTables, bundles: initialBundles }, []);
    setTables(after.tables);
    setBundles(after.bundles);
    setActiveTablePath(firstTableKey(initialTables) ?? DEFAULT_TABLE_KEY);
    setActiveViewIds(firstViews(initialTables));
    setShownFile(null);
    setSearchQuery("");
    setActiveBodyRowId(null);
  }, [tables, bundles]);
  const [searchQuery, setSearchQuery] = useState("");
  // This viewer's locale and default date format: theirs, not the tables'.
  const [display, setDisplay] = useState<DisplaySettings>(() => loadDisplay(browserStore()));
  // The layout reads the way the display language does (D40): the chosen
  // language, or the browser's. The whole page takes it, so popovers and
  // menus outside the app's root mirror too.
  const pageLocale = display.locale ?? (typeof navigator === "undefined" ? undefined : navigator.language);
  const direction = textDirection(pageLocale);
  const shown = useMemo(() => ({ ...display, direction }), [display, direction]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dir = direction;
    if (pageLocale) document.documentElement.lang = pageLocale;
  }, [direction, pageLocale]);
  const changeDisplay = useCallback((next: DisplaySettings) => {
    setDisplay(next);
    saveDisplay(browserStore(), next);
  }, []);
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);
  const [showViewSettings, setShowViewSettings] = useState(false);
  // How this viewer has filtered, sorted or grouped each view for
  // themselves (D4, D41), kept in this browser. A sort only they see
  // follows their language; a saved one is the same on every device.
  const [arrangements, setArrangements] = useState<Arrangements>(() => loadArrangements(browserStore()));
  const viewerText = useMemo(() => new Intl.Collator(pageLocale || undefined, { numeric: true }).compare, [pageLocale]);
  useEffect(() => {
    // Only views that still exist: a deleted view's arrangement goes with it.
    saveArrangements(browserStore(), forViews(arrangements, tables));
  }, [arrangements, tables]);
  // A file of a .table, opened from the Files side of the sidebar, shown
  // in place of the view until a view or table is chosen again.
  const [shownFile, setShownFile] = useState<ShownFile | null>(null);
  // At phone width the sidebar is a drawer, opened from the top bar.
  const narrow = useNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);
  // The sidebar collapses out of the way, as shadcn/ui's does: a trigger
  // in the header, or ⌘B / Ctrl+B. Its files and Display group fold too.
  // All of it is this viewer's, kept in this browser.
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPrefs>(() => loadSidebarPrefs(browserStore()));
  const updateSidebar = useCallback((patch: Partial<SidebarPrefs>) => {
    setSidebarPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveSidebarPrefs(browserStore(), next);
      return next;
    });
  }, []);
  const sidebarCollapsed = sidebarPrefs.collapsed === true;
  const toggleSidebar = useCallback(() => {
    if (narrow) setDrawerOpen((open) => !open);
    else updateSidebar({ collapsed: !sidebarCollapsed });
  }, [narrow, sidebarCollapsed, updateSidebar]);
  const toggleFile = useCallback(
    (bundle: string) => {
      const folded = sidebarPrefs.foldedFiles ?? [];
      updateSidebar({
        foldedFiles: folded.includes(bundle) ? folded.filter((b) => b !== bundle) : [...folded, bundle],
      });
    },
    [sidebarPrefs.foldedFiles, updateSidebar],
  );
  // Opening a table unfolds its file, so the sidebar always shows where
  // you are. Folding it again afterwards is still yours to do.
  const activeBundle = bundleOf(activeTablePath);
  useEffect(() => {
    const unfolded = withFileUnfolded(sidebarPrefs, activeBundle);
    if (unfolded !== sidebarPrefs) updateSidebar({ foldedFiles: unfolded.foldedFiles });
    // Only when the table on screen changes, not whenever a file is folded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBundle]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "b" || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      // In a text box, ⌘B belongs to the text.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // Going wide shows the sidebar in place; coming back narrow starts closed.
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);
  // While open: focus is in the drawer and Escape closes it. On close,
  // focus goes back to the button that opened it.
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      menuButtonRef.current?.focus();
    };
  }, [drawerOpen]);

  const table = tables[activeTablePath];
  if (!table) throw new Error(`Unknown table path: ${activeTablePath}`);
  const activeViewId = activeViewIds[activeTablePath] ?? table.views[0]?.id ?? "";
  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0];
  if (!view) throw new Error("table has no views");
  // Whatever changes the view on screen (the sidebar, a relation, an
  // address), its search and settings go with it (table-app's
  // leaving); choosing the view already there changes nothing. A new view
  // is the exception: it opens on its settings.
  const onScreen = useRef({ key: activeTablePath, viewId: view.id });
  const keepSettingsOpen = useRef(false);
  useEffect(() => {
    const from = onScreen.current;
    onScreen.current = { key: activeTablePath, viewId: view.id };
    const left = leaving(from.key, from.viewId, activeTablePath, view.id);
    if (left.clearSearch) setSearchQuery("");
    if (left.closeSettings && !keepSettingsOpen.current) setShowViewSettings(false);
    keepSettingsOpen.current = false;
  }, [activeTablePath, view.id]);
  // Hint wording, shared with macOS and Linux (table-app's commands).
  const commandOf = (id: AppCommandId) =>
    appCommands({ sidebarCollapsed, filesMode: sidebarPrefs.files === true }).find((c) => c.id === id)!;

  const setActiveViewId = useCallback(
    (viewId: string) =>
      setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: viewId })),
    [activeTablePath],
  );

  // Apply an Address to app state — shared between relation clicks
  // and URL-hash rehydration so both paths behave identically.
  const applyAddress = useCallback(
    (addr: Address) => {
      // A relation names a table alone, within its own bundle (D37); the
      // URL uses the spec's `crm.table#table=deals` form.
      const target = addressTarget(addr, tables, bundles, bundleOf(activeTablePath));
      // Not here: visible-broken at the cell level already; nothing more to do.
      if (!target) return;
      setActiveTablePath(target.key);
      if (target.viewId) setActiveViewIds((prev) => ({ ...prev, [target.key]: target.viewId! }));
      // A named row's document opens as a quick "row detail" surface; a row
      // without one just switches table (scroll-to is deferred).
      setActiveBodyRowId(target.openBody);
    },
    [tables, bundles, activeTablePath],
  );

  // Relation click → parse + apply.
  const openRelation = useCallback(
    (address: string) => {
      const addr = parseAddress(address);
      if (!addr) return;
      applyAddress(addr);
    },
    [applyAddress],
  );

  // Two-way URL-hash sync. Writes the current address on every nav
  // change; on browser back/forward (or a typed-in URL) parses the hash
  // and rehydrates state via the same path that handles in-app
  // relation clicks.
  useHashAddress({
    state: {
      tablePath: `${bundleOf(activeTablePath)}.table`,
      tableName: tableNameOf(activeTablePath),
      viewId: activeViewId,
      rowId: activeBodyRowId ?? undefined,
    },
    onExternalChange: applyAddress,
  });

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withCell(t, rowId, fieldName, value)));
    },
    [activeTablePath],
  );

  const updateBody = useCallback(
    (rowId: string, content: string) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withBody(t, rowId, content)));
    },
    [activeTablePath],
  );

  // A new row is just an id (D23); the view it lands in decides where it
  // shows, and a filter may hide it until its cells are filled in.
  // Returns the id, so the table can open the new row for typing.
  const addRow = useCallback(() => {
    const id = newId();
    setTables((all) => onTable(all, activeTablePath, (t) => withRow(t, id)));
    return id;
  }, [activeTablePath]);

  // A row at a place in a Sheet view (D41): file order is meaningful, so
  // it goes on the line above or below, or into the manual order.
  const insertRow = useCallback(
    (anchor: string, where: "above" | "below") => {
      setTables((all) => onTable(all, activeTablePath, (t) => withRowAt(t, activeViewId, anchor, where, newId())));
    },
    [activeTablePath, activeViewId],
  );

  const deleteRow = useCallback(
    (rowId: string) => {
      const { prompt, closeBody } = deletingRow(tables[activeTablePath]!, rowId, activeBodyRowId);
      if (!window.confirm(confirmText(prompt))) return;
      setTables((all) => onTable(all, activeTablePath, (t) => withoutRow(t, rowId)));
      if (closeBody) setActiveBodyRowId(null);
    },
    [tables, activeTablePath, activeBodyRowId],
  );

  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  // Cosmetic field edits (title, description) do NOT bump schema-version.
  // Structural edits (required, deprecated, enum add, add field, reorder) DO.
  const updateField = useCallback(
    (fieldName: string, patch: Partial<Field>) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withFieldPatch(t, fieldName, patch)));
    },
    [activeTablePath],
  );

  const addEnumValue = useCallback(
    (fieldName: string, value: string) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withChoice(t, fieldName, value)));
    },
    [activeTablePath],
  );

  const moveField = useCallback(
    (fieldName: string, delta: -1 | 1) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withFieldMoved(t, fieldName, delta)));
    },
    [activeTablePath],
  );

  const addField = useCallback(
    (field: Field) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withField(t, field, activeViewId)));
    },
    [activeTablePath, activeViewId],
  );

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTables((all) => onTable(all, activeTablePath, (t) => withViewPatch(t, activeViewId, patch)));
    },
    [activeTablePath, activeViewId],
  );

  // A new view starts as a plain table of everything; its settings open
  // so it can be made into what's wanted straight away.
  const addView = useCallback(() => {
    const made = newView();
    setTables((all) => onTable(all, activeTablePath, (t) => withView(t, made)));
    keepSettingsOpen.current = true;
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: made.id }));
    setShowViewSettings(true);
  }, [activeTablePath]);

  const deleteView = useCallback(() => {
    const deleting = deletingView(tables, activeTablePath, view);
    if (!deleting || !window.confirm(confirmText(deleting.prompt))) return;
    setTables((all) => onTable(all, activeTablePath, (t) => withoutView(t, view.id)));
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: deleting.nextViewId }));
    setShowViewSettings(false);
  }, [tables, activeTablePath, activeViewId, view]);

  // The bundle's tables by name, so lookups and rollups reach the ones
  // they name (D36), within this bundle (D37).
  const inBundle = bundleTables(tables, bundleOf(activeTablePath));
  // The view as this viewer arranged it. Formulas still read the views as
  // saved: computing uses the table's own views, never this one.
  const personal = arrangements[activeTablePath]?.[view.id];
  // A Sheet view's grid as saved, for its row numbers and for formulas
  // typed in it (D41); and every Sheet view a formula may name.
  const sheet = useMemo(
    () => sheetShown(tables, activeTablePath, view),
    [tables, activeTablePath, view],
  );
  const { view: shownView, rows: visibleRows, inView } = showView(tables, activeTablePath, view, {
    arrangement: personal,
    search: searchQuery,
    viewerText,
  });
  const summary = viewSummary(table, {
    shown: visibleRows.length,
    inView,
    searching: searchQuery.trim().length > 0,
    openedAt: INITIAL_SCHEMA_VERSIONS[activeTablePath],
  });

  // What the Files side of the sidebar lists and opens: each bundle's
  // files as saving writes them, and fixture tables' attachments.
  const attachmentsOf = useCallback((key: string) => Object.keys(attachmentUrls[key] ?? {}).sort(), []);
  const shownFileContent = (file: ShownFile): { content?: string; attachment?: AttachmentShown } => {
    const attachment = attachmentAt(file.bundle, file.path);
    if (attachment) return { attachment: attachmentShown(attachment.name, attachmentUrls[attachment.tableKey]?.[attachment.name]) };
    return { content: fileText(tables, bundles, file.bundle, file.path) ?? "" };
  };

  // Built once, shown in the drawer or beside the page. Choosing closes the
  // drawer; beside the page there is none to close, so that does nothing.
  const sidebar = (
    <Sidebar
      tables={tables}
      activeTablePath={activeTablePath}
      onSelectTable={(path) => {
        setShownFile(null);
        setActiveTablePath(path);
        setActiveBodyRowId(null);
        closeDrawer();
      }}
      table={table}
      activeViewId={view.id}
      onSelect={(id) => {
        setShownFile(null);
        setActiveViewId(id);
        closeDrawer();
      }}
      onReset={resetDemo}
      bundles={bundles}
      foldedFiles={sidebarPrefs.foldedFiles ?? []}
      onToggleFile={toggleFile}
      foldedDisplay={sidebarPrefs.foldedDisplay === true}
      onToggleDisplay={() => updateSidebar({ foldedDisplay: !sidebarPrefs.foldedDisplay })}
      onNewTable={createTable}
      onNewFile={createFile}
      onNewView={addView}
      onOpenFile={openTableFile}
      display={display}
      onDisplayChange={changeDisplay}
      filesMode={sidebarPrefs.files === true}
      onFilesMode={(files) => {
        if (!files) setShownFile(null);
        updateSidebar({ files });
      }}
      attachmentsOf={attachmentsOf}
      shownFile={shownFile}
      onShowFile={(file) => {
        setShownFile(file);
        closeDrawer();
      }}
    />
  );

  return (
    <DisplaySettingsProvider value={shown}>
    <AttachmentsProvider value={(file) => attachmentUrls[activeTablePath]?.[file]}>
    <html.div style={styles.root}>
      {narrow ? (
        drawerOpen && (
          <>
            <html.div style={styles.drawerBackdrop} onClick={closeDrawer} />
            <html.div ref={drawerRef} tabIndex={-1} role="dialog" aria-modal={true} aria-label="Tables and views" style={styles.drawer}>
              {sidebar}
            </html.div>
          </>
        )
      ) : (
        // Collapsed, it slides to nothing and is hidden from the keyboard
        // and screen readers until it comes back.
        <html.div
          aria-hidden={sidebarCollapsed ? true : undefined}
          style={[styles.sidebarSlot, sidebarCollapsed && styles.sidebarSlotCollapsed]}
        >
          {sidebar}
        </html.div>
      )}
      <html.div style={[styles.main, narrow && styles.mainNarrow]}>
        {narrow && (
          <html.div style={styles.topBar}>
            <html.button
              ref={menuButtonRef}
              style={styles.menuButton}
              aria-label="Tables and views"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              ☰
            </html.button>
            <html.span style={styles.topBarTitle}>{table.meta.title ?? activeTablePath}</html.span>
          </html.div>
        )}
        {shownFile ? (
          <FileView
            bundle={shownFile.bundle}
            path={shownFile.path}
            {...shownFileContent(shownFile)}
            onClose={() => setShownFile(null)}
          />
        ) : (
        <>
        <html.div style={styles.header}>
          <html.span style={styles.breadcrumb}>
            {tableBreadcrumb(activeTablePath, tables, bundles).text}
          </html.span>
          <html.div style={styles.headerTopRow}>
            <html.div style={styles.titleRow}>
              {!narrow && (
                <Hinted hint={hintWithShortcut(commandOf("toggle-sidebar"), "web")}>
                  <html.button
                    aria-label="Toggle the sidebar"
                    aria-expanded={!sidebarCollapsed}
                    onClick={toggleSidebar}
                    style={styles.sidebarTrigger}
                  >
                    ◧
                  </html.button>
                </Hinted>
              )}
              <html.span dir="auto" style={styles.title}>{view.name}</html.span>
            </html.div>
            <html.div style={styles.headerActions}>
            <Hinted hint={TOOLBAR_HINTS.viewSettings}>
              <html.button
                style={[styles.downloadButton, showViewSettings && styles.buttonOn]}
                onClick={() => setShowViewSettings((open) => !open)}
              >
                View settings
              </html.button>
            </Hinted>
            <Hinted hint={commandOf("export-zip").hint}>
              <html.button style={styles.downloadButton} onClick={() => void downloadTable()}>
                Download .table.zip
              </html.button>
            </Hinted>
            <html.input
              type="search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e: { target: { value: string } }) =>
                setSearchQuery(e.target.value)
              }
              style={[styles.searchInput, narrow && styles.searchNarrow]}
            />
            </html.div>
          </html.div>
          <html.div style={styles.subtitle}>
            <html.span>{summary.count}</html.span>
            <html.span>·</html.span>
            <Hinted hint={summary.validityHint} style={summary.valid ? styles.validityOk : styles.validityBad}>
              {summary.validity}
            </Hinted>
            {summary.schemaChanged && (
              <>
                <html.span>·</html.span>
                {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
                <Hinted hint={summary.schemaChangedHint} style={styles.schemaBumpBadge}>
                  {summary.schemaChangedLabel}
                </Hinted>
              </>
            )}
          </html.div>
        </html.div>
        {showViewSettings && (
          <ViewSettings
            key={view.id}
            view={shownView}
            schema={table.schema}
            onChange={(patch) => {
              // Turning a Sheet view into anything else loses its grid (D41).
              const prompt = viewPatchPrompt(tables, activeTablePath, view, patch);
              if (prompt && !window.confirm(confirmText(prompt))) return;
              updateActiveView(patch);
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
        })}
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
    </AttachmentsProvider>
    </DisplaySettingsProvider>
  );
}


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
  sheet?: { order: string[]; position: Map<string, number>; sheets: import("@workspace.sh/table-core").SheetRef[] };
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
    relatedTables: cb.relatedTables,
    onOpenRelation: cb.onOpenRelation,
  };
  switch (view.layout) {
    case "board":
      return (
        <BoardView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onUpdateRow={cb.onUpdateRow}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
    case "gallery":
      return (
        <GalleryView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          {...common}
        />
      );
    case "list":
      return (
        <ListView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
    case "calendar":
      return (
        <CalendarView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          {...common}
        />
      );
    case "table":
    default:
      return (
        <TableView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
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
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
  }
}
