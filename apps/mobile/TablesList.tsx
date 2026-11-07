// The tables, file by file: the shared list (React Native), for the
// platforms without one of their own (iOS and Android have theirs).

import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import { groupsOf, type TablesListProps } from "./tablesList.types";

export function TablesList({ tree, active, onChoose, onNewTable, onClose, unavailable }: TablesListProps) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles_sheet} contentContainerStyle={{ paddingBottom: 32 }}>
      {tree.map((file) => (
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
            <html.button
              onClick={() => onNewTable(file.bundle)}
              style={[styles.row, styles.rowRule]}
            >
              <html.span style={styles.rowAction}>+ New Table</html.span>
            </html.button>
            {file.closable ? (
              <html.button onClick={() => onClose(file.bundle)} style={[styles.row, styles.rowRule]}>
                <html.span style={styles.rowDestructive}>Close File</html.span>
              </html.button>
            ) : null}
          </html.div>
        </html.div>
      ))}
      {groupsOf(unavailable).map(([group, docs]) => (
        // Opened last time, and not to be opened again (or edits kept apart): each with why, where the file would be.
        <html.div key={group} style={styles.file}>
          <html.div style={styles.fileHeading}>
            <html.span style={styles.fileTitle}>{group}</html.span>
          </html.div>
          <html.div style={styles.group}>
            {docs.map((doc, i) => (
              <html.div key={`${doc.name}-${i}`} style={[styles.row, styles.unavailable, i > 0 && styles.rowRule]}>
                <html.span dir="auto" style={styles.rowTitle}>{doc.name}</html.span>
                <html.span dir="auto" style={styles.rowNote}>{doc.message}</html.span>
                {doc.action ? (
                  <html.button onClick={() => void doc.action!.onPress()} style={styles.noteAction}>
                    <html.span style={styles.rowAction}>{doc.action.label}</html.span>
                  </html.button>
                ) : null}
              </html.div>
            ))}
          </html.div>
        </html.div>
      ))}
    </ScrollView>
  );
}

const styles_sheet = { flex: 1 };

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
  unavailable: { flexDirection: "column", alignItems: "flex-start", justifyContent: "center", paddingBlock: 8, gap: 2 },
  rowNote: { fontSize: 13, color: dim },
  noteAction: { borderWidth: 0, backgroundColor: "transparent", paddingBlock: 6, paddingInline: 0 },
  rowAction: { fontSize: 17, color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" } },
  rowDestructive: { fontSize: 17, color: { default: "#ff3b30", "@media (prefers-color-scheme: dark)": "#ff453a" } },
});
