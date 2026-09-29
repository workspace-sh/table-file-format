import { useCallback, useMemo, useState } from "react";
import { html, css } from "react-strict-dom";
import { ScrollView } from "react-native";
// Gesture handler root view enables RNGH's native gesture recognizers
// for the entire subtree. Required once per app at the root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Alert } from "react-native";
import { newId, parseAddress, validate } from "@workspace.sh/table-core";
import type { BundleMeta, Field, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
import { bundles as fixtureBundles } from "@workspace.sh/table-fixtures";
import {
  BodyEditor,
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  PortalHost,
  TableView,
  canInsertAt,
} from "@workspace.sh/table-ui";
import {
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
    flexDirection: "column",
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
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  tabRow: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
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

export default function App() {
  const [tables, setTables] = useState<Record<string, ParsedTable>>(initialTables);
  const [activeTablePath, setActiveTablePath] = useState<string>(DEFAULT_TABLE_PATH);
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialTables).map(([key, t]) => [key, t.views[0]?.id ?? ""])),
  );
  const [query, setQuery] = useState<string>("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);

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
      const key = keyForAddress(addr, tables, bundleMetas, bundleOf(activeTablePath));
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
  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0]!;
  // The view's rows and a Sheet view's saved grid, worked out as on the web (table-app).
  const sheet = useMemo(() => sheetShown(tables, activeTablePath, view), [tables, activeTablePath, view]);
  const { view: shownView, rows: visibleRows, inView } = showView(tables, activeTablePath, view, { search: query });
  const inBundle = bundleTables(tables, bundleOf(activeTablePath));
  const errors = validate(table.schema, table.rows);
  const searching = query.trim().length > 0;
  const tablePaths = Object.keys(tables);
  const showTablePicker = tablePaths.length > 1;
  const currentSchemaVersion = (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped = currentSchemaVersion > (INITIAL_SCHEMA_VERSIONS[activeTablePath] ?? 1);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PortalHost>
        <html.div style={styles.root}>
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
            {showTablePicker && (
              <>
                <html.span style={styles.sectionLabel}>Tables</html.span>
                <html.div style={styles.tabRow}>
                  {tablePaths.map((path) => (
                    <html.button
                      key={path}
                      onClick={() => {
                        setActiveTablePath(path);
                        setQuery("");
                        setActiveBodyRowId(null);
                      }}
                      style={[styles.tab, path === activeTablePath && styles.tabActive]}
                    >
                      {tables[path]!.meta.title ?? tableNameOf(path)}
                    </html.button>
                  ))}
                </html.div>
              </>
            )}
            <html.span style={styles.sectionLabel}>Views</html.span>
            <html.div style={styles.tabRow}>
              {table.views.map((v) => (
                <html.button
                  key={v.id}
                  onClick={() => setActiveViewId(v.id)}
                  style={[styles.tab, v.id === activeViewId && styles.tabActive]}
                >
                  {v.name}
                </html.button>
              ))}
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
      </PortalHost>
    </GestureHandlerRootView>
  );
}
