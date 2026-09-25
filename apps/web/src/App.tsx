import { useCallback, useEffect, useState } from "react";
import { html, css } from "react-strict-dom";
import {
  applyView,
  newId,
  newTable,
  parseAddress,
  searchRows,
  validate,
} from "@workspace.sh/table-core";
import type {
  Field,
  ParsedTable,
  Row,
  TableSchema,
  View,
} from "@workspace.sh/table-core";
import {
  BodyEditor,
  BoardView,
  CalendarView,
  GalleryView,
  ListView,
  TableView,
} from "@workspace.sh/table-ui";
import { tables as initialTables } from "./loadFixture";
import { archiveFileName, openArchive, tableToArchive } from "./tableFiles";
import { tableKeyFor } from "./tableKey";
import { browserStore, clearSaved, loadSaved, save } from "./savedTables";
import { Sidebar } from "./Sidebar";
import { useHashAddress } from "./useHashAddress";

const DEFAULT_TABLE_PATH = "projects";
const INITIAL_SCHEMA_VERSIONS: Record<string, number> = Object.fromEntries(
  Object.entries(initialTables).map(([key, t]) => [
    key,
    (t.schema["schema-version"] as number | undefined) ?? 1,
  ]),
);

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
    paddingInline: 24,
    paddingBlock: 20,
    overflow: "auto",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 16,
  },
  headerTopRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
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
  schemaBumpBadge: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 4,
    fontSize: 10,
    fontWeight: "600",
    backgroundColor: {
      default: "#fef3c7",
      "@media (prefers-color-scheme: dark)": "#3f2e0a",
    },
    color: {
      default: "#92400e",
      "@media (prefers-color-scheme: dark)": "#fbbf24",
    },
  },
  headerActions: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  downloadButton: {
    paddingInline: 10,
    paddingBlock: 6,
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
  searchInput: {
    width: 240,
    paddingInline: 10,
    paddingBlock: 6,
    fontSize: 13,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 6,
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
    outlineStyle: "none",
  },
});

/** The first view of each table, as the demo opens it. */
function firstViews(tables: Record<string, ParsedTable>): Record<string, string> {
  return Object.fromEntries(Object.entries(tables).map(([key, t]) => [key, t.views[0]?.id ?? ""]));
}

/** The table to show first: the default one when it exists, otherwise any. */
function firstTablePath(tables: Record<string, ParsedTable>): string {
  return tables[DEFAULT_TABLE_PATH] ? DEFAULT_TABLE_PATH : Object.keys(tables)[0]!;
}

function bumpSchemaVersion(schema: TableSchema): TableSchema {
  const current = (schema["schema-version"] as number | undefined) ?? 1;
  return { ...schema, "schema-version": current + 1 };
}

