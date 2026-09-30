// The macOS app's sidebar: table-app's sidebarTree drawn as a Mac source
// list. Each .table file folds; its tables list their row counts; the open
// table lists its views (D37). Files mode shows the same .table files as
// they are on disk instead (table-app's filesTree). The file actions sit at
// the foot, outside the tree.

import { ScrollView } from "react-native";
import { html, css } from "react-strict-dom";
import type { FilesTreeEntry, SidebarBundle } from "@workspace.sh/table-app";

export interface SidebarProps {
  tree: SidebarBundle[];
  onToggleFile: (bundle: string) => void;
  onSelectTable: (key: string) => void;
  onSelectView: (key: string, viewId: string) => void;
  onNewTable: () => void;
  onNewView: () => void;
  /** The actions at the foot: new file, open folder, open zip, display. */
  footer: { label: string; onPress: () => void; active?: boolean }[];
  /** A line under them: where edits are kept. */
  footerNote?: string;
  /** Showing the files on disk rather than the tables and views. */
  filesMode: boolean;
  onFilesMode: (files: boolean) => void;
  /** Files mode's lines, as flattenFilesTree gives them. */
  files: FilesTreeEntry[];
  onToggleDir: (bundle: string, path: string, open: boolean) => void;
  /** The file shown in place of the view, if any. */
  shownFile: { bundle: string; path: string } | null;
  onShowFile: (bundle: string, path: string) => void;
}

export function Sidebar({
  tree,
  onToggleFile,
  onSelectTable,
  onSelectView,
  onNewTable,
  onNewView,
  footer,
  filesMode,
  onFilesMode,
  files,
  onToggleDir,
  shownFile,
  onShowFile,
  footerNote,
}: SidebarProps) {
  // A folded chevron points the way the text reads (D40) with no help: › is a
  // bidi-mirrored character, drawn as ‹ in right-to-left text.
  const closed = "›";
  return (
    <html.div style={styles.sidebar}>
      {/* The same files two ways: as tables and views, or as they are on disk. */}
      <html.div role="group" aria-label="Show tables or files" style={styles.switch}>
        {[false, true].map((files) => (
          <html.button
            key={String(files)}
            aria-pressed={filesMode === files}
            onClick={() => onFilesMode(files)}
            style={[styles.switchButton, filesMode === files && styles.switchOn]}
          >
            {files ? "Files" : "Tables"}
          </html.button>
        ))}
      </html.div>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBlock: 12 }}>
        {filesMode
          ? files.map((line) => {
              if (line.kind === "bundle") {
                const b = line.bundle;
                return (
                  <html.button key={b.bundle} aria-expanded={!b.folded} onClick={() => onToggleFile(b.bundle)} style={styles.fileRow}>
                    <html.span style={styles.chevron}>{b.folded ? closed : "⌄"}</html.span>
                    <html.span dir="ltr" style={styles.pathName}>{b.name}</html.span>
                  </html.button>
                );
              }
              const indent = styles.indent(10 + line.depth * 14);
              if (line.kind === "dir") {
                const d = line.dir;
                return (
                  <html.button
                    key={`${line.bundle}/${d.path}/`}
                    aria-expanded={d.open}
                    onClick={() => onToggleDir(line.bundle, d.path, !d.open)}
                    style={[styles.row, styles.fileEntry, indent]}
                  >
                    <html.div style={styles.entryName}>
                      <html.span style={styles.chevron}>{d.open ? "⌄" : closed}</html.span>
                      <html.span dir="ltr" style={styles.pathName}>{`${d.name}/`}</html.span>
                    </html.div>
                    {d.count !== undefined && <html.span style={styles.count}>{String(d.count)}</html.span>}
                  </html.button>
                );
              }
              const f = line.file;
              const shown = shownFile?.bundle === line.bundle && shownFile.path === f.path;
              return (
                <html.button
                  key={`${line.bundle}/${f.path}`}
                  aria-current={shown ? "page" : undefined}
                  onClick={() => onShowFile(line.bundle, f.path)}
                  style={[styles.row, styles.fileEntry, styles.indent(10 + line.depth * 14 + 18), shown && styles.rowActive]}
                >
                  <html.span dir="ltr" style={styles.pathName}>{f.name}</html.span>
                  {f.note && <html.span style={styles.count}>{f.note}</html.span>}
                </html.button>
              );
            })
          : tree.map((file) => (
          <html.div key={file.bundle} style={styles.group}>
            <html.button aria-expanded={!file.folded} onClick={() => onToggleFile(file.bundle)} style={styles.fileRow}>
              <html.span style={styles.chevron}>{file.folded ? closed : "⌄"}</html.span>
              <html.span dir="auto" style={styles.fileTitle}>{file.title}</html.span>
              <html.span style={styles.fileName}>{file.file}</html.span>
            </html.button>
            {file.tables.map((table) => (
              <html.div key={table.key} style={styles.group}>
                <html.button
                  aria-expanded={table.expanded}
                  onClick={() => onSelectTable(table.key)}
                  style={[styles.row, styles.tableRow, table.expanded && styles.rowOpen]}
                >
                  <html.span dir="auto" style={[styles.name, table.expanded && styles.nameOpen]}>{table.title}</html.span>
                  <html.span style={styles.count}>{String(table.rowCount)}</html.span>
                </html.button>
                {table.views.map((view) => (
                  <html.button
                    key={view.id}
                    aria-current={view.active ? "page" : undefined}
                    onClick={() => onSelectView(table.key, view.id)}
                    style={[styles.row, styles.viewRow, view.active && styles.rowActive]}
                  >
                    <html.span dir="auto" style={styles.name}>{view.name}</html.span>
                    <html.span style={styles.count}>{view.layoutLabel}</html.span>
                  </html.button>
                ))}
                {table.expanded && (
                  <html.button dir="auto" onClick={onNewView} style={[styles.row, styles.viewRow, styles.action]}>
                    + New view
                  </html.button>
                )}
              </html.div>
            ))}
            {file.offersNewTable && (
              <html.button dir="auto" onClick={onNewTable} style={[styles.row, styles.tableRow, styles.action]}>
                + New table
              </html.button>
            )}
          </html.div>
        ))}
      </ScrollView>
      <html.div style={styles.footer}>
        {footer.map((a) => (
          <html.button key={a.label} dir="auto" onClick={a.onPress} style={[styles.row, styles.footerRow, a.active && styles.rowActive]}>
            {a.label}
          </html.button>
        ))}
        {footerNote ? <html.span dir="auto" style={styles.footerNote}>{footerNote}</html.span> : null}
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
  footerNote: { marginInline: 18, marginTop: 2, fontSize: 11, color: dim },
  switch: {
    display: "flex",
    flexDirection: "row",
    marginInline: 12,
    marginTop: 12,
    padding: 2,
    borderRadius: 7,
    backgroundColor: { default: "#e5e5ea", "@media (prefers-color-scheme: dark)": "#2a2a2e" },
  },
  switchButton: {
    flex: 1,
    paddingBlock: 3,
    borderRadius: 5,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "center",
    color: text,
  },
  switchOn: { backgroundColor: { default: "#ffffff", "@media (prefers-color-scheme: dark)": "#4a4a50" } },
  fileEntry: { paddingInlineEnd: 10 },
  indent: (start: number) => ({ paddingInlineStart: start }),
  entryName: { display: "flex", flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  pathName: { flexShrink: 1, fontSize: 12, fontFamily: "Menlo", color: text },
});
