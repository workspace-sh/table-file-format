import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { html, css } from "react-strict-dom";
import { computeRows, isSheet, newId } from "@workspace.sh/table-core";
import type { Field, ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import { openArchiveInWorker } from "./sqlite/client";
import { useIndexedTables } from "./useIndexedTables";
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
} from "@workspace.sh/table-ui";
import type { PlaceMeasure } from "@workspace.sh/table-ui/shared";
import { attachmentUrls, bundles as initialBundles, tables as initialTables } from "./loadFixture";
import {
  addressTarget,
  archiveFileName,
  attachmentAt,
  attachmentShown,
  browserStore,
  bundleOf,
  bundleTables,
  bundleToArchive,
  derive,
  clearSaved,
  confirmText,
  exportFailedText,
  fileText,
  fromBundle,
  hintWithShortcut,
  initialAppState,
  loadArrangements,
  loadDisplay,
  loadSaved,
  loadSidebarPrefs,
  openArchive,
  ARCHIVE_ROWS,
  tooLargeToArchiveText,
  openFailedText,
  rowTitleFor,
  save,
  schemaVersions,
  tableNameOf,
  TOOLBAR_HINTS,
  toBundle,
  viewCallbacks,
  withNewFixtures,
  type AppCommandId,
  type AttachmentShown,
  type ShownFile,
} from "@workspace.sh/table-app";
import { useTableApp } from "@workspace.sh/table-app/react";
import { Sidebar } from "./Sidebar";
import { FileView } from "./FileView";
import { addressInHash, useHashAddress } from "./useHashAddress";
import { useNarrow } from "./useNarrow";

/** The line under the window's top that "how far down" is measured at, in pixels. */
const PLACE_LINE = 60;

// How long after the last edit the demo saves, as the Mac and Linux apps do (400 ms): typing is one write, not one a key.
const SAVE_AFTER_MS = 400;
const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

// What the Files side of the sidebar lists and opens: each bundle's files
// as saving writes them, and fixture tables' attachments.
const attachmentsOf = (key: string) => Object.keys(attachmentUrls[key] ?? {}).sort();

const NO_ROWS: Row[] = [];

/** An archive smaller than this can't hold a table large enough to index, and is read on the page. */
const WORKER_FROM_BYTES = 256 * 1024;

/** A view with only what the head of a file can show: its fields and sizes, not its order, filters, groups or totals. */
function asStored(view: View): View {
  const { sort: _sort, order: _order, filter: _filter, group: _group, totals: _totals, ...rest } = view;
  return rest;
}

/**
 * How far the reading has got. How many rows there are isn't known until the
 * last is read, so until then the total is "about", to two figures: a number
 * that changed with every step would read as a fault.
 */
function readingText(building: { done: number; total: number }): string {
  if (building.total <= 0) return "Reading rows";
  if (building.done >= building.total) return `${building.done.toLocaleString()} rows read`;
  const digits = Math.max(0, String(Math.round(building.total)).length - 2);
  const about = Math.round(building.total / 10 ** digits) * 10 ** digits;
  return `${building.done.toLocaleString()} of about ${Math.max(about, building.done).toLocaleString()} rows read`;
}

/** What the line above the first rows says while a large table is read. */
function ingestingText(view: View): string {
  const arranged = !!(view.sort?.length || view.order?.length || view.filter?.length || view.group);
  return arranged
    ? "Showing rows as stored, as they're read. This view's sorting, filters and groups, and search and editing, are ready once the table is read. This happens once."
    : "Showing rows as stored, as they're read. Search and editing are ready once the table is read. This happens once.";
}

