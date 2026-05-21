import { useCallback, useState } from "react";
import { html, css } from "react-strict-dom";
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
  TableView,
} from "@workspace.sh/table-ui";

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
    fontSize: 12,
    marginBottom: 16,
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
    marginBottom: 12,
  },
  viewTab: {
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
    <html.div style={styles.root}>
      <html.div style={styles.content}>
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
        {renderView(view, table, visibleRows, {
          onUpdateRow: updateRow,
          onUpdateField: updateField,
          onAddEnumValue: addEnumValue,
          onMoveField: moveField,
          onAddField: addField,
          onOpenBody: openBody,
          onUpdateView: updateActiveView,
        })}
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
  );
}
