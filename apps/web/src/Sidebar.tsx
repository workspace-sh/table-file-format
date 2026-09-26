import { html, css } from "react-strict-dom";
import type { ParsedTable } from "@workspace.sh/table-core";
import type { DisplaySettings } from "@workspace.sh/table-ui";
import { DATE_FORMATS, FORMULA_SYNTAXES, LOCALES } from "./displaySettings";

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
  disclosure: {
    width: 16,
    fontSize: 13,
    color: {
      default: "#8e8e93",
      "@media (prefers-color-scheme: dark)": "#6e6e73",
    },
  },
  /** A view, under its table: indented past the table's disclosure arrow. */
  viewItem: {
    paddingLeft: 30,
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
    marginTop: 20,
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
  /** Make a new, empty table and switch to it. */
  onNewTable: () => void;
  /** Add a view to this table and open its settings. */
  onNewView: () => void;
  /** Open a `.table.zip` as one more table. */
  onOpenFile: () => void;
  /** This viewer's locale and default date format. */
  display: DisplaySettings;
  onDisplayChange: (next: DisplaySettings) => void;
}

export function Sidebar({
  tables,
  activeTablePath,
  onSelectTable,
  table,
  activeViewId,
  onSelect,
  onReset,
  onNewTable,
  onNewView,
  onOpenFile,
  display,
  onDisplayChange,
}: SidebarProps) {
  const browserLocale = new Intl.DateTimeFormat().resolvedOptions().locale;
  const tablePaths = Object.keys(tables);
  return (
    <html.div style={styles.root}>
      {/* One tree: each table, and under the open one its views, so a view
          is always seen as part of its table. Only what's on screen is
          highlighted; its table is bold. */}
      <html.span style={styles.sectionLabel}>Tables</html.span>
      <html.div style={styles.list}>
        {tablePaths.map((path) => {
          const t = tables[path]!;
          const open = path === activeTablePath;
          const title = t.meta.title ?? path;
          // Two tables can share a title (open a file twice): then the key,
          // which never repeats, tells them apart.
          const shared = tablePaths.some((p) => p !== path && (tables[p]!.meta.title ?? p) === title);
          return (
            <html.div key={path} style={styles.list}>
              <html.div
                role="button"
                aria-expanded={open}
                style={styles.item}
                onClick={() => onSelectTable(path)}
              >
                <html.span style={styles.disclosure}>{open ? "▾" : "▸"}</html.span>
                <html.span style={[styles.itemName, open && styles.itemNameOpen]}>
                  {title}
                  {shared && <html.span style={styles.itemKey}> {path}</html.span>}
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
                      <html.span style={styles.itemName}>{view.name}</html.span>
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
        <html.button style={[styles.item, styles.newTable, styles.firstAction]} onClick={onNewTable}>
          + New table
        </html.button>
        <html.button style={[styles.item, styles.newTable]} onClick={onOpenFile}>
          Open .table.zip…
        </html.button>
      </html.div>
      <html.span style={[styles.sectionLabel, styles.displayLabel]}>Display</html.span>
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