const styles = css.create({
  indexedNote: {
    fontSize: 12,
    opacity: 0.7,
    paddingBlock: 8,
  },
  firstRows: {
    pointerEvents: "none",
  },
  readTrack: {
    width: 160,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    overflow: "hidden",
    backgroundColor: { default: "rgba(0,0,0,0.12)", "@media (prefers-color-scheme: dark)": "rgba(255,255,255,0.16)" },
  },
  readDone: {
    height: 4,
    backgroundColor: { default: "#0a66d8", "@media (prefers-color-scheme: dark)": "#4c9bff" },
  },
  readWidth: (fraction: number) => ({ width: `${Math.round(fraction * 100)}%` }),
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
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
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
  // Everything the app holds is table-app's state (docs/APP-STATE.md):
  // edits survive a reload (#86), from what was saved or the fixtures, and
  // the viewer's own settings come from this browser.
  const browserLocale = typeof navigator === "undefined" ? undefined : navigator.language;
  // Set once the indexed tables' hook below has run: a write can only come after.
  const saveIndexed = useRef<(tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const { state, dispatch, display: shownDisplay, flush } = useTableApp(
    () => {
      const fixtures = { tables: initialTables, bundles: initialBundles };
      const saved = loadSaved(browserStore());
      // Fixture tables added since this browser saved its edits still appear.
      const initial = saved ? withNewFixtures(saved, fixtures) : fixtures;
      const store = browserStore();
      const start = addressInHash();
      const sidebar = loadSidebarPrefs(store);
      const s = initialAppState({
        ...initial,
        stored: { sidebar, arrangements: loadArrangements(store), display: loadDisplay(store) },
        ...(start ? { start } : {}),
      });
      return {
        ...s,
        // The page's address is where a reload left it more often than a link
        // followed, so the side the viewer left the sidebar on stays.
        sidebar: sidebar.files ? { ...s.sidebar, files: true } : s.sidebar,
        // "Schema changed" is since the fixtures, as saved edits carry over a reload.
        openedAt: INITIAL_SCHEMA_VERSIONS,
      };
    },
    // Saved a moment after the last edit, in this browser. The fixtures themselves are
    // never saved, so an untouched demo keeps following them as they change.
    {
      store: browserStore(),
      write: async (_edited, tables, bundles) => {
        // A table held in the index has no rows here: only what's left of it is kept in this store.
        save(browserStore(), { tables, bundles });
        await saveIndexed.current(tables);
      },
      delayMs: SAVE_AFTER_MS,
    },
    browserLocale,
  );
  const { tables, bundles, active: activeTablePath, display, sidebar: sidebarPrefs } = state;
  const tell = useCallback((heading: string, body?: string) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }), [dispatch]);
  // Tables held in the index (large ones): read, edited and saved there, in a worker.
  const indexed = useIndexedTables({ state, dispatch, view: derive(state, { locale: browserLocale, attachmentsOf }).shown.view, tell });
  saveIndexed.current = indexed.save;
  const derived = derive(state, {
    locale: browserLocale,
    attachmentsOf,
    ...(indexed.source ? { indexedShown: { count: indexed.source.count, inView: indexed.source.inView } } : {}),
  });
  const { table, view, shown: shownArranged, summary } = derived;

  // Leaving the page (closing the tab, going elsewhere, hiding it on a
  // phone) writes what's left at once, rather than after the delay. The
  // browser's store is synchronous, so it's written before the page goes.
  useEffect(() => {
    const now = () => void flush();
    const hidden = () => document.visibilityState === "hidden" && now();
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  // Questions and messages, the browser's way.
  useEffect(() => {
    const asking = state.asking;
    if (!asking) return;
    if (asking.kind === "name") {
      const text = window.prompt(asking.prompt.heading);
      dispatch({ type: "answer", response: text === null ? "cancel" : "create", ...(text !== null ? { text } : {}) });
      return;
    }
    const ok = window.confirm(confirmText(asking.confirm));
    // Starting again from the examples: what this browser saved goes too.
    if (ok && asking.on.type === "reset") clearSaved(browserStore());
    dispatch({ type: "answer", response: ok ? asking.confirm.responses.at(-1)!.id : "cancel" });
  }, [state.asking]);
  useEffect(() => {
    if (!state.telling) return;
    window.alert(state.telling.body ? `${state.telling.heading}\n\n${state.telling.body}` : state.telling.heading);
    dispatch({ type: "told" });
  }, [state.telling]);

  // Download: the whole bundle as a real `.table.zip` (D27, D37), so the
  // tables it links together travel together.
  const downloadTable = useCallback(async () => {
    const bundle = bundleOf(activeTablePath);
    let bytes: Uint8Array;
    try {
      // A table held in the index has its rows read out of it for the archive, which is made in
      // memory; one too large for that is refused, since an archive without its rows is no copy.
      const whole = { ...tables };
      for (const [key, held] of Object.entries(tables)) {
        if (bundleOf(key) !== bundle || !held.indexed) continue;
        if (held.indexed.count > ARCHIVE_ROWS) {
          const { heading, body } = tooLargeToArchiveText(tableNameOf(key), held.indexed.count);
          return tell(heading, body);
        }
        const { indexed: _index, ...rest } = held;
        whole[key] = { ...rest, rows: await indexed.everyRow(key, held) };
      }
      bytes = await bundleToArchive(bundle, toBundle(whole, bundles, bundle));
    } catch (error) {
      dispatch({ type: "tell", message: { heading: exportFailedText(archiveFileName(bundle), error) } });
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = archiveFileName(bundle);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [tables, bundles, activeTablePath, indexed.everyRow, tell]);

  // An archive's bytes, read. A small one is read here. One that could hold
  // a large table is read in a worker, where such a table's rows stay, on
  // their way into its index (sqlite/worker): it comes back without them.
  const openAnyArchive = useCallback(
    async (bytes: Uint8Array) => {
      if (bytes.byteLength < WORKER_FROM_BYTES || typeof Worker === "undefined") return openArchive(bytes, Object.keys(bundles));
      const read = await openArchiveInWorker(bytes, Object.keys(bundles));
      if (read.index) {
        indexed.hold(read.opened.key, read.index, Object.fromEntries(Object.entries(read.first).map(([name, rows]) => [`${read.opened.key}/${name}`, rows])));
        // Asked after, not before the rows show: the database opens behind them.
        void read.index.persistent().then(
          (kept) => kept || tell("Kept only while this page is open", "This browser gave no storage for a table this large, so it's held for now and gone when the page is closed or reloaded."),
        );
      }
      return read.opened;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundles, indexed.hold, tell],
  );

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
        const opened = await openAnyArchive(new Uint8Array(await file.arrayBuffer()));
        const library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
        dispatch({ type: "opened", library, skipped: opened.skipped });
      } catch (error) {
        dispatch({ type: "tell", message: { heading: openFailedText(file.name, error) } });
      }
    });
    document.body.appendChild(input);
    input.click();
  }, [bundles, openAnyArchive]);

  // Development, or a production build made with VITE_TABLE_MEASURE=1 (the
  // numbers that count come from production builds, BENCHMARKING.md): opens
  // a .table.zip from a URL as a chosen file is opened, and says how long
  // each step took (ms), for measuring large tables (#126): fetching it,
  // reading it (unzip and parse), and showing it (React's render and commit,
  // synchronously: a hidden tab has no frames to wait for).
  const measured = useRef({ canUndo: false, canRedo: false, queued: 0 });
  measured.current = { canUndo: derived.canUndo, canRedo: derived.canRedo, queued: state.indexWork.length };
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_TABLE_MEASURE !== "1") return;
    (window as { __tableWeb?: unknown }).__tableWeb = {
      openZipFrom: async (url: string) => {
        const t0 = performance.now();
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const t1 = performance.now();
        const opened = await openAnyArchive(bytes);
        const t2 = performance.now();
        const library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
        flushSync(() => dispatch({ type: "opened", library, skipped: opened.skipped }));
        const t3 = performance.now();
        return { key: opened.key, fetch: Math.round(t1 - t0), read: Math.round(t2 - t1), show: Math.round(t3 - t2) };
      },
      // What the index worker's answers took, for a bundle held in it.
      workerTimings: (bundle: string) => indexed.timings(bundle),
      // Any action, as the app's own controls send them.
      act: (action: Parameters<typeof dispatch>[0]) => flushSync(() => dispatch(action)),
      // Whether there's a step to undo or redo, and how many edits wait on the index.
      undoing: () => ({ canUndo: measured.current.canUndo, canRedo: measured.current.canRedo, queued: measured.current.queued }),
      // Milliseconds to edit a row's title in the table on screen and render it.
      timeEdit: (rowId: string) => {
        const t0 = performance.now();
        flushSync(() => dispatch({ type: "updateRow", rowId, field: "title", value: "Edited" }));
        return Math.round(performance.now() - t0);
      },
    };
  }, [bundles]);

  // The layout reads the way the display language does (D40): the chosen
  // language, or the browser's. The whole page takes it, so popovers and
  // menus outside the app's root mirror too.
  const { locale: pageLocale, direction } = derived;
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dir = direction;
    if (pageLocale) document.documentElement.lang = pageLocale;
  }, [direction, pageLocale]);
  // At phone width the sidebar is a drawer, opened from the top bar.
  const narrow = useNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);
  // The sidebar collapses out of the way, as shadcn/ui's does: a trigger
  // in the header, or ⌘B / Ctrl+B. Narrow, the same opens the drawer.
  const sidebarCollapsed = sidebarPrefs.collapsed === true;
  const toggleSidebar = useCallback(() => {
    if (narrow) setDrawerOpen((open) => !open);
    else dispatch({ type: "setSidebarCollapsed", collapsed: !sidebarCollapsed });
  }, [narrow, sidebarCollapsed]);
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
  // Undo and redo: ⌘Z and ⇧⌘Z, or Ctrl+Z and Ctrl+Y (Ctrl+Shift+Z too).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.shiftKey);
      if (!redo && (key !== "z" || e.shiftKey)) return;
      const t = e.target as HTMLElement | null;
      // In a text box, undo belongs to the text.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      dispatch({ type: redo ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // How far down the page the view is, kept for history as the row at a
  // line under the window's top and how far into it, and put back on the
  // browser's Back or Forward. The page itself scrolls, sidebar and all.
  const measure = useRef<PlaceMeasure | null>(null);
  const onPlaceMeasure = useCallback((m: PlaceMeasure | null) => {
    measure.current = m;
  }, []);
  useEffect(() => {
    let rest: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (rest) clearTimeout(rest);
      rest = setTimeout(() => {
        void measure.current?.rowAt(PLACE_LINE).then((top) => {
          if (top) dispatch({ type: "place", place: { top } });
        });
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rest) clearTimeout(rest);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const restoringN = state.restoring?.n;
  useEffect(() => {
    const top = state.restoring?.place.top;
    if (restoringN === undefined) return;
    // After the view has drawn the rows it was left at.
    const t = setTimeout(() => {
      if (!top) {
        window.scrollTo({ top: 0 });
        return;
      }
      void measure.current?.topOf(top.rowId).then((at) => {
        if (at !== null) window.scrollBy({ top: at + top.offset - PLACE_LINE });
      });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoringN]);
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

  // Hint wording, shared with macOS and Linux (table-app's commands).
  const commandOf = (id: AppCommandId) => derived.commands.find((c) => c.id === id)!;

  // Two-way URL-hash sync. Writes the current address on every nav
  // change; on browser back/forward (or a typed-in URL) follows the hash
  // as a relation's link is followed.
  useHashAddress({
    state: {
      tablePath: `${bundleOf(activeTablePath)}.table`,
      tableName: tableNameOf(activeTablePath),
      viewId: view.id,
      rowId: state.openPage ?? undefined,
    },
    onExternalChange: (addr) => {
      const target = addressTarget(addr, tables, bundles, bundleOf(activeTablePath));
      if (target) dispatch({ type: "follow", target });
    },
    // The browser's Back and Forward are the app's, which put back where the
    // view was left. Beyond what this visit remembers (after a reload), the
    // address the browser kept is followed instead.
    onBack: () => (derived.canGoBack ? dispatch({ type: "back" }) : followHash()),
    onForward: () => (derived.canGoForward ? dispatch({ type: "forward" }) : followHash()),
  });
  function followHash() {
    const addr = addressInHash();
    const target = addr && addressTarget(addr, tables, bundles, bundleOf(activeTablePath));
    if (target) dispatch({ type: "follow", target });
  }

  // The view on screen's callbacks, each an action (table-app's viewCallbacks).
  const callbacks = useMemo(() => viewCallbacks(state, dispatch, newId), [tables, bundles, activeTablePath]);

  // A Sheet view's grid as saved, for its row numbers and for formulas
  // typed in it (D41); and every Sheet view a formula may name.
  const { view: shownView, rows: visibleRows, sheet } = shownArranged;
  // The rows of a large table still being read, shown until its own view's rows are here.
  const reading = view.layout === "table" && !indexed.source ? indexed.reading : undefined;

  // A file of a .table, opened from the Files side of the sidebar, shown
  // in place of the view while that side is.
  const shownFile = sidebarPrefs.files ? state.shownFile : null;
  // Null when the file's no longer there (its table was deleted): the view shows again, as on macOS.
  const shownFileContent = (file: ShownFile): { content?: string; attachment?: AttachmentShown } | null => {
    const attachment = attachmentAt(file.bundle, file.path);
    if (attachment) return { attachment: attachmentShown(attachment.name, attachmentUrls[attachment.tableKey]?.[attachment.name]) };
    const content = fileText(tables, bundles, file.bundle, file.path);
    return content === undefined ? null : { content };
  };
  const shownContent = shownFile ? shownFileContent(shownFile) : null;

  // Built once, shown in the drawer or beside the page. Choosing closes the
  // drawer; beside the page there is none to close, so that does nothing.
  const sidebar = (
    <Sidebar
      tables={tables}
      activeTablePath={activeTablePath}
      onSelectTable={(path) => {
        dispatch({ type: "showTable", key: path });
        closeDrawer();
      }}
      table={table}
      activeViewId={view.id}
      onSelect={(id) => {
        dispatch({ type: "showView", key: activeTablePath, viewId: id });
        closeDrawer();
      }}
      onReset={() => dispatch({ type: "reset", fresh: { tables: initialTables, bundles: initialBundles, paths: {}, problems: {} } })}
      bundles={bundles}
      foldedFiles={sidebarPrefs.foldedFiles ?? []}
      onToggleFile={(bundle) => dispatch({ type: "toggleFile", bundle })}
      foldedDisplay={sidebarPrefs.foldedDisplay === true}
      onToggleDisplay={() => dispatch({ type: "setDisplayFolded", folded: !sidebarPrefs.foldedDisplay })}
      onNewTable={(bundle) => dispatch({ type: "create", making: { kind: "table", bundle } })}
      onNewFile={() => dispatch({ type: "create", making: { kind: "file" } })}
      onNewView={() => dispatch({ type: "addView", id: newId() })}
      onOpenFile={openTableFile}
      display={display}
      onDisplayChoose={(kind, value) => dispatch({ type: "display", choice: { kind, value } })}
      filesMode={sidebarPrefs.files === true}
      onFilesMode={(files) => dispatch({ type: "setFilesSide", files })}
      attachmentsOf={attachmentsOf}
      shownFile={shownFile}
      onShowFile={(file) => {
        dispatch({ type: "showFile", file });
        closeDrawer();
      }}
    />
  );

  return (
    <DisplaySettingsProvider value={shownDisplay}>
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
            {/* Where the view is, file and table: narrow, the breadcrumb lives up here. */}
            <html.span dir="auto" style={styles.topBarTitle}>{derived.breadcrumb.text}</html.span>
          </html.div>
        )}
        {shownFile && shownContent ? (
          <FileView
            bundle={shownFile.bundle}
            path={shownFile.path}
            {...shownContent}
            onClose={() => dispatch({ type: "showFile", file: null })}
          />
        ) : (
        <>
        <html.div style={styles.header}>
          {!narrow && (
            <html.span style={styles.breadcrumb}>
              {derived.breadcrumb.text}
            </html.span>
          )}
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
                style={[styles.downloadButton, state.settingsOpen && styles.buttonOn]}
                onClick={() => dispatch({ type: "settings", open: !state.settingsOpen })}
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
              value={state.search}
              onChange={(e: { target: { value: string } }) => dispatch({ type: "search", text: e.target.value })}
              style={[styles.searchInput, narrow && styles.searchNarrow]}
            />
            </html.div>
          </html.div>
          <html.div style={styles.subtitle}>
            {/* While a large table is read, how far that has got is in the count's place. */}
            {indexed.building ? (
              <>
                <html.span>
                  {readingText(indexed.building)}
                </html.span>
                <html.div style={styles.readTrack}>
                  <html.div style={[styles.readDone, styles.readWidth(indexed.building.total > 0 ? indexed.building.done / indexed.building.total : 0)]} />
                </html.div>
              </>
            ) : (
              // A search of a large table takes a moment: the count waits for its rows.
              <html.span>{indexed.stale && state.search.trim().length > 0 ? "Searching…" : summary.count}</html.span>
            )}
            {/* Nothing to say of its rows until they're read. */}
            {!indexed.building && (
              <>
                <html.span>·</html.span>
                <Hinted hint={summary.validityHint} style={summary.valid ? styles.validityOk : styles.validityBad}>
                  {summary.validity}
                </Hinted>
              </>
            )}
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
        {state.settingsOpen && (
          <ViewSettings
            key={view.id}
            view={shownView}
            schema={table.schema}
            // Turning a Sheet view into anything else asks first (D41): the reducer's question.
            onChange={(patch) => dispatch({ type: "updateView", patch })}
            onArrange={(patch) => dispatch({ type: "arrange", patch })}
            personal={derived.arranged}
            onSaveForEveryone={() => dispatch({ type: "saveForEveryone" })}
            onReset={() => dispatch({ type: "resetArrangement" })}
            onDelete={table.views.length > 1 ? () => dispatch({ type: "deleteView" }) : undefined}
            onClose={() => dispatch({ type: "settings", open: false })}
            onCancel={() => dispatch({ type: "settings", open: false, revert: true })}
          />
        )}
        {indexed.lost ? (
          <html.div style={styles.indexedNote}>
            This table's rows are no longer in this browser's storage. Open its .table.zip again to bring them back.
          </html.div>
        ) : table.indexed && view.layout !== "table" ? (
          <html.div style={styles.indexedNote}>
            This layout isn't shown for a table this large yet. Change the view's layout to Table in its settings.
          </html.div>
        ) : table.indexed && !indexed.source && !indexed.reading ? null : (
          // A large table shows its rows at once, as its file has them, and as many as
          // have been read so far, while it is read into its index (LARGE-TABLES-PLAN,
          // decision 1): to scroll through and look at. The view's own order, filters and
          // groups, search and editing come with the index. One table view for both, so
          // where you had scrolled to is where you still are when the reading is done.
          <>
            {reading && <html.div style={styles.indexedNote}>{ingestingText(shownView)}</html.div>}
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
                    // The bundle's tables by name, so lookups and rollups reach the ones
                    // they name (D36), within this bundle (D37).
                    relatedTables: bundleTables(tables, bundleOf(activeTablePath)),
                    allRows: table.rows,
                    tableKey: tableNameOf(activeTablePath),
                    sheet,
                    onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
                    onPlace: (p) => dispatch({ type: "place", place: { rowId: p.rowId, field: p.field } }),
                    restorePlace: state.restoring ? { place: state.restoring.place, n: state.restoring.n } : null,
                    onPlaceMeasure,
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
        </>
        )}
      </html.div>
      {state.openPage && (
        <BodyEditor
          key={`${state.active}/${state.openPage}`}
          rowId={state.openPage}
          rowTitle={rowTitleFor(table, state.openPage)}
          content={table.bodies?.[state.openPage] ?? ""}
          onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
          onClose={() => dispatch({ type: "openPage", rowId: null })}
        />
      )}
    </html.div>
    </AttachmentsProvider>
    </DisplaySettingsProvider>
  );
}


interface ViewCallbacks {
  /** For a table held in the index: what its table view reads its rows from. */
  source?: ViewRows;
  onUpdateRow?: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField?: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue?: (fieldName: string, value: string) => void;
  onRemoveEnumValue?: (fieldName: string, value: string) => void;
  onDeleteField?: (fieldName: string) => void;
  /** Where you are in the table, for history (the cell selected), and putting it back. */
  onPlace?: (place: { rowId?: string; field?: string }) => void;
  restorePlace?: { place: { rowId?: string; field?: string }; n: number } | null;
  onPlaceMeasure?: (measure: PlaceMeasure | null) => void;
  onMoveField?: (fieldName: string, delta: -1 | 1) => void;
  onRestoreSchema?: (schema: TableSchema) => void;
  onAddField?: (field: Field) => void;
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
          source={cb.source}
          schema={schema}
          bodies={bodies}
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