export function App() {
  // Edits survive a reload (#86): what was saved, or the fixtures when
  // nothing usable was.
  const [tables, setTables] = useState<Record<string, ParsedTable>>(
    () => loadSaved(browserStore()) ?? initialTables,
  );
  const [activeTablePath, setActiveTablePath] = useState<string>(() => firstTablePath(tables));
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>(() =>
    firstViews(tables),
  );

  // Saved after every change. The fixtures themselves are never saved, so
  // an untouched demo keeps following them as they change.
  useEffect(() => {
    if (tables !== initialTables) save(browserStore(), tables);
  }, [tables]);

  const createTable = useCallback(() => {
    const title = window.prompt("Name the new table")?.trim();
    if (!title) return;
    const key = tableKeyFor(title, Object.keys(tables));
    const made = newTable(title, `${key}.table`);
    setTables((all) => ({ ...all, [key]: made }));
    setActiveViewIds((prev) => ({ ...prev, [key]: made.views[0]!.id }));
    setActiveTablePath(key);
    setSearchQuery("");
    setActiveBodyRowId(null);
  }, [tables]);

  // Download: the table as a real `.table.zip` (D27), named by its key.
  const downloadTable = useCallback(async () => {
    const bytes = await tableToArchive(activeTablePath, tables[activeTablePath]!);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = archiveFileName(activeTablePath);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [tables, activeTablePath]);

  // Open: a `.table.zip` becomes one more table here, saying what the
  // reader skipped (D25). Only a file with no table in it is refused.
  const openTableFile = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const opened = await openArchive(new Uint8Array(await file.arrayBuffer()), Object.keys(tables));
        setTables((all) => ({ ...all, [opened.key]: opened.table }));
        setActiveViewIds((prev) => ({ ...prev, [opened.key]: opened.table.views[0]?.id ?? "" }));
        setActiveTablePath(opened.key);
        setSearchQuery("");
        setActiveBodyRowId(null);
        if (opened.skipped.length > 0) {
          const n = opened.skipped.length;
          window.alert(
            `Opened "${opened.table.meta.title ?? opened.key}", but skipped ${n} ${n === 1 ? "thing" : "things"} it couldn't read:\n\n${opened.skipped.join("\n")}`,
          );
        }
      } catch (error) {
        window.alert(`Couldn't open ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    document.body.appendChild(input);
    input.click();
  }, [tables]);

  const resetDemo = useCallback(() => {
    clearSaved(browserStore());
    setTables(initialTables);
    setActiveTablePath(firstTablePath(initialTables));
    setActiveViewIds(firstViews(initialTables));
    setSearchQuery("");
    setActiveBodyRowId(null);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeBodyRowId, setActiveBodyRowId] = useState<string | null>(null);

  const table = tables[activeTablePath];
  if (!table) throw new Error(`Unknown table path: ${activeTablePath}`);
  const activeViewId = activeViewIds[activeTablePath] ?? table.views[0]?.id ?? "";
  const view = table.views.find((v) => v.id === activeViewId) ?? table.views[0];
  if (!view) throw new Error("table has no views");

  const setActiveViewId = useCallback(
    (viewId: string) =>
      setActiveViewIds((prev) => ({ ...prev, [activeTablePath]: viewId })),
    [activeTablePath],
  );

  // Apply an Address to app state — shared between relation clicks
  // and URL-hash rehydration so both paths behave identically.
  const applyAddress = useCallback(
    (addr: { tablePath: string; rowId?: string; viewId?: string }) => {
      // Only switch if we actually have the target table loaded.
      if (!tables[addr.tablePath]) {
        // Visible-broken at the cell level already; nothing more to do.
        return;
      }
      setActiveTablePath(addr.tablePath);
      if (addr.viewId) {
        setActiveViewIds((prev) => ({ ...prev, [addr.tablePath]: addr.viewId! }));
      }
      // If the row has a body and the target table tracks bodies, open
      // the body editor as a quick "row detail" surface. Tables without
      // bodies just switch + scroll-to (deferred).
      if (addr.rowId) {
        const target = tables[addr.tablePath];
        if (target?.bodies?.[addr.rowId]) {
          setActiveBodyRowId(addr.rowId);
        } else {
          setActiveBodyRowId(null);
        }
      } else {
        setActiveBodyRowId(null);
      }
    },
    [tables],
  );

  // Relation click → parse + apply.
  const openRelation = useCallback(
    (address: string) => {
      const addr = parseAddress(address);
      if (!addr) return;
      applyAddress(addr);
    },
    [applyAddress],
  );

  // Two-way URL-hash sync. Writes the current address on every nav
  // change; on browser back/forward (or a typed-in URL) parses the hash
  // and rehydrates state via the same path that handles in-app
  // relation clicks.
  useHashAddress({
    state: {
      tablePath: activeTablePath,
      viewId: activeViewId,
      rowId: activeBodyRowId ?? undefined,
    },
    onExternalChange: applyAddress,
  });

  const updateRow = useCallback(
    (rowId: string, fieldName: string, value: unknown) => {
      setTables((all) => ({
        ...all,
        [activeTablePath]: {
          ...all[activeTablePath]!,
          rows: all[activeTablePath]!.rows.map((row) =>
            row.id === rowId ? { ...row, [fieldName]: value } : row,
          ),
        },
      }));
    },
    [activeTablePath],
  );

  const updateBody = useCallback(
    (rowId: string, content: string) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const bodies = { ...(t.bodies ?? {}) };
        if (content.length === 0) delete bodies[rowId];
        else bodies[rowId] = content;
        return { ...all, [activeTablePath]: { ...t, bodies } };
      });
    },
    [activeTablePath],
  );

  // A new row is just an id (D23); the view it lands in decides where it
  // shows, and a filter may hide it until its cells are filled in.
  const addRow = useCallback(() => {
    setTables((all) => {
      const t = all[activeTablePath]!;
      return { ...all, [activeTablePath]: { ...t, rows: [...t.rows, { id: newId() }] } };
    });
  }, [activeTablePath]);

  const deleteRow = useCallback(
    (rowId: string) => {
      const t = tables[activeTablePath]!;
      const hasBody = t.bodies?.[rowId] !== undefined;
      if (!window.confirm(`Delete "${rowTitleFor(t, rowId)}"?${hasBody ? " Its document goes too." : ""}`)) return;
      setTables((all) => {
        const current = all[activeTablePath]!;
        const bodies = { ...(current.bodies ?? {}) };
        delete bodies[rowId];
        return {
          ...all,
          [activeTablePath]: {
            ...current,
            rows: current.rows.filter((r) => r.id !== rowId),
            ...(current.bodies ? { bodies } : {}),
          },
        };
      });
      setActiveBodyRowId((open) => (open === rowId ? null : open));
    },
    [tables, activeTablePath],
  );

  const openBody = useCallback((rowId: string) => setActiveBodyRowId(rowId), []);
  const closeBody = useCallback(() => setActiveBodyRowId(null), []);

  // Cosmetic field edits (title, description) do NOT bump schema-version.
  // Structural edits (required, deprecated, enum add, add field, reorder) DO.
  const updateField = useCallback(
    (fieldName: string, patch: Partial<Field>) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const fields = t.schema.fields.map((f) =>
          f.name === fieldName ? { ...f, ...patch } : f,
        );
        const isStructural =
          "constraints" in patch ||
          "deprecated" in patch ||
          "relation" in patch ||
          // A new formula changes what the column means for every row.
          "computed" in patch;
        const nextSchema: TableSchema = isStructural
          ? bumpSchemaVersion({ ...t.schema, fields })
          : { ...t.schema, fields };
        return { ...all, [activeTablePath]: { ...t, schema: nextSchema } };
      });
    },
    [activeTablePath],
  );

  const addEnumValue = useCallback(
    (fieldName: string, value: string) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const fields = t.schema.fields.map((f) => {
          if (f.name !== fieldName) return f;
          const existing = f.constraints?.enum ?? [];
          if (existing.includes(value)) return f;
          return {
            ...f,
            constraints: { ...(f.constraints ?? {}), enum: [...existing, value] },
          };
        });
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
          },
        };
      });
    },
    [activeTablePath],
  );

  const moveField = useCallback(
    (fieldName: string, delta: -1 | 1) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        const from = t.schema.fields.findIndex((f) => f.name === fieldName);
        if (from === -1) return all;
        const to = from + delta;
        if (to < 0 || to >= t.schema.fields.length) return all;
        const fields = t.schema.fields.slice();
        const [moved] = fields.splice(from, 1);
        fields.splice(to, 0, moved!);
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
          },
        };
      });
    },
    [activeTablePath],
  );

  const addField = useCallback(
    (field: Field) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        if (t.schema.fields.some((f) => f.name === field.name)) return all;
        const fields = [...t.schema.fields, field];
        // A view that lists its fields shows only those, so a field added
        // from it would otherwise never appear where it was added. It joins
        // the view it was added from; other views are left as they are.
        const views = t.views.map((v) =>
          v.id === activeViewId && Array.isArray(v.fields) && !v.fields.includes(field.name)
            ? { ...v, fields: [...v.fields, field.name] }
            : v,
        );
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            schema: bumpSchemaVersion({ ...t.schema, fields }),
            views,
          },
        };
      });
    },
    [activeTablePath, activeViewId],
  );

  const updateActiveView = useCallback(
    (patch: Partial<View>) => {
      setTables((all) => {
        const t = all[activeTablePath]!;
        return {
          ...all,
          [activeTablePath]: {
            ...t,
            views: t.views.map((v) => (v.id === activeViewId ? { ...v, ...patch } : v)),
          },
        };
      });
    },
    [activeTablePath, activeViewId],
  );

  const viewRows = applyView(table, view);
  const visibleRows = searchRows(viewRows, searchQuery, {
    schema: table.schema,
    bodies: table.bodies,
  });
  const errors = validate(table.schema, table.rows);
  const searching = searchQuery.trim().length > 0;
  const currentSchemaVersion =
    (table.schema["schema-version"] as number | undefined) ?? 1;
  const schemaBumped =
    currentSchemaVersion > (INITIAL_SCHEMA_VERSIONS[activeTablePath] ?? 1);

  return (
    <html.div style={styles.root}>
      <Sidebar
        tables={tables}
        activeTablePath={activeTablePath}
        onSelectTable={(path) => {
          setActiveTablePath(path);
          setSearchQuery("");
          setActiveBodyRowId(null);
        }}
        table={table}
        activeViewId={view.id}
        onSelect={setActiveViewId}
        onReset={resetDemo}
        onNewTable={createTable}
        onOpenFile={openTableFile}
      />
      <html.div style={styles.main}>
        <html.div style={styles.header}>
          <html.div style={styles.headerTopRow}>
            <html.span style={styles.title}>{view.name}</html.span>
            <html.div style={styles.headerActions}>
            <html.button style={styles.downloadButton} onClick={() => void downloadTable()}>
              Download .table.zip
            </html.button>
            <html.input
              type="search"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e: { target: { value: string } }) =>
                setSearchQuery(e.target.value)
              }
              style={styles.searchInput}
            />
            </html.div>
          </html.div>
          <html.div style={styles.subtitle}>
            <html.span>
              {searching
                ? `${visibleRows.length} of ${viewRows.length} matching`
                : `${visibleRows.length} of ${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}`}
            </html.span>
            <html.span>·</html.span>
            <html.span style={errors.length === 0 ? styles.validityOk : styles.validityBad}>
              {errors.length === 0
                ? "schema valid"
                : `${errors.length} validation error${errors.length === 1 ? "" : "s"}`}
            </html.span>
            {schemaBumped && (
              <>
                <html.span>·</html.span>
                {/* D22: schema-version is a "the schema changed" signal, not a format version. */}
                <html.span style={styles.schemaBumpBadge}>
                  schema changed
                </html.span>
              </>
            )}
          </html.div>
        </html.div>
        {renderView(view, visibleRows, table.schema, table.bodies, {
          onUpdateRow: updateRow,
          onUpdateField: updateField,
          onAddEnumValue: addEnumValue,
          onMoveField: moveField,
          onAddField: addField,
          onAddRow: addRow,
          onDeleteRow: deleteRow,
          onOpenBody: openBody,
          onUpdateView: updateActiveView,
          relatedTables: tables,
          onOpenRelation: openRelation,
        })}
      </html.div>
      {activeBodyRowId && (
        <BodyEditor
          rowId={activeBodyRowId}
          rowTitle={rowTitleFor(table, activeBodyRowId)}
          content={table.bodies?.[activeBodyRowId] ?? ""}
          onSave={(content) => updateBody(activeBodyRowId, content)}
          onClose={closeBody}
        />
      )}
    </html.div>
  );
}

function rowTitleFor(table: ParsedTable, rowId: string): string {
  const row = table.rows.find((r) => r.id === rowId);
  if (!row) return rowId;
  // Prefer the first string-typed field; fall back to id.
  for (const field of table.schema.fields) {
    if (field.type === "string") {
      const v = row[field.name];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return rowId;
}

interface ViewCallbacks {
  onUpdateRow: (rowId: string, fieldName: string, value: unknown) => void;
  onUpdateField: (fieldName: string, patch: Partial<Field>) => void;
  onAddEnumValue: (fieldName: string, value: string) => void;
  onMoveField: (fieldName: string, delta: -1 | 1) => void;
  onAddField: (field: Field) => void;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onOpenBody: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
  relatedTables: Record<string, ParsedTable>;
  onOpenRelation: (address: string) => void;
}

function renderView(
  view: View,
  rows: Row[],
  schema: TableSchema,
  bodies: Record<string, string> | undefined,
  cb: ViewCallbacks,
) {
  const common = {
    relatedTables: cb.relatedTables,
    onOpenRelation: cb.onOpenRelation,
  };
  switch (view.layout) {
    case "board":
      return (
        <BoardView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onUpdateRow={cb.onUpdateRow}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
    case "gallery":
      return (
        <GalleryView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          {...common}
        />
      );
    case "list":
      return (
        <ListView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
    case "calendar":
      return (
        <CalendarView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onOpenBody={cb.onOpenBody}
          {...common}
        />
      );
    case "table":
    default:
      return (
        <TableView
          view={view}
          rows={rows}
          schema={schema}
          bodies={bodies}
          onUpdateRow={cb.onUpdateRow}
          onUpdateField={cb.onUpdateField}
          onAddEnumValue={cb.onAddEnumValue}
          onMoveField={cb.onMoveField}
          onAddField={cb.onAddField}
          onAddRow={cb.onAddRow}
          onDeleteRow={cb.onDeleteRow}
          onOpenBody={cb.onOpenBody}
          onUpdateView={cb.onUpdateView}
          {...common}
        />
      );
  }
}
