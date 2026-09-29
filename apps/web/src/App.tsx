import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import {
  textDirection,
  bundleFiles,
  applyView,
  newBundle,
  newId,
  newTable,
  parseAddress,
  searchRows,
  validate,
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
  type DisplaySettings,
} from "@workspace.sh/table-ui";
import { attachmentUrls, bundles as initialBundles, tables as initialTables } from "./loadFixture";
import { loadDisplay, saveDisplay } from "./displaySettings";
import { archiveFileName, bundleToArchive, openArchive } from "./tableFiles";
import { bundleOf, bundleTables, fromBundle, keyForAddress, tableNameOf, toBundle } from "./bundles";
import { tableKeyFor } from "./tableKey";
import { browserStore, clearSaved, loadSaved, save } from "./savedTables";
import { Sidebar, type ShownFile } from "./Sidebar";
import { FileView } from "./FileView";
import { addressInHash, useHashAddress } from "./useHashAddress";
import { useNarrow } from "./useNarrow";
import { loadSidebarPrefs, saveSidebarPrefs, type SidebarPrefs } from "./sidebarPrefs";
import {
  arrange,
  arrangedView,
  forViews,
  isArranged,
  loadArrangements,
  reset as resetArrangement,
  saveArrangements,
  savedPatch,
  type Arrangements,
} from "./arrangements";

const DEFAULT_TABLE_PATH = "projects/projects";
const INITIAL_SCHEMA_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.entries(initialTables).map(([key, t]) => [
    key,
    (t.schema["schema-version"] as number | undefined) ?? 1,
  ]),
);

/**
 * "Shop (shop.table) › Orders": the file and the table a view belongs
 * to. A file whose one table shares its title names it once.
 */
function breadcrumb(fileTitle: string, fileName: string, tableTitle: string): string {
  const file = `${fileTitle} (${fileName})`;
  return tableTitle === fileTitle ? file : `${file} › ${tableTitle}`;
}

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

/** The first view of each table, as the demo opens it. */
function firstViews(tables: Record<string, ParsedTable>): Record<string, string> {
  return Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, t.views[0]?.id ?? ""]));
}

/** The table to show first: the default one when it exists, otherwise any. */
function firstTablePath(tables: Record<string, ParsedTable>): string {
  return tables[DEFAULT_TABLE_PATH] ? DEFAULT_TABLE_PATH : Object.keys(tables)[0]!;
}

function bumpSchemaVersion(schema: TableSchema): TableSchema {
  const current = (schema["schema-version"] as number | undefined) ?? 1;
  return { ...schema, "schema-version": current + 1 };
}

