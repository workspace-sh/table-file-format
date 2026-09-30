// The macOS app's sidebar: table-app's sidebarTree drawn as a Mac source
// list. Each .table file folds; its tables list their row counts; the open
// table lists its views (D37). The file actions sit at the foot, outside
// the tree.

import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import type { SidebarBundle } from "@workspace.sh/table-app";

export interface SidebarProps {
  tree: SidebarBundle[];
  onToggleFile: (bundle: string) => void;
  onSelectTable: (key: string) => void;
  onSelectView: (key: string, viewId: string) => void;
  onNewTable: () => void;
  onNewView: () => void;
  /** The actions at the foot: new file, open folder, open zip, display. */
  footer: { label: string; onPress: () => void; active?: boolean }[];
}

export function Sidebar({ tree, onToggleFile, onSelectTable, onSelectView, onNewTable, onNewView, footer }: SidebarProps) {
  return (
    <html.div style={styles.sidebar}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBlock: 12 }}>
        {tree.map((file) => (
          <html.div key={file.bundle} style={styles.group}>
            <html.button aria-expanded={!file.folded} onClick={() => onToggleFile(file.bundle)} style={styles.fileRow}>
              <html.span style={styles.chevron}>{file.folded ? "›" : "⌄"}</html.span>
              <html.span style={styles.fileTitle}>{file.title}</html.span>
              <html.span style={styles.fileName}>{file.file}</html.span>
            </html.button>
            {file.tables.map((table) => (
              <html.div key={table.key} style={styles.group}>
                <html.button
                  aria-expanded={table.expanded}
                  onClick={() => onSelectTable(table.key)}
                  style={[styles.row, styles.tableRow, table.expanded && styles.rowOpen]}
                >
                  <html.span style={[styles.name, table.expanded && styles.nameOpen]}>{table.title}</html.span>
                  <html.span style={styles.count}>{String(table.rowCount)}</html.span>
                </html.button>
                {table.views.map((view) => (
                  <html.button
                    key={view.id}
                    aria-current={view.active ? "page" : undefined}
                    onClick={() => onSelectView(table.key, view.id)}
                    style={[styles.row, styles.viewRow, view.active && styles.rowActive]}
                  >
                    <html.span style={styles.name}>{view.name}</html.span>
                    <html.span style={styles.count}>{view.layoutLabel}</html.span>
                  </html.button>
                ))}
                {table.expanded && (
                  <html.button onClick={onNewView} style={[styles.row, styles.viewRow, styles.action]}>
                    + New view
                  </html.button>
                )}
              </html.div>
            ))}
            {file.offersNewTable && (
              <html.button onClick={onNewTable} style={[styles.row, styles.tableRow, styles.action]}>
                + New table
              </html.button>
            )}
          </html.div>
        ))}
      </ScrollView>
      <html.div style={styles.footer}>
        {footer.map((a) => (
          <html.button key={a.label} onClick={a.onPress} style={[styles.row, styles.footerRow, a.active && styles.rowActive]}>
            {a.label}
          </html.button>
        ))}
      </html.div>
    </html.div>
  );
}

const text = { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" };
const dim = { default: "#8e8e93", "@media (prefers-color-scheme: dark)": "#8a8a93" };

const styles = css.create({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: 260,
    flexShrink: 0,
    borderInlineEndWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2c2c31" },
    backgroundColor: { default: "#f5f5f7", "@media (prefers-color-scheme: dark)": "#141416" },
  },
  group: { display: "flex", flexDirection: "column" },
  fileRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingInline: 12,
    paddingBlock: 4,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  chevron: { width: 12, fontSize: 12, color: dim },
  fileTitle: { flexShrink: 1, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, color: dim },
  fileName: { fontSize: 10, color: dim },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginInline: 8,
    paddingBlock: 5,
    paddingInline: 10,
    borderRadius: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontSize: 13,
    color: text,
  },
  tableRow: { paddingInlineStart: 22 },
  viewRow: { paddingInlineStart: 36 },
  rowOpen: {},
  rowActive: { backgroundColor: { default: "#dcdce1", "@media (prefers-color-scheme: dark)": "#2a2a2e" } },
  name: { flexShrink: 1, fontSize: 13, color: text },
  nameOpen: { fontWeight: "600" },
  count: { fontSize: 11, color: dim },
  action: { fontSize: 12, color: dim },
  footer: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: 8,
    borderTopWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2c2c31" },
  },
  footerRow: { fontSize: 12 },
});
