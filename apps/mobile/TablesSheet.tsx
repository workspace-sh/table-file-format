// The phone's way to the tables: a sheet listing each .table file and the
// tables in it (table-app's sidebar tree, as the other apps' sidebars list
// them), opened from the file › table line at the top. Choosing a table
// shows it and closes the sheet.

import { Modal, ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import type { SidebarBundle } from "@workspace.sh/table-app";

export interface TablesSheetProps {
  open: boolean;
  files: SidebarBundle[];
  /** The table on screen, by `bundle/table` key. */
  active: string;
  onChoose: (key: string) => void;
  /** Make a table in this file. */
  onNewTable: (bundle: string) => void;
  /** The file actions below the list (New .table File…, Open .table.zip…, Export …), worded by table-app's commands. */
  actions: { label: string; onPress: () => void }[];
  onClose: () => void;
  /** iOS: the sheet has finished closing, so another sheet (share, document picker) can open. */
  onDismissed?: () => void;
}

export function TablesSheet({ open, files, active, onChoose, onNewTable, actions, onClose, onDismissed }: TablesSheetProps) {
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismissed}>
      <html.div style={styles.sheet}>
        <html.div style={styles.header}>
          <html.span style={styles.heading}>Tables</html.span>
          <html.button onClick={onClose} style={styles.done}>
            Done
          </html.button>
        </html.div>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {files.map((file) => (
            <html.div key={file.bundle} style={styles.file}>
              <html.div style={styles.fileHeading}>
                <html.span dir="auto" style={styles.fileTitle}>{file.title}</html.span>
                <html.span dir="ltr" style={styles.fileName}>{file.file}</html.span>
              </html.div>
              <html.div style={styles.group}>
                {file.tables.map((t, i) => (
                  <html.button
                    key={t.key}
                    onClick={() => onChoose(t.key)}
                    aria-current={t.key === active ? true : undefined}
                    style={[styles.row, i > 0 && styles.rowRule]}
                  >
                    <html.span dir="auto" style={[styles.rowTitle, t.key === active && styles.rowTitleOn]}>{t.title}</html.span>
                    <html.span style={styles.rowCount}>{t.key === active ? "✓" : String(t.rowCount)}</html.span>
                  </html.button>
                ))}
                <html.button onClick={() => onNewTable(file.bundle)} style={[styles.row, styles.rowRule]}>
                  <html.span style={styles.rowAction}>+ New table</html.span>
                </html.button>
              </html.div>
            </html.div>
          ))}
          <html.div style={styles.file}>
            <html.div style={styles.group}>
              {actions.map((a, i) => (
                <html.button key={a.label} onClick={a.onPress} style={[styles.row, i > 0 && styles.rowRule]}>
                  <html.span style={styles.rowAction}>{a.label}</html.span>
                </html.button>
              ))}
            </html.div>
          </html.div>
        </ScrollView>
      </html.div>
    </Modal>
  );
}

const text = { default: "#1c1c1e", "@media (prefers-color-scheme: dark)": "#f5f5f7" };
const dim = { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" };

const styles = css.create({
  sheet: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    backgroundColor: { default: "#f2f2f7", "@media (prefers-color-scheme: dark)": "#000000" },
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  heading: { fontSize: 20, fontWeight: "700", color: text },
  done: {
    paddingInline: 8,
    paddingBlock: 8,
    fontSize: 17,
    fontWeight: "600",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" },
  },
  file: { display: "flex", flexDirection: "column", marginTop: 16, paddingInline: 16 },
  fileHeading: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingInline: 16,
    marginBottom: 6,
  },
  fileTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, color: dim },
  fileName: { fontSize: 12, color: dim },
  group: {
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#1c1c1e" },
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingInline: 16,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  rowRule: {
    borderTopWidth: 0.5,
    borderTopStyle: "solid",
    borderTopColor: { default: "#c6c6c8", "@media (prefers-color-scheme: dark)": "#38383a" },
  },
  rowTitle: { fontSize: 17, color: text },
  rowTitleOn: { fontWeight: "600" },
  rowCount: { fontSize: 15, color: dim },
  rowAction: { fontSize: 17, color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" } },
});
