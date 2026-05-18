import { useState } from "react";
import { html, css } from "react-strict-dom";
import { applyView, searchRows, validate } from "@workspace/table-core";
import type { ParsedTable, View } from "@workspace/table-core";
import { projectsTable } from "@workspace/table-fixtures";
import {
  GalleryView,
  BoardView,
  ListView,
  TableView,
} from "@workspace/table-ui";

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

function renderView(view: View, table: ParsedTable, visibleRows: ParsedTable["rows"]) {
  const common = {
    view,
    rows: visibleRows,
    schema: table.schema,
    bodies: table.bodies,
  };
  switch (view.layout) {
    case "board":
      return <BoardView {...common} />;
    case "gallery":
      return <GalleryView {...common} />;
    case "list":
      return <ListView {...common} />;
    default:
      return <TableView {...common} />;
  }
}

export default function App() {
  const table: ParsedTable = projectsTable;
  const [activeViewId, setActiveViewId] = useState<string>(table.views[0]!.id);
  const [query, setQuery] = useState<string>("");

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
        {renderView(view, table, visibleRows)}
      </html.div>
    </html.div>
  );
}
