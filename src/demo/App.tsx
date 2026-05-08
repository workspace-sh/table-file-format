import { useCallback, useState } from "react";
import { html, css } from "react-strict-dom";
import { applyView, searchRows, validate } from "../core/index.js";
import type { ParsedTable, Row, TableSchema, View } from "../core/types.js";
import { projectsTable } from "./loadFixture.js";
import { Sidebar } from "./Sidebar.js";
import { TableView, KanbanView, GalleryView, ListView } from "./views.js";

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

export function App() {
  const [table, setTable] = useState<ParsedTable>(projectsTable);
  const [activeViewId, setActiveViewId] = useState(table.views[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");

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

  const viewRows = applyView(table, view);
  const visibleRows = searchRows(viewRows, searchQuery, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);
  const searching = searchQuery.trim().length > 0;

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
          </html.div>
        </html.div>
        {renderView(view, visibleRows, table.schema, table.bodies, updateRow)}
      </html.div>
    </html.div>
  );
}

function renderView(
  view: View,
  rows: Row[],
  schema: TableSchema,
  bodies: Record<string, string> | undefined,
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void,
) {
  switch (view.layout) {
    case "kanban":
      return <KanbanView view={view} rows={rows} schema={schema} bodies={bodies} />;
    case "gallery":
      return <GalleryView view={view} rows={rows} schema={schema} bodies={bodies} />;
    case "list":
      return <ListView view={view} rows={rows} schema={schema} bodies={bodies} />;
    case "calendar":
    case "table":
    default:
      return (
        <TableView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onUpdateRow={onUpdateRow}
        />
      );
  }
}
