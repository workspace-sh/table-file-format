import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { applyView, searchRows, validate } from "@workspace/table-core";
import type { ParsedTable, View } from "@workspace/table-core";
import {
  GalleryView,
  KanbanView,
  ListView,
  TableView,
} from "@workspace/table-ui";
import { fixture } from "./src/fixture";

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
    paddingInline: 16,
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

function renderView(view: View, table: ParsedTable, visibleRows: ParsedTable["rows"]) {
  const common = {
    view,
    rows: visibleRows,
    schema: table.schema,
    bodies: table.bodies,
  };
  // Wrap table + kanban in a horizontal ScrollView so portrait users can
  // scroll past the viewport — Airtable / Notion / Trello pattern. Cells
  // have `minWidth: 120` in the UI package so they don't collapse mid-word
  // when content is wider than the screen. Gallery wraps naturally; List
  // is vertical-only — neither needs horizontal scroll.
  switch (view.layout) {
    case "kanban":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <KanbanView {...common} />
        </ScrollView>
      );
    case "gallery":
      return <GalleryView {...common} />;
    case "list":
      return <ListView {...common} />;
    default:
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TableView {...common} />
        </ScrollView>
      );
  }
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
  const table: ParsedTable = fixture;
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
    <SafeAreaProvider>
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
            {renderView(view, table, visibleRows)}
          </html.div>
        </Safe>
      </html.div>
    </SafeAreaProvider>
  );
}
