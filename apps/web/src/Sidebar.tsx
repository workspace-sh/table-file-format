import { type ReactNode, useMemo, useState } from "react";
import { html, css } from "react-strict-dom";
import { bundleFiles, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";
import type { DisplaySettings } from "@workspace.sh/table-ui";
import { DATE_FORMATS, FORMULA_SYNTAXES, LOCALES } from "./displaySettings";
import { bundleOf, tableKeysIn, toBundle } from "./bundles";

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
  /** The heading row: what the sidebar lists, and the Tables / Files switch. */
  headingRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4,
    marginBottom: 4,
  },
  switch: {
    display: "flex",
    flexDirection: "row",
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    overflow: "hidden",
    borderColor: {
      default: "#d1d1d6",
      "@media (prefers-color-scheme: dark)": "#3a3a3f",
    },
  },
  switchButton: {
    borderWidth: 0,
    paddingInline: 8,
    paddingBlock: 2,
    fontSize: 11,
    cursor: "pointer",
    backgroundColor: "transparent",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  switchOn: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
    color: {
      default: "#1c1c1e",
      "@media (prefers-color-scheme: dark)": "#f5f5f7",
    },
  },
  /** An on-disk name beside a title: a folder, or a view's id. */
  diskName: {
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    marginLeft: 6,
    minWidth: 0,

    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  /** A row of the files tree: a file or folder name, as on disk. */
  fileEntry: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
    paddingBlock: 3,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  fileNote: {
    marginLeft: "auto",
    paddingLeft: 8,
    flexShrink: 0,
    fontSize: 11,
    fontFamily: "system-ui, sans-serif",
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  /** A title keeps its room; the on-disk name after it gives way first. */
  titleText: {
    flexShrink: 0,
    maxWidth: "80%",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  /** A files-tree row's depth. */
  indent: (px: number) => ({ paddingLeft: px }),
  fileName: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
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
  itemNameOpen: {
    fontWeight: "600",
  },
  /** A table, under its file: one step in, so the tree reads file › table › view. */
  tableItem: {
    paddingLeft: 26,
  },
  /** A view, under its table: one more step in. */
  viewItem: {
    paddingLeft: 58,
  },
  itemKey: {
    fontSize: 11,
    fontWeight: "400",
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  itemCount: {
    fontSize: 11,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  bundleHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    borderRadius: 6,
    paddingInline: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  /** A file: a row like the tables under it, not a section label. */
  fileRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    cursor: "pointer",
    borderRadius: 6,
    paddingInline: 8,
    paddingBlock: 6,
    marginTop: 4,
  },
  fileTitle: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: "600",
  },
  /** Files first, then this viewer's settings, with a rule between. */
  divider: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: {
      default: "#e5e5ea",
      "@media (prefers-color-scheme: dark)": "#26262b",
    },
  },
  /** The file name: one line, cut short rather than wrapped. */
  bundleFile: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  /** A group's fold toggle, as in shadcn/ui's sidebar: › turns down when open. */
  groupChevron: {
    display: "inline-block",
    width: 12,
    fontSize: 13,
    lineHeight: "13px",
    textAlign: "center",
    transitionProperty: "transform",
    transitionDuration: "150ms",
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  groupChevronOpen: {
    transform: "rotate(90deg)",
  },
  tableChevron: {
    marginRight: 6,
  },
  bundleTitle: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  /** "+ New table", level with the tables' names, past their arrows. */
  tableAction: {
    paddingLeft: 44,
  },
  firstAction: {
    marginTop: 6,
  },
  itemActive: {
    backgroundColor: {
      default: "#e8e8ed",
      "@media (prefers-color-scheme: dark)": "#1f1f23",
    },
  },
  newTable: {
    borderWidth: 0,
    backgroundColor: "transparent",
    fontSize: 13,
    textAlign: "left",
    color: {
      default: "#6e6e73",
      "@media (prefers-color-scheme: dark)": "#8a8a93",
    },
  },
  displayNote: {
    paddingInline: 8,
  },
  displayLabel: {
    marginTop: 8,
  },
  displayRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 8,
    paddingBlock: 3,
  },
  displayName: {
    fontSize: 13,
  },
  select: {
    fontSize: 12,
    paddingInline: 6,
    paddingBlock: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    maxWidth: 140,
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
  },
  itemName: {
    flex: 1,
    fontSize: 13,
  },
  /** A title with its on-disk name after it, cut short rather than wrapped. */
  titleAndName: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    minWidth: 0,
    marginRight: 6,
  },
  headingLabel: {
    marginBottom: 0,
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
  footer: {
    display: "flex",
    flexDirection: "column",
    // Under the views rather than pinned to the bottom: the sidebar is as
    // tall as the page, so the bottom is off screen on any long table.
    marginTop: 20,
    paddingInline: 8,
  },
  resetButton: {
    alignSelf: "flex-start",
    paddingInline: 10,
    paddingBlock: 5,
    fontSize: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
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
  },
  resetNote: {
    fontSize: 11,
    marginTop: 6,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
});

const DATE_LABELS: Record<string, string> = {
  iso: "ISO (2026-04-20)",
  short: "Short",
  long: "Long",
  weekday: "With weekday",
  relative: "Relative",
};

const FORMULA_LABELS: Record<string, string> = {
  excel: "Excel style (=a + b)",
  stored: "Stored form ((+ a b))",
};

interface SidebarProps {
  tables: Record<string, ParsedTable>;
  activeTablePath: string;
  onSelectTable: (path: string) => void;
  table: ParsedTable;
  activeViewId: string;
  onSelect: (viewId: string) => void;
  /** Forget every edit and start again from the fixtures. */
  onReset: () => void;
  /** Each .table file's manifest (D37): its title and table order. */
  bundles: Record<string, BundleMeta>;
  /** `.table` files whose tables are folded away. */
  foldedFiles: string[];
  onToggleFile: (bundle: string) => void;
  /** The Display settings group, folded away. */
  foldedDisplay: boolean;
  onToggleDisplay: () => void;
  /** Make a new, empty table in this .table file and switch to it. */
  onNewTable: (bundle: string) => void;
  /** Make a new .table file holding one table, and switch to it. */
  onNewFile: () => void;
  /** Add a view to this table and open its settings. */
  onNewView: () => void;
  /** Open a `.table.zip` as one more table. */
  onOpenFile: () => void;
  /** This viewer's locale and default date format. */
  display: DisplaySettings;
  onDisplayChange: (next: DisplaySettings) => void;
  /** Showing the files on disk rather than the tables and views. */
  filesMode: boolean;
  onFilesMode: (files: boolean) => void;
  /** A table's attachment file names, by its `bundle/table` key. */
  attachmentsOf: (tableKey: string) => string[];
  /** The file shown in place of a view, if any. */
  shownFile: ShownFile | null;
  onShowFile: (file: ShownFile) => void;
}

/** A file of a `.table`, by its bundle and its path inside `<bundle>.table/`. */
export interface ShownFile {
  bundle: string;
  path: string;
}

export function Sidebar({
  tables,
  activeTablePath,
  onSelectTable,
  table,
  activeViewId,
  onSelect,
  onReset,
  bundles,
  foldedFiles,
  onToggleFile,
  foldedDisplay,
  onToggleDisplay,
  onNewTable,
  onNewFile,
  onNewView,
  onOpenFile,
  display,
  onDisplayChange,
  filesMode,
  onFilesMode,
  attachmentsOf,
  shownFile,
  onShowFile,
}: SidebarProps) {
  const browserLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
  return (
    <html.div style={styles.root}>
      <html.div style={styles.headingRow}>
        <html.span style={[styles.sectionLabel, styles.headingLabel]}>.table files</html.span>
        {/* The same files two ways: as tables and views, or as they are on disk. */}
        <html.div role="group" aria-label="Show tables or files" style={styles.switch}>
          <html.button
            aria-pressed={!filesMode}
            style={[styles.switchButton, !filesMode && styles.switchOn]}
            onClick={() => onFilesMode(false)}
          >
            Tables
          </html.button>
          <html.button
            aria-pressed={filesMode}
            style={[styles.switchButton, filesMode && styles.switchOn]}
            onClick={() => onFilesMode(true)}
          >
            Files
          </html.button>
        </html.div>
      </html.div>
      {filesMode ? (
        <FilesTree
          tables={tables}
          bundles={bundles}
          foldedFiles={foldedFiles}
          onToggleFile={onToggleFile}
          activeTablePath={activeTablePath}
          attachmentsOf={attachmentsOf}
          shownFile={shownFile}
          onShowFile={onShowFile}
        />
      ) : (
      // One tree: each .table file, its tables, and under the open table
      // its views, so a view is always seen as part of its table and a
      // table as part of its file (D37). Only what's on screen is
      // highlighted; its table is bold.
      <html.div style={styles.list}>
        {Object.keys(bundles).map((bundle) => {
          const keys = tableKeysIn(tables, bundles, bundle);
          const folded = foldedFiles.includes(bundle);
          return (
            <html.div key={bundle} style={styles.list}>
              {/* A file folds its tables away, as a shadcn/ui group does. */}
              <html.div
                role="button"
                aria-expanded={!folded}
                onClick={() => onToggleFile(bundle)}
                style={styles.fileRow}
              >
                <html.span style={[styles.groupChevron, !folded && styles.groupChevronOpen]}>›</html.span>
                <html.span style={styles.fileTitle}>{bundles[bundle]?.title ?? bundle}</html.span>
                <html.span style={[styles.itemKey, styles.bundleFile]}>{bundle}.table</html.span>
              </html.div>
              {!folded && keys.map((path) => {
                const t = tables[path]!;
                const open = path === activeTablePath;
                const title = t.meta.title ?? path;
                return (
                  <html.div key={path} style={styles.list}>
                    <html.div
                      role="button"
                      aria-expanded={open}
                      style={[styles.item, styles.tableItem]}
                      onClick={() => onSelectTable(path)}
                    >
                      <html.span style={[styles.groupChevron, styles.tableChevron, open && styles.groupChevronOpen]}>›</html.span>
                      <html.span style={[styles.itemName, styles.titleAndName, open && styles.itemNameOpen]}>
                        <html.span style={styles.titleText}>{title}</html.span>
                        {/* Its folder under tables/, as the address bar names it. */}
                        <html.span style={styles.diskName}>{path.slice(bundle.length + 1)}/</html.span>
                      </html.span>
                      <html.span style={styles.itemCount}>{t.rows.length}</html.span>
                    </html.div>
                    {open && (
                      <html.div style={styles.list}>
                        {table.views.map((view) => (
                          <html.div
                            key={view.id}
                            role="button"
                            aria-current={view.id === activeViewId ? "page" : undefined}
                            style={[styles.item, styles.viewItem, view.id === activeViewId && styles.itemActive]}
                            onClick={() => onSelect(view.id)}
                          >
                            <html.span style={[styles.itemName, styles.titleAndName]}>
                              <html.span style={styles.titleText}>{view.name}</html.span>
                              {/* Its id in views.json, as the address bar names it. */}
                              <html.span style={styles.diskName}>{view.id}</html.span>
                            </html.span>
                            <html.span style={styles.itemLayout}>{view.layout}</html.span>
                          </html.div>
                        ))}
                        <html.button style={[styles.item, styles.viewItem, styles.newTable]} onClick={onNewView}>
                          + New view
                        </html.button>
                      </html.div>
                    )}
                  </html.div>
                );
              })}
              {bundle === bundleOf(activeTablePath) && !folded && (
                <html.button style={[styles.item, styles.newTable, styles.tableAction]} onClick={() => onNewTable(bundle)}>
                  + New table
                </html.button>
              )}
            </html.div>
          );
        })}
        <html.button style={[styles.item, styles.newTable, styles.firstAction]} onClick={onNewFile}>
          + New .table file
        </html.button>
        <html.button style={[styles.item, styles.newTable]} onClick={onOpenFile}>
          Open .table.zip…
        </html.button>
      </html.div>
      )}
      <html.div style={styles.divider} />
      <html.div
        role="button"
        aria-expanded={!foldedDisplay}
        onClick={onToggleDisplay}
        style={[styles.bundleHeader, styles.displayLabel]}
      >
        <html.span style={[styles.groupChevron, !foldedDisplay && styles.groupChevronOpen]}>›</html.span>
        <html.span style={styles.bundleTitle}>Display</html.span>
      </html.div>
      {!foldedDisplay && (
        <>
      <html.div style={styles.displayRow}>
        <html.span style={styles.displayName}>Language</html.span>
        <html.select
          aria-label="Language and region for dates and numbers"
          value={display.locale ?? ""}
          onChange={(e: { target: { value: string } }) =>
            onDisplayChange({ ...display, locale: e.target.value || undefined })
          }
          style={styles.select}
        >
          <html.option value="">Browser ({browserLocale})</html.option>
          {LOCALES.map((l) => (
            <html.option key={l} value={l}>
              {l}
            </html.option>
          ))}
        </html.select>
      </html.div>
      <html.div style={styles.displayRow}>
        <html.span style={styles.displayName}>Dates</html.span>
        <html.select
          aria-label="How dates are shown where a table doesn't say"
          value={display.dateFormat ?? "iso"}
          onChange={(e: { target: { value: string } }) =>
            onDisplayChange({ ...display, dateFormat: e.target.value === "iso" ? undefined : e.target.value })
          }
          style={styles.select}
        >
          {DATE_FORMATS.map((f) => (
            <html.option key={f} value={f}>
              {DATE_LABELS[f]}
            </html.option>
          ))}
        </html.select>
      </html.div>
      <html.span style={[styles.resetNote, styles.displayNote]}>Where a column hasn't chosen its own date format.</html.span>
      <html.div style={styles.displayRow}>
        <html.span style={styles.displayName}>Formulas</html.span>
        <html.select
          aria-label="Which syntax formulas are shown in"
          value={display.formulaSyntax ?? "excel"}
          onChange={(e: { target: { value: string } }) =>
            onDisplayChange({ ...display, formulaSyntax: e.target.value === "stored" ? "stored" : undefined })
          }
          style={styles.select}
        >
          {FORMULA_SYNTAXES.map((s) => (
            <html.option key={s} value={s}>
              {FORMULA_LABELS[s]}
            </html.option>
          ))}
        </html.select>
      </html.div>
      <html.span style={[styles.resetNote, styles.displayNote]}>Either can be typed. The file keeps one form.</html.span>
        </>
      )}
      <html.div style={styles.footer}>
        <html.button
          style={styles.resetButton}
          onClick={() => {
            if (window.confirm("Reset the demo data? Every edit you made here is lost.")) onReset();
          }}
        >
          Reset demo data
        </html.button>
        <html.span style={styles.resetNote}>Edits are kept in this browser.</html.span>
      </html.div>
    </html.div>
  );
}

interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: { name: string; path: string }[];
}

