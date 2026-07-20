import { useCallback, useState } from "react";
import { html, css } from "react-strict-dom";
import { ScrollView } from "react-native";
// Gesture handler root view enables RNGH's native gesture recognizers
// for the entire subtree. Required once per app at the root.
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  applyView,
  parseAddress,
  searchRows,
  validate,
} from "@workspace.sh/table-core";
import type {
  Field,
  ParsedTable,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import { tables as initialTables } from "@workspace.sh/table-fixtures";
import {
  BodyEditor,
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  PortalHost,
  TableView,
} from "@workspace.sh/table-ui";

const DEFAULT_TABLE_PATH = "projects";
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

/**
 * Cosmetic field edits (title, description, align) do NOT bump
 * schema-version. Structural edits (constraints, deprecated, relation,
 * enum-add, add-field, reorder) DO. Matches the web App's policy so
 * `.table/` writes have consistent schema-version semantics across
 * platforms.
 */
function bumpSchemaVersion(schema: TableSchema): TableSchema {
  const current = (schema["schema-version"] as number | undefined) ?? 1;
  return { ...schema, "schema-version": current + 1 };
}

interface ViewCallbacks {
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue: (fieldName: string, value: string) => void;
  onMoveField: (fieldName: string, delta: -1 | 1) => void;
  onAddField: (field: Field) => void;
  onOpenBody: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
  relatedTables: Record<string, ParsedTable>;
  onOpenRelation: (address: string) => void;
}

function renderView(
  view: View,
  table: ParsedTable,
  visibleRows: ParsedTable["rows"],
  cb: ViewCallbacks,
) {
  const common = {
    view,
    rows: visibleRows,
    schema: table.schema,
    bodies: table.bodies,
    relatedTables: cb.relatedTables,
    onOpenRelation: cb.onOpenRelation,
  };
  switch (view.layout) {
    case "board":
      return <BoardView {...common} onUpdateRow={cb.onUpdateRow} onOpenBody={cb.onOpenBody} />;
    case "gallery":
      return <GalleryView {...common} onOpenBody={cb.onOpenBody} />;
    case "list":
      return (
        <ListView
          {...common}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
        />
      );
    case "calendar":
      return <CalendarView {...common} onOpenBody={cb.onOpenBody} />;
    default:
      return (
        <TableView
          {...common}
          onUpdateRow={cb.onUpdateRow}
          onUpdateField={cb.onUpdateField}
          onAddEnumValue={cb.onAddEnumValue}
          onMoveField={cb.onMoveField}
          onAddField={cb.onAddField}
          onOpenBody={cb.onOpenBody}
        />
      );
  }
}

function rowTitleFor(table: ParsedTable, rowId: string): string {
  const row = table.rows.find((r) => r.id === rowId);
  if (!row) return rowId;
  const titleField = table.schema.fields[0]?.name;
  const title = titleField ? row[titleField] : undefined;
  return typeof title === "string" ? title : rowId;
}

export default function App() {
  const [tables, setTables] =
    useState<Record<string, ParsedTable>>(initialTables);
  const [activeTablePath, setActiveTablePath] =
    useState<string>(DEFAULT_TABLE_PATH);
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.entries(initialTables).map(([key, t]) => [
          key,
          t.views[0]?.id ?? "",
        ]),
      ),
  );
  const [query, setQuery] = useState<string>("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);

  const table = tables[activeTablePath]!;
  const activeViewId = activeViewIds[activeTablePath] ?? table.views[0]?.id ?? "";

  const setActiveViewId = useCallback(
    (viewId: string) =>
      setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: viewId })),
    [activeTablePath],
  );

  // Apply an Address to app state — shared between relation clicks and
  // any future deep-link transport so both behave identically. Mirrors
  // apps/web/src/App.tsx so cross-table navigation works the same on
  // every platform.
  const applyAddress = useCallback(
    (addr: { tablePath: string; rowId?: string; viewId?: string }) => {
      if (!tables[addr.tablePath]) return;
      setActiveTablePath(addr.tablePath);
      if (addr.viewId) {
        setActiveViewIds((prev) => ({ ...prev, [addr.tablePath]: addr.viewId! }));
      }
      if (addr.rowId) {
        const target = tables[addr.tablePath];
        setActiveBodyRowId(target?.bodies?.[addr.rowId] ? addr.rowId : null);
      } else {
        setActiveBodyRowId(null);
      }
    },
    [tables],
  );

  const openRelation = useCallback(
    (address: string) => {
      const addr = parseAddress(address);
      if (addr) applyAddress(addr);
    },
    [applyAddress],
  );

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => {
      setTables((all) => ({
        ...all,
        [activeTablePath]: {
          ...all[activeTablePath]!,
          rows: all[activeTablePath]!.rows.map((r) =>
            r.id === rowId ? { ...r, [fieldName]: value } : r,
          ),
        },
      }));
    },
    [activeTablePath],
  );

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
          "relation" in patch;
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

  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            views: t.views.map((v) =>
              v.id === activeViewId ? { ...v, ...patch } : v,
            ),
          },
        };
      });
    },
    [activeTablePath, activeViewId],
  );

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0]!;
  const viewRows = applyView(table, view);
  const visibleRows = searchRows(viewRows, query, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);
  const searching = query.trim().length > 0;
  const tablePaths = Object.keys(tables);
  const showTablePicker = tablePaths.length > 1;
  const currentSchemaVersion =
    (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped =
    currentSchemaVersion > (INITIAL_SCHEMA_VERSIONS[activeTablePath] ?? 1);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PortalHost>
        <html.div style={styles.root}>
          <html.div style={styles.content}>
            <html.span style={styles.title}>{view.name}</html.span>
            <html.div style={styles.subtitle}>
              <html.span>
                {searching
                  ? `${visibleRows.length} of ${viewRows.length} matching`
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
              {schemaBumped && (
                <html.span style={styles.schemaBumpBadge}>
                  schema v{currentSchemaVersion}
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
                      {tables[path]!.meta.title ?? path}
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
              {renderView(view, table, visibleRows, {
                onUpdateRow: updateRow,
                onUpdateField: updateField,
                onAddEnumValue: addEnumValue,
                onMoveField: moveField,
                onAddField: addField,
                onOpenBody: openBody,
                onUpdateView: updateActiveView,
                relatedTables: tables,
                onOpenRelation: openRelation,
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
