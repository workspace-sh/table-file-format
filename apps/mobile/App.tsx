import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Alert, AppState, Platform, ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { isSheet, newId } from "@workspace.sh/table-core";
import type { BundleMeta, Field, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import { fixtureAttachmentUrls } from "@workspace.sh/table-fixtures/native-attachments";
import {
  AttachmentsProvider,
  BodyEditor,
  BoardView,
  CalendarView,
  DisplaySettingsProvider,
  GalleryView,
  ListView,
  PortalHost,
  TableView,
  ViewSettings,
  canInsertAt,
} from "@workspace.sh/table-ui";
import {
  ARRANGEMENTS_KEY,
  DISPLAY_KEY,
  SIDEBAR_KEY,
  STORAGE_KEY,
  bundleOf,
  bundleTables,
  derive,
  fromBundle,
  initialAppState,
  loadArrangements,
  loadDisplay,
  loadSaved,
  loadSidebarPrefs,
  rowTitleFor,
  save,
  schemaVersions,
  tableNameOf,
  viewCallbacks,
  withNewFixtures,
  type Confirm,
  type KeyValueStore,
  type NamePrompt,
  type SheetGridShown,
} from "@workspace.sh/table-app";
import { useTableApp } from "@workspace.sh/table-app/react";
import { openStore } from "./store";
import { TablesSheet } from "./TablesSheet";

// Horizontal page padding. Used as positive padding on the scroll
// container AND as negative margin on horizontally-scrolling sections
// (table, board) so their scroll viewport extends to the screen edges
// — iOS edge-to-edge pattern. Content starts at the same x as the
// title/tabs/search above, but scrolls past the right padding instead
// of being clipped by it.
const MOBILE_H_PADDING = 16;

// Every fixture bundle's tables, keyed `bundle/table` (D37), as the web,
// macOS and Linux apps hold them, and each bundle's manifest.
const initialTables: Record<string, ParsedTable> = Object.assign(
  {},
  ...Object.entries(fixtureBundles).map(([name, b]) => fromBundle(name, b)),
);
const bundleMetas: Record<string, BundleMeta> = Object.fromEntries(
  Object.entries(fixtureBundles).map(([name, b]) => [name, b.meta]),
);
const INITIAL_SCHEMA_VERSIONS = schemaVersions(initialTables);

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#0e0e10",
    },
  },
  scroll: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    paddingInline: MOBILE_H_PADDING,
    paddingBlock: 16,
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
    marginBottom: 12,
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
  tab: {
    paddingInline: 10,
    paddingBlock: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: "transparent",
    fontSize: 11,
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
    marginBottom: 14,
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
  toolbar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  tool: {
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: 13,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
    backgroundColor: {
      default: "#ffffff",
      "@media (prefers-color-scheme: dark)": "#1c1c1e",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  toolOn: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#2c2c30",
    },
  },
  searchGrow: {
    flex: 1,
    marginBottom: 0,
  },
  picker: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 32,
    paddingInline: 0,
    marginBottom: 2,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  pickerText: {
    fontSize: 13,
    fontWeight: "500",
    color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
  pickerChevron: {
    fontSize: 13,
    color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
});

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
      // BoardView handles its own horizontal scroll: snap-paging on touch
      // viewports, free scroll on wide ones.
      return <BoardView {...common} onUpdateRow={cb.onUpdateRow} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />;
    case "gallery":
      return <GalleryView {...common} onOpenBody={cb.onOpenBody} />;
    case "list":
      return <ListView {...common} onOpenBody={cb.onOpenBody} onUpdateView={cb.onUpdateView} />;
    case "calendar":
      return <CalendarView {...common} onOpenBody={cb.onOpenBody} />;
    default:
      // TableView manages its own horizontal scroll: the pane to the right
      // of the frozen primary column.
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
 * Ask for a name, worded by table-app's namePrompt: the system's text
 * prompt on iOS. Android has none, so there it answers as cancelled until
 * the app draws its own.
 */
function askName(prompt: NamePrompt, then: (name: string) => void, cancel: () => void) {
  if (Platform.OS !== "ios") return cancel();
  Alert.prompt(prompt.heading, undefined, [
    { text: "Cancel", style: "cancel", onPress: cancel },
    { text: prompt.action, onPress: (value?: string) => then(value ?? "") },
  ]);
}

// SafeAreaView's TS types under react-native-safe-area-context 5.6.2 +
// React 19.2 don't expose `style` on its props bag (likely upstream type
// bug). Pre-built JSX element bypasses the prop-type check; runtime
// behavior is correct. Drop the cast when the package types are fixed.
const Safe = SafeAreaView as unknown as ComponentType<{
  style?: { flex?: number };
  children?: ReactNode;
}>;

/**
 * Edits are kept between launches (#86), as the web keeps them between
 * reloads: the saved tables are read before the first screen, and nothing
 * shows until they are (a moment, from the phone's own storage).
 */
export default function App() {
  const [store, setStore] = useState<KeyValueStore | null | undefined>(undefined);
  useEffect(() => {
    // No store (it failed to open) still runs, from the fixtures, unsaved.
    openStore([STORAGE_KEY, ARRANGEMENTS_KEY, DISPLAY_KEY, SIDEBAR_KEY]).then(setStore, () => setStore(null));
  }, []);
  return store === undefined ? null : <TableApp store={store} />;
}

function TableApp({ store }: { store: KeyValueStore | null }) {
  // The platform's language, when the viewer hasn't chosen one.
  const systemLocale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, []);
  // Everything the app holds is table-app's state (docs/APP-STATE.md), as
  // on the web, macOS and Linux: what was saved, or the fixtures when
  // nothing usable was (fixture tables added since still appear).
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
    // Saved on the phone after every edit. The fixtures themselves are
    // never saved, so an untouched app keeps following them as they change.
    { store, write: async (_edited, tables, bundles) => save(store, { tables, bundles }) },
    systemLocale,
  );
  const { tables, bundles, active } = state;
  const derived = derive(state, { locale: systemLocale });
  const { table, view, summary } = derived;
  const { view: shownView, rows: visibleRows, sheet } = derived.shown;

  // Going to the background may be the last the app sees before it's
  // ended: what's left is written first.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") void flush();
    });
    return () => sub.remove();
  }, [flush]);

  // Questions as native alerts; messages as alerts.
  useEffect(() => {
    const asking = state.asking;
    if (!asking) return;
    if (asking.kind === "name") {
      askName(asking.prompt, (text) => dispatch({ type: "answer", response: "create", text }), () =>
        dispatch({ type: "answer", response: "cancel" }),
      );
      return;
    }
    ask(asking.confirm, (response) => dispatch({ type: "answer", response }));
  }, [state.asking, dispatch]);
  useEffect(() => {
    if (!state.telling) return;
    Alert.alert(state.telling.heading, state.telling.body);
    dispatch({ type: "told" });
  }, [state.telling, dispatch]);

  // The view on screen's callbacks, each an action (table-app's viewCallbacks).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const callbacks = useMemo(() => viewCallbacks(state, dispatch, newId), [tables, bundles, active]);
  // The sheet of files and tables, open or not.
  const [tablesOpen, setTablesOpen] = useState(false);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AttachmentsProvider value={(file) => fixtureAttachmentUrls[active]?.[file]}>
        <PortalHost>
          <DisplaySettingsProvider value={display}>
          <html.div style={styles.root}>
            <Safe style={{ flex: 1 }}>
              <html.div style={styles.scroll}>
                {/* Where this view is, and the way to the other tables: a sheet of files and tables. */}
                <html.button onClick={() => setTablesOpen(true)} aria-label="Choose a table" style={styles.picker}>
                  <html.span dir="auto" style={styles.pickerText}>{derived.breadcrumb.text}</html.span>
                  <html.span style={styles.pickerChevron}>⌄</html.span>
                </html.button>
                <html.span dir="auto" style={styles.title}>{view.name}</html.span>
                <html.div style={styles.subtitle}>
                  <html.span>{summary.count}</html.span>
                  <html.span>·</html.span>
                  <html.span style={summary.valid ? styles.validityOk : styles.validityBad}>{summary.validity}</html.span>
                  {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
                  {summary.schemaChanged && <html.span style={styles.schemaBumpBadge}>{summary.schemaChangedLabel}</html.span>}
                </html.div>
                {/* This table's views, one line that scrolls sideways to the screen's edges. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0, marginHorizontal: -MOBILE_H_PADDING, marginBottom: 10 }}
                  contentContainerStyle={{ paddingHorizontal: MOBILE_H_PADDING, gap: 6 }}
                >
                  {table.views.map((v) => (
                    <html.button
                      key={v.id}
                      onClick={() => dispatch({ type: "showView", key: active, viewId: v.id })}
                      aria-current={v.id === view.id ? true : undefined}
                      style={[styles.tab, v.id === view.id && styles.tabActive]}
                    >
                      {v.name}
                    </html.button>
                  ))}
                  <html.button onClick={() => dispatch({ type: "addView", id: newId() })} style={styles.tab}>
                    + New view
                  </html.button>
                </ScrollView>
                <html.div style={styles.toolbar}>
                  <html.button
                    onClick={() => dispatch({ type: "settings", open: !state.settingsOpen })}
                    style={[styles.tool, state.settingsOpen && styles.toolOn]}
                  >
                    View settings
                  </html.button>
                  <html.input
                    type="text"
                    placeholder="Search…"
                    value={state.search}
                    onChange={(e: { target: { value: string } }) => dispatch({ type: "search", text: e.target.value })}
                    style={[styles.searchInput, styles.searchGrow]}
                  />
                </html.div>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                  // The keyboard makes room rather than covering the cell being edited,
                  // and a tap elsewhere while typing goes to what's tapped.
                  automaticallyAdjustKeyboardInsets
                  keyboardShouldPersistTaps="handled"
                >
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
                    relatedTables: bundleTables(tables, bundleOf(active)),
                    allRows: table.rows,
                    tableKey: tableNameOf(active),
                    sheet,
                    onInsertRow: isSheet(view) && canInsertAt(view) ? callbacks.onInsertRow : undefined,
                  })}
                </ScrollView>
              </html.div>
            </Safe>
            <TablesSheet
              open={tablesOpen}
              files={derived.sidebarTree}
              active={active}
              onChoose={(key) => {
                dispatch({ type: "showTable", key });
                setTablesOpen(false);
              }}
              onClose={() => setTablesOpen(false)}
            />
            {state.openPage && (
              <BodyEditor
                rowId={state.openPage}
                rowTitle={rowTitleFor(table, state.openPage)}
                content={table.bodies?.[state.openPage] ?? ""}
                onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content })}
                onClose={() => dispatch({ type: "openPage", rowId: null })}
              />
            )}
          </html.div>
          </DisplaySettingsProvider>
        </PortalHost>
        </AttachmentsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
