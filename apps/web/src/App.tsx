import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { html, css } from "react-strict-dom";
import { isSheet, newId } from "@workspace.sh/table-core";
import type { Field, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
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

const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

// What the Files side of the sidebar lists and opens: each bundle's files
// as saving writes them, and fixture tables' attachments.
const attachmentsOf = (key: string) => Object.keys(attachmentUrls[key] ?? {}).sort();

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
    // Saved after every edit, in this browser. The fixtures themselves are
    // never saved, so an untouched demo keeps following them as they change.
    { store: browserStore(), write: async (_edited, tables, bundles) => save(browserStore(), { tables, bundles }) },
    browserLocale,
  );
  const { tables, bundles, active: activeTablePath, display, sidebar: sidebarPrefs } = state;
  const derived = derive(state, { locale: browserLocale, attachmentsOf });
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
      bytes = await bundleToArchive(bundle, toBundle(tables, bundles, bundle));
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
        const library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
        dispatch({ type: "opened", library, skipped: opened.skipped });
      } catch (error) {
        dispatch({ type: "tell", message: { heading: openFailedText(file.name, error) } });
      }
    });
    document.body.appendChild(input);
    input.click();
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
  });

  // The view on screen's callbacks, each an action (table-app's viewCallbacks).
  const callbacks = useMemo(() => viewCallbacks(state, dispatch, newId), [tables, bundles, activeTablePath]);

  // A Sheet view's grid as saved, for its row numbers and for formulas
  // typed in it (D41); and every Sheet view a formula may name.
  const { view: shownView, rows: visibleRows, sheet } = shownArranged;

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
          />
        )}
        {renderView(shownView, visibleRows, table.schema, table.bodies, {
          ...callbacks,
          // The bundle's tables by name, so lookups and rollups reach the ones
          // they name (D36), within this bundle (D37).
          relatedTables: bundleTables(tables, bundleOf(activeTablePath)),
          allRows: table.rows,
          tableKey: tableNameOf(activeTablePath),
          sheet,
          onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
        })}
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
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue: (fieldName: string, value: string) => void;
  onMoveField: (fieldName: string, delta: -1 | 1) => void;
  onAddField: (field: Field) => void;
  onAddRow: () => string | void;
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
