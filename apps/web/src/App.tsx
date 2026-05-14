import { useCallback, useState } from "react";
import { html, css } from "react-strict-dom";
import { applyView, searchRows, validate } from "@workspace/table-core";
import type {
  Field,
  ParsedTable,
  Row,
  TableSchema,
  View,
} from "@workspace/table-core";
import {
  BodyEditor,
  GalleryView,
  KanbanView,
  ListView,
  TableView,
} from "@workspace/table-ui";
import { projectsTable } from "./loadFixture";
import { Sidebar } from "./Sidebar";

const INITIAL_SCHEMA_VERSION =
  (projectsTable.schema["schema-version"] as number | undefined) ?? 1;

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
    paddingHorizontal: 24,
    paddingVertical: 20,
    overflow: "auto",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 16,
  },
  headerTopRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
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
    paddingHorizontal: 6,
    paddingVertical: 1,
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
  searchInput: {
    width: 240,
    paddingHorizontal: 10,
    paddingVertical: 6,
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

function bumpSchemaVersion(schema: TableSchema): TableSchema {
  const current = (schema["schema-version"] as number | undefined) ?? 1;
  return { ...schema, "schema-version": current + 1 };
}

export function App() {
  const [table, setTable] = useState<ParsedTable>(projectsTable);
  const [activeViewId, setActiveViewId] = useState(table.views[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);

  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0];
  if (!view) throw new Error("table has no views");

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => {
      setTable((t) => ({
        ...t,
        rows: t.rows.map((row) =>
          row.id === rowId ? { ...row, [fieldName]: value } : row,
        ),
      }));
    },
    [],
  );

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

  // Cosmetic field edits (title, description) do NOT bump schema-version.
  // Structural edits (required, deprecated, enum add, add field, reorder) DO.
  const updateField = useCallback((fieldName: string, patch: Partial<Field>) => {
    setTable((t) => {
      const fields = t.schema.fields.map((f) =>
        f.name === fieldName ? { ...f, ...patch } : f,
      );
      const isStructural =
        "constraints" in patch || "deprecated" in patch || "relation" in patch;
      const nextSchema: TableSchema = isStructural
        ? bumpSchemaVersion({ ...t.schema, fields })
        : { ...t.schema, fields };
      return { ...t, schema: nextSchema };
    });
  }, []);

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

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTable((t) => ({
        ...t,
        views: t.views.map((v) => (v.id === activeViewId ? { ...v, ...patch } : v)),
      }));
    },
    [activeViewId],
  );

  const viewRows = applyView(table, view);
  const visibleRows = searchRows(viewRows, searchQuery, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);
  const searching = searchQuery.trim().length > 0;
  const currentSchemaVersion =
    (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped = currentSchemaVersion > INITIAL_SCHEMA_VERSION;

  return (
    <html.div style={styles.root}>
      <Sidebar table={table} activeViewId={view.id} onSelect={setActiveViewId} />
      <html.div style={styles.main}>
        <html.div style={styles.header}>
          <html.div style={styles.headerTopRow}>
            <html.span style={styles.title}>{view.name}</html.span>
            <html.input
              type="search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e: { target: { value: string } }) =>
                setSearchQuery(e.target.value)
              }
              style={styles.searchInput}
            />
          </html.div>
          <html.div style={styles.subtitle}>
            <html.span>
              {searching
                ? `${visibleRows.length} of ${viewRows.length} matching`
                : `${visibleRows.length} of ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`}
            </html.span>
            <html.span>·</html.span>
            <html.span style={errors.length === 0 ? styles.validityOk : styles.validityBad}>
              {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`}
            </html.span>
            {schemaBumped && (
              <>
                <html.span>·</html.span>
                <html.span style={styles.schemaBumpBadge}>
                  schema v{currentSchemaVersion}
                </html.span>
              </>
            )}
          </html.div>
        </html.div>
        {renderView(view, visibleRows, table.schema, table.bodies, {
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
  onOpenBody: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
}

function renderView(
  view: View,
  rows: Row[],
  schema: TableSchema,
  bodies: Record<string, string> | undefined,
  cb: ViewCallbacks,
) {
  switch (view.layout) {
    case "kanban":
      return (
        <KanbanView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onUpdateRow={cb.onUpdateRow}
          onOpenBody={cb.onOpenBody}
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
        />
      );
    case "calendar":
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
          onOpenBody={cb.onOpenBody}
        />
      );
  }
}