function treeOf(paths: string[]): Dir {
  const root: Dir = { name: "", path: "", dirs: [], files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const at = parts.slice(0, i + 1).join("/");
      let next = dir.dirs.find((d) => d.path === at);
      if (!next) {
        next = { name: parts[i]!, path: at, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push({ name: parts[parts.length - 1]!, path });
  }
  return root;
}

/** What each file holds, in a word: `6 rows`, `9 fields`, `4 views`. */
function noteFor(path: string, table: ParsedTable | undefined): string | undefined {
  if (!table) return undefined;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (path.endsWith("/rows.ndjson")) return plural(table.rows.length, "row");
  if (path.endsWith("/schema.json")) return plural(table.schema.fields.length, "field");
  if (path.endsWith("/views.json")) return plural(table.views.length, "view");
  return undefined;
}

/**
 * Each .table as it is on disk: the folders and files the writer writes
 * (bundleFiles), plus attachments. Folders fold; a file opens in place
 * of the view.
 */
function FilesTree({
  tables,
  bundles,
  foldedFiles,
  onToggleFile,
  activeTablePath,
  attachmentsOf,
  shownFile,
  onShowFile,
}: {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  foldedFiles: string[];
  onToggleFile: (bundle: string) => void;
  activeTablePath: string;
  attachmentsOf: (tableKey: string) => string[];
  shownFile: ShownFile | null;
  onShowFile: (file: ShownFile) => void;
}) {
  const trees = useMemo(
    () =>
      Object.keys(bundles).map((bundle) => {
        const files = bundleFiles(toBundle(tables, bundles, bundle)).map((f) => f.path);
        for (const key of tableKeysIn(tables, bundles, bundle)) {
          const name = key.slice(bundle.length + 1);
          for (const file of attachmentsOf(key)) files.push(`tables/${name}/attachments/${file}`);
        }
        return { bundle, tree: treeOf(files) };
      }),
    [tables, bundles, attachmentsOf],
  );
  // Folders other than the open table's start folded, and bodies/ and
  // attachments/ always do: the tree opens on what you're looking at.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (bundle: string, dir: Dir) => {
    const key = `${bundle}/${dir.path}`;
    if (key in open) return open[key]!;
    if (dir.name === "bodies" || dir.name === "attachments") return false;
    if (dir.path.startsWith("tables/") && dir.path.split("/").length === 2) {
      return `${bundle}/${dir.name}` === activeTablePath;
    }
    return true;
  };
  const indent = (depth: number, file = false) => styles.indent(8 + depth * 14 + (file ? 18 : 0));

  const renderDir = (bundle: string, dir: Dir, depth: number): ReactNode => {
    const unfolded = isOpen(bundle, dir);
    const tableKey = dir.path.startsWith("tables/") ? `${bundle}/${dir.path.split("/")[1]}` : undefined;
    return (
      <html.div key={dir.path} style={styles.list}>
        <html.div
          role="button"
          aria-expanded={unfolded}
          style={[styles.fileEntry, indent(depth)]}
          onClick={() => setOpen((o) => ({ ...o, [`${bundle}/${dir.path}`]: !unfolded }))}
        >
          <html.span style={[styles.groupChevron, styles.tableChevron, unfolded && styles.groupChevronOpen]}>›</html.span>
          <html.span style={styles.fileName}>{dir.name}/</html.span>
          {dir.name === "bodies" || dir.name === "attachments" ? (
            <html.span style={styles.fileNote}>{dir.files.length}</html.span>
          ) : null}
        </html.div>
        {unfolded && renderEntries(bundle, dir, depth + 1, tableKey)}
      </html.div>
    );
  };

  const renderEntries = (bundle: string, dir: Dir, depth: number, tableKey?: string): ReactNode => (
    <>
      {dir.files.map((f) => {
        const shown = shownFile?.bundle === bundle && shownFile.path === f.path;
        const note = noteFor(f.path, tableKey ? tables[tableKey] : undefined);
        return (
          <html.div
            key={f.path}
            role="button"
            aria-current={shown ? "page" : undefined}
            style={[styles.fileEntry, indent(depth, true), shown && styles.itemActive]}
            onClick={() => onShowFile({ bundle, path: f.path })}
          >
            <html.span style={styles.fileName}>{f.name}</html.span>
            {note ? <html.span style={styles.fileNote}>{note}</html.span> : null}
          </html.div>
        );
      })}
      {dir.dirs.map((d) => renderDir(bundle, d, depth))}
    </>
  );

  return (
    <html.div style={styles.list}>
      {trees.map(({ bundle, tree }) => {
        const folded = foldedFiles.includes(bundle);
        return (
          <html.div key={bundle} style={styles.list}>
            <html.div
              role="button"
              aria-expanded={!folded}
              onClick={() => onToggleFile(bundle)}
              style={[styles.fileEntry, styles.fileTitle, indent(0)]}
            >
              <html.span style={[styles.groupChevron, styles.tableChevron, !folded && styles.groupChevronOpen]}>›</html.span>
              <html.span style={styles.fileName}>{bundle}.table/</html.span>
            </html.div>
            {!folded && renderEntries(bundle, tree, 1, undefined)}
          </html.div>
        );
      })}
    </html.div>
  );
}