export function App() {
  // Edits survive a reload (#86): what was saved, or the fixtures when
  // nothing usable was.
  const [initial] = useState(() => loadSaved(browserStore()) ?? { tables: initialTables, bundles: initialBundles });
  const [tables, setTables] = useState<Record<string, ParsedTable>>(initial.tables);
  // Each bundle's manifest (D37): its title and the order of its tables.
  const [bundles, setBundles] = useState<Record<string, BundleMeta>>(initial.bundles);
  // Start where the address says, if it names a table here.
  const [start] = useState(() => {
    const addr = addressInHash();
    const key = addr ? keyForAddress(addr, initial.tables, initial.bundles, "") : null;
    return key ? { key, viewId: addr!.viewId } : null;
  });
  const [activeTablePath, setActiveTablePath] = useState<string>(() => start?.key ?? firstTablePath(tables));
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
      const title = window.prompt("Name the new table")?.trim();
      if (!title) return;
      const name = tableKeyFor(title, Object.keys(bundleTables(tables, bundle)));
      const made = newTable(title, `${bundle}.table/tables/${name}`);
      setTables((all) => ({ ...all, [`${bundle}/${name}`]: made }));
      setBundles((all) => {
        const meta = all[bundle] ?? {};
        const order = meta.tables ?? Object.keys(bundleTables(tables, bundle));
        return { ...all, [bundle]: { ...meta, tables: [...order, name] } };
      });
      openKey(`${bundle}/${name}`, made.views[0]!.id);
    },
    [tables],
  );

  // A new `.table` file: a bundle holding one new table.
  const createFile = useCallback(() => {
    const title = window.prompt("Name the new .table file")?.trim();
    if (!title) return;
    const key = tableKeyFor(title, Object.keys(bundles));
    const name = tableKeyFor(title, []);
    const made = newBundle(title, `${key}.table`, name);
    setTables((all) => ({ ...all, ...fromBundle(key, made) }));
    setBundles((all) => ({ ...all, [key]: made.meta }));
    openKey(`${key}/${name}`, made.tables[name]!.views[0]!.id);
  }, [bundles]);

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
    setTables(initialTables);
    setBundles(initialBundles);
    setActiveTablePath(firstTablePath(initialTables));
    setActiveViewIds(firstViews(initialTables));
    setSearchQuery("");
    setActiveBodyRowId(null);
  }, []);
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
    const folded = sidebarPrefs.foldedFiles ?? [];
    if (folded.includes(activeBundle)) updateSidebar({ foldedFiles: folded.filter((b) => b !== activeBundle) });
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
      const key = keyForAddress(addr, tables, bundles, bundleOf(activeTablePath));
      // Not here: visible-broken at the cell level already; nothing more to do.
      if (!key) return;
      setActiveTablePath(key);
      if (addr.viewId) {
        setActiveViewIds((prev) => ({ ...prev, [key]: addr.viewId! }));
      }
      // If the row has a body and the target table tracks bodies, open
      // the body editor as a quick "row detail" surface. Tables without
      // bodies just switch + scroll-to (deferred).
      if (addr.rowId) {
        const target = tables[key];
        if (target?.bodies?.[addr.rowId]) {
          setActiveBodyRowId(addr.rowId);
        } else {
          setActiveBodyRowId(null);
        }
      } else {
        setActiveBodyRowId(null);
      }
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
      setTables((all) => ({
        ...all,
        [activeTablePath]: {
          ...all[activeTablePath]!,
          rows: all[activeTablePath]!.rows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row,
          ),
        },
      }));
    },
    [activeTablePath],
  );

  const updateBody = useCallback(
    (rowId: string, content: string) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const bodies = { ...(t.bodies ?? {}) };
        if (content.length === 0) delete bodies[rowId];
        else bodies[rowId] = content;
        return { ...all, [activeTablePath]: { ...t, bodies } };
      });
    },
    [activeTablePath],
  );

  // A new row is just an id (D23); the view it lands in decides where it
  // shows, and a filter may hide it until its cells are filled in.
  // Returns the id, so the table can open the new row for typing.
  const addRow = useCallback(() => {
    const id = newId();
    setTables((all) => {
      const t = all[activeTablePath]!;
      return { ...all, [activeTablePath]: { ...t, rows: [...t.rows, { id }] } };
    });
    return id;
  }, [activeTablePath]);

  const deleteRow = useCallback(
    (rowId: string) => {
      const t = tables[activeTablePath]!;
      const hasBody = t.bodies?.[rowId] !== undefined;
      if (!window.confirm(`Delete "${rowTitleFor(t, rowId)}"?${hasBody ? " Its document goes too." : ""}`)) return;
      setTables((all) => {
        const current = all[activeTablePath]!;
        const bodies = { ...(current.bodies ?? {}) };
        delete bodies[rowId];
        return {
          ...all,
          [activeTablePath]: {
            ...current,
            rows: current.rows.filter((r) => r.id !== rowId),
            ...(current.bodies ? { bodies } : {}),
          },
        };
      });
      setActiveBodyRowId((open) => (open === rowId ? null : open));
    },
    [tables, activeTablePath],
  );

  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  // Cosmetic field edits (title, description) do NOT bump schema-version.
  // Structural edits (required, deprecated, enum add, add field, reorder) DO.
  const updateField = useCallback(
    (fieldName: string, patch: Partial<Field>) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const fields = t.schema.fields.map((f) =>
          f.name === fieldName ? { ...f, ...patch } : f,
        );
        const isStructural =
          "constraints" in patch ||
          "deprecated" in patch ||
          "relation" in patch ||
          // A new formula changes what the column means for every row.
          "computed" in patch;
        const nextSchema: TableSchema = isStructural
          ? bumpSchemaVersion({ ...t.schema, fields })
          : { ...t.schema, fields };
        return { ...all, [activeTablePath]: { ...t, schema: nextSchema } };
      });
    },
    [activeTablePath],
  );

  const addEnumValue = useCallback(
    (fieldName: string, value: string) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const fields = t.schema.fields.map((f) => {
          if (f.name !== fieldName) return f;
          const existing = f.constraints?.enum ?? [];
          if (existing.includes(value)) return f;
          return {
            ...f,
            constraints: { ...(f.constraints ?? {}), enum: [...existing, value] },
          };
        });
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
          },
        };
      });
    },
    [activeTablePath],
  );

  const moveField = useCallback(
    (fieldName: string, delta: -1 | 1) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const from = t.schema.fields.findIndex((f) => f.name === fieldName);
        if (from === -1) return all;
        const to = from + delta;
        if (to < 0 || to >= t.schema.fields.length) return all;
        const fields = t.schema.fields.slice();
        const [moved] = fields.splice(from, 1);
        fields.splice(to, 0, moved!);
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
          },
        };
      });
    },
    [activeTablePath],
  );

  const addField = useCallback(
    (field: Field) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        if (t.schema.fields.some((f) => f.name === field.name)) return all;
        const fields = [...t.schema.fields, field];
        // A view that lists its fields shows only those, so a field added
        // from it would otherwise never appear where it was added. It joins
        // the view it was added from; other views are left as they are.
        const views = t.views.map((v) =>
          v.id === activeViewId && Array.isArray(v.fields) && !v.fields.includes(field.name)
            ? { ...v, fields: [...v.fields, field.name] }
            : v,
        );
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
            views,
          },
        };
      });
    },
    [activeTablePath, activeViewId],
  );

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            views: t.views.map((v) => (v.id === activeViewId ? { ...v, ...patch } : v)),
          },
        };
      });
    },
    [activeTablePath, activeViewId],
  );

  // A new view starts as a plain table of everything; its settings open
  // so it can be made into what's wanted straight away.
  const addView = useCallback(() => {
    const made: View = { id: newId(), name: "New view", layout: "table" };
    setTables((all) => {
      const t = all[activeTablePath]!;
      return { ...all, [activeTablePath]: { ...t, views: [...t.views, made] } };
    });
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: made.id }));
    setShowViewSettings(true);
  }, [activeTablePath]);

  const deleteView = useCallback(() => {
    const t = tables[activeTablePath]!;
    if (t.views.length <= 1) return;
    if (!window.confirm(`Delete the view "${view.name}"? The rows stay; only this way of showing them goes.`)) return;
    const remaining = t.views.filter((v) => v.id !== activeViewId);
    setTables((all) => ({ ...all, [activeTablePath]: { ...all[activeTablePath]!, views: remaining } }));
    setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: remaining[0]!.id }));
    setShowViewSettings(false);
  }, [tables, activeTablePath, activeViewId, view.name]);

  // The bundle's tables by name, so lookups and rollups reach the ones
  // they name (D36), within this bundle (D37).
  const inBundle = bundleTables(tables, bundleOf(activeTablePath));
  // The view as this viewer arranged it. Formulas still read the views as
  // saved: computing uses the table's own views, never this one.
  const personal = arrangements[activeTablePath]?.[view.id];
  const shownView = arrangedView(view, personal);
  const viewRows = applyView(table, shownView, {
    tables: inBundle,
    self: tableNameOf(activeTablePath),
    ...(personal?.sort ? { text: viewerText } : {}),
  });
  const visibleRows = searchRows(viewRows, searchQuery, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);
  const searching = searchQuery.trim().length > 0;
  const currentSchemaVersion =
    (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped =
    currentSchemaVersion > (INITIAL_SCHEMA_VERSIONS[activeTablePath] ?? 1);

  // What the Files side of the sidebar lists and opens: each bundle's
  // files as saving writes them, and fixture tables' attachments.
  const attachmentsOf = useCallback((key: string) => Object.keys(attachmentUrls[key] ?? {}).sort(), []);
  const shownFileContent = (file: ShownFile): { content?: string; imageUrl?: string } => {
    const m = /^tables\/([^/]+)\/attachments\/(.+)$/.exec(file.path);
    if (m) return { imageUrl: attachmentUrls[`${file.bundle}/${m[1]}`]?.[m[2]!] };
    const found = bundleFiles(toBundle(tables, bundles, file.bundle)).find((f) => f.path === file.path);
    return { content: found?.content ?? "" };
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
        setSearchQuery("");
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
            {breadcrumb(bundles[activeBundle]?.title ?? activeBundle, `${activeBundle}.table`, table.meta.title ?? tableNameOf(activeTablePath))}
          </html.span>
          <html.div style={styles.headerTopRow}>
            <html.div style={styles.titleRow}>
              {!narrow && (
                <Hinted hint={`${sidebarCollapsed ? "Show" : "Hide"} the sidebar (⌘B / Ctrl+B)`}>
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
            <Hinted hint="Name, layout, filters, sorting and grouping for this view. Saved with the table, so everyone who opens it sees the same view.">
              <html.button
                style={[styles.downloadButton, showViewSettings && styles.buttonOn]}
                onClick={() => setShowViewSettings((open) => !open)}
              >
                View settings
              </html.button>
            </Hinted>
            <Hinted hint="Save this table as a .table.zip: a folder of plain files (schema, one row per line, views, documents) that any .table reader opens.">
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
            <html.span>
              {searching
                ? `${visibleRows.length} of ${viewRows.length} matching`
                : `${visibleRows.length} of ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`}
            </html.span>
            <html.span>·</html.span>
            <Hinted
              hint={
                errors.length === 0
                  ? "Every row fits the schema: required fields are filled, choices are from their lists, and values are the right type."
                  : errors
                      .slice(0, 5)
                      .map((e) => `${e.field ?? "row"}: ${e.message}`)
                      .join("\n") + (errors.length > 5 ? `\n…and ${errors.length - 5} more` : "")
              }
              style={errors.length === 0 ? styles.validityOk : styles.validityBad}
            >
              {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`}
            </Hinted>
            {schemaBumped && (
              <>
                <html.span>·</html.span>
                {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
                <Hinted
                  hint="A column was added, moved, retyped or given new rules since this table was opened. The table's schema-version goes up by one for each such change (D22)."
                  style={styles.schemaBumpBadge}
                >
                  schema changed
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
            onChange={updateActiveView}
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

function rowTitleFor(table: ParsedTable, rowId: string): string {
  const row = table.rows.find((r) => r.id === rowId);
  if (!row) return rowId;
  // Prefer the first string-typed field; fall back to id.
  for (const field of table.schema.fields) {
    if (field.type === "string") {
      const v = row[field.name];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return rowId;
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
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
  }
}
