import { html, css } from "react-strict-dom";
import type { ParsedTable } from "@workspace.sh/table-core";

const styles = css.create({
  root: {
    display: "flex",
    flexDirection: "column",
    width: 240,
    paddingBlock: 16,
    paddingInline: 12,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    backgroundColor: {
      default: "#fafafa",
      "@media (prefers-color-scheme: dark)": "#0a0a0c",
    },
  },
  header: {
    display: "flex",
    flexDirection: "column",
    paddingInline: 8,
    paddingBlock: 8,
    marginBottom: 12,
  },
  tableTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  tableSubtitle: {
    fontSize: 12,
    marginTop: 2,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingInline: 8,
    marginBottom: 4,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  list: {
    display: "flex",
    flexDirection: "column",
  },
  item: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingInline: 8,
    paddingBlock: 6,
    borderRadius: 6,
    cursor: "pointer",
  },
  itemActive: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#1f1f23",
    },
  },
  itemName: {
    flex: 1,
    fontSize: 13,
  },
  itemLayout: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
});

interface SidebarProps {
  table: ParsedTable;
  activeViewId: string;
  onSelect: (viewId: string) => void;
}

export function Sidebar({ table, activeViewId, onSelect }: SidebarProps) {
  return (
    <html.div style={styles.root}>
      <html.div style={styles.header}>
        <html.span style={styles.tableTitle}>{table.meta.title ?? "Untitled"}</html.span>
        <html.span style={styles.tableSubtitle}>
          {table.rows.length} {table.rows.length === 1 ? "row" : "rows"} · {table.schema.fields.length} fields
        </html.span>
      </html.div>
      <html.span style={styles.sectionLabel}>Views</html.span>
      <html.div style={styles.list}>
        {table.views.map((view) => (
          <html.div
            key={view.id}
            style={[styles.item, view.id === activeViewId && styles.itemActive]}
            onClick={() => onSelect(view.id)}
          >
            <html.span style={styles.itemName}>{view.name}</html.span>
            <html.span style={styles.itemLayout}>{view.layout}</html.span>
          </html.div>
        ))}
      </html.div>
    </html.div>
  );
}
