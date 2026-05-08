import { useState } from "react";
import { html, css } from "react-strict-dom";
import { applyView, validate } from "../core/index.js";
import type { Row, TableSchema, View } from "../core/types.js";
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
});

export function App() {
  const table = projectsTable;
  const [activeViewId, setActiveViewId] = useState(table.views[0]?.id ?? "");
  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0];
  if (!view) throw new Error("table has no views");

  const rows = applyView(table, view);
  const errors = validate(table.schema, table.rows);

  return (
    <html.div style={styles.root}>
      <Sidebar table={table} activeViewId={view.id} onSelect={setActiveViewId} />
      <html.div style={styles.main}>
        <html.div style={styles.header}>
          <html.span style={styles.title}>{view.name}</html.span>
          <html.div style={styles.subtitle}>
            <html.span>
              {rows.length} of {table.rows.length} {table.rows.length === 1 ? "row" : "rows"}
            </html.span>
            <html.span>·</html.span>
            <html.span style={errors.length === 0 ? styles.validityOk : styles.validityBad}>
              {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`}
            </html.span>
          </html.div>
        </html.div>
        {renderView(view, rows, table.schema)}
      </html.div>
    </html.div>
  );
}

function renderView(view: View, rows: Row[], schema: TableSchema) {
  switch (view.layout) {
    case "kanban":
      return <KanbanView view={view} rows={rows} schema={schema} />;
    case "gallery":
      return <GalleryView view={view} rows={rows} schema={schema} />;
    case "list":
      return <ListView view={view} rows={rows} schema={schema} />;
    case "calendar":
    case "table":
    default:
      return <TableView view={view} rows={rows} schema={schema} />;
  }
}
