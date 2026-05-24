import { useCallback, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import "react-native-gesture-handler";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { applyView, searchRows, validate } from "@workspace.sh/table-core";
import type {
  Field,
  ParsedTable,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import { projectsTable } from "@workspace.sh/table-fixtures";
import {
  BodyEditor,
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  PortalHost,
  TableView,
} from "@workspace.sh/table-ui";

// Horizontal page padding. Used as positive padding on the scroll
// container AND as negative margin on horizontally-scrolling sections
// (table, board) so their scroll viewport extends to the screen edges
// — iOS edge-to-edge pattern. Content starts at the same x as the
// title/tabs/search above, but scrolls past the right padding instead
// of being clipped by it.
const MOBILE_H_PADDING = 16;

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
    fontSize: 12,
    marginBottom: 12,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  viewTabs: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 10,
  },
  viewTab: {
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
  viewTabActive: {
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
});

/** Mirrors the policy used by apps/web and apps/desktop. */
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
  };
  switch (view.layout) {
    case "board":
      // BoardView handles its own horizontal scroll — snap-paging
      // carousel on touch viewports, free scroll on wide ones.
      return <BoardView {...common} onUpdateRow={cb.onUpdateRow} />;
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
      // TableView manages its own horizontal scroll internally now (the
      // scrollable pane to the right of the frozen primary column).
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

// SafeAreaView's TS types under react-native-safe-area-context 5.6.2 +
// React 19.2 don't expose `style` on its props bag (likely upstream type
// bug). Pre-built JSX element bypasses the prop-type check; runtime
// behavior is correct. Drop the cast when the package types are fixed.
const Safe = SafeAreaView as unknown as ComponentType<{
  style?: { flex?: number };
  children?: ReactNode;
}>;

export default function App() {
  const [table, setTable] = useState<ParsedTable>(projectsTable);
  const [activeViewId, setActiveViewId] = useState<string>(table.views[0]!.id);
  const [query, setQuery] = useState<string>("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => {
      setTable((t) => ({
        ...t,
        rows: t.rows.map((r) =>
          r.id === rowId ? { ...r, [fieldName]: value } : r,
        ),
      }));
    },
    [],
  );

  const updateField = useCallback(
    (fieldName: string, patch: Partial<Field>) => {
      setTable((t) => {
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
        return { ...t, schema: nextSchema };
      });
    },
    [],
  );

  const addEnumValue = useCallback((fieldName: string, value: string) => {
    setTable((t) => {
      const fields = t.schema.fields.map((f) => {
        if (f.name !== fieldName) return f;
        const existing = f.constraints?.enum ?? [];
        if (existing.includes(value)) return f;
        return {
          ...f,
          constraints: { ...(f.constraints ?? {}), enum: [...existing, value] },
        };
      });
      return { ...t, schema: bumpSchemaVersion({ ...t.schema, fields }) };
    });
  }, []);

  const moveField = useCallback((fieldName: string, delta: -1 | 1) => {
    setTable((t) => {
      const from = t.schema.fields.findIndex((f) => f.name === fieldName);
      if (from === -1) return t;
      const to = from + delta;
      if (to < 0 || to >= t.schema.fields.length) return t;
      const fields = t.schema.fields.slice();
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved!);
      return { ...t, schema: bumpSchemaVersion({ ...t.schema, fields }) };
    });
  }, []);

  const addField = useCallback((field: Field) => {
    setTable((t) => {
      if (t.schema.fields.some((f) => f.name === field.name)) return t;
      const fields = [...t.schema.fields, field];
      return { ...t, schema: bumpSchemaVersion({ ...t.schema, fields }) };
    });
  }, []);

  const updateBody = useCallback((rowId: string, content: string) => {
    setTable((t) => {
      const bodies = { ...(t.bodies ?? {}) };
      if (content.length === 0) delete bodies[rowId];
      else bodies[rowId] = content;
      return { ...t, bodies };
    });
  }, []);

  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTable((t) => ({
        ...t,
        views: t.views.map((v) =>
          v.id === activeViewId ? { ...v, ...patch } : v,
        ),
      }));
    },
    [activeViewId],
  );

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0]!;
  const viewRows = applyView(table, view);
  const visibleRows = searchRows(viewRows, query, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PortalHost>
          <html.div style={styles.root}>
        <Safe style={{ flex: 1 }}>
          <html.div style={styles.scroll}>
            <html.span style={styles.title}>{table.meta.title ?? "Untitled"}</html.span>
            <html.span style={styles.subtitle}>
              {visibleRows.length} of {table.rows.length} rows ·{" "}
              {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation issues`}
            </html.span>
            <html.div style={styles.viewTabs}>
              {table.views.map((v) => (
                <html.button
                  key={v.id}
                  onClick={() => setActiveViewId(v.id)}
                  style={[styles.viewTab, v.id === activeViewId && styles.viewTabActive]}
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
              showsVerticalScrollIndicator={false}
            >
              {renderView(view, table, visibleRows, {
                onUpdateRow: updateRow,
                onUpdateField: updateField,
                onAddEnumValue: addEnumValue,
                onMoveField: moveField,
                onAddField: addField,
                onOpenBody: openBody,
                onUpdateView: updateActiveView,
              })}
            </ScrollView>
          </html.div>
        </Safe>
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
