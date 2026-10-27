// A .table opened as a document of its own, over table-ui's views (iOS,
// Android, macOS): table-gtk's TableFile is the same for GTK. The same state
// as an app of its own (useEmbeddedTable), so edits are written to the
// folder, go to its history, and can be undone. The view fills the page it
// is in: the host's scroll view, given through PageScrollContext as the
// .table app's own screens give theirs, with no frame of its own.
//
// What goes around the view is the host's to draw in its platform's way (a
// phone's header menus and glass bar, a Mac's toolbar): it is handed a
// TableFileChrome, with the file's tables and views, the search, New View,
// View Settings and undo. A single-file .table has nowhere to be written, and is to
// look at.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import { css, html } from "react-strict-dom";
import { addressedView, newViewId, parseAddress, type ParsedTable, type Row, type View } from "@workspace.sh/table-core";
import { BodyEditor, DisplaySettingsProvider, ViewSettings } from "@workspace.sh/table-ui";
import { LAYOUT_LABELS } from "@workspace.sh/table-ui/shared";

import { bundleOf, bundleTables, tableNameOf } from "./bundles.ts";
import type { Confirm } from "./confirm.ts";
import { linkedRowAddress, type EmbeddedTableFiles, type EmbedRead, type EmbedShown } from "./embed.ts";
import { rowTitleFor, sheetReaders } from "./edits.ts";
import { LayoutView } from "./layoutView.tsx";
import { useEmbeddedTable } from "./react.ts";
import type { IndexDatabase } from "./indexHost.ts";
import { useIndexedTables } from "./useIndexedTables.ts";
import { readingText } from "./reading.ts";
import { askName } from "./askName";

/** What the host draws around the view: the file's tables and views, and what can be done to them. */
export interface TableFileChrome {
  /** The file's tables, by key, with their titles. */
  tables: { key: string; title: string }[];
  /** The table on screen. */
  table: string;
  showTable: (key: string) => void;
  /** The table's views, with their names and layouts ("Board"). */
  views: { id: string; name: string; layout: string }[];
  /** The view on screen. */
  view: string;
  showView: (id: string) => void;
  /** The rows shown, as a count says it ("8 of 8 rows"). */
  count: string;
  /** While a large table is read into its index: how far along, as said ("Reading 120,000 of 1,000,000 rows"). */
  reading?: string;
  /** While searching, what was found, for the search field ("2 rows"). */
  found?: string;
  query: string;
  search: (text: string) => void;
  /** To look at only: nothing can be changed (a single-file .table, or a reader who can't write). */
  lookOnly: boolean;
  /** Opened from a single-file .table: its changes can't be saved. */
  fromArchive: boolean;
  addView: () => void;
  openSettings: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What undo would take back ("Delete Row"), and redo make again. */
  undoName: string | null;
  redoName: string | null;
  undo: () => void;
  redo: () => void;
  /** Where the table lives, as the .table app's window says it under its title ("Shop (shop.table) › Orders"). */
  breadcrumb: string;
  /** Whether its rows meet its schema, said ("schema valid"), and what that means. */
  valid: boolean;
  validity: string;
  validityHint: string;
  /** Back and Forward through the places gone to in the file (its tables, views and rows). */
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  /** A new row; a new field, in a table layout only (from its header). Neither when it's to look at only. */
  canAddRow: boolean;
  canAddField: boolean;
  newRow: () => void;
  newField: () => void;
}

export interface TableFileViewProps {
  /** The file, read over the host's files (readTableFileWith, readTableArchiveFile); null while it's read. */
  read: EmbedRead | null;
  /** How the host writes the file back (embedFilesWith over its files). */
  files: EmbeddedTableFiles;
  readOnly?: boolean;
  locale?: string;
  /**
   * Where to go in the file: an address as the file's (`…/projects.table#table=tasks&view=v2&row=t3`). Its
   * table and view are shown, its row selected, its page opened when it has one. Each new `n` goes there again.
   */
  at?: { address: string; n: number };
  /** A linked row in another `.table` was chosen: its address as that file's, for the host to open. */
  onOpenLink?: (address: string) => void;
  /** Ask a question in the host's way; the platform's alert by default. */
  ask?: (confirm: Confirm, answer: (response: string) => void) => void;
  /** What goes around the view, drawn by the host. */
  chrome?: (file: TableFileChrome) => ReactNode;
  /**
   * A file holding a large table, read through the index (readLargeTableFile): the host's index, and
   * the first rows reading the file gave. Its rows are read from the index, never all into memory.
   */
  index?: TableFileIndex;
  /**
   * Which syntax this file's formulas are shown in, as the host's viewer chose for it (Excel style by
   * default). The viewer's, kept by the host, never in the file (SPEC section 4).
   */
  formulaSyntax?: "excel" | "stored";
}

/** How a large table in the file is read: through the platform's index host (createIndexHost). */
export interface TableFileIndex {
  /** A bundle's index on this device: the index host's openIndexDatabase. */
  openIndexDatabase: (bundle: string) => IndexDatabase;
  /** Its large tables' first rows by `bundle/table` key (readLargeTableFile's `first`), shown while the rest is read. */
  first?: Record<string, Row[]>;
}

const noIndex = (): IndexDatabase => {
  throw new Error("this file's host reads no index");
};

function alertAsk(confirm: Confirm, answer: (response: string) => void) {
  Alert.alert(
    confirm.heading,
    confirm.body || undefined,
    confirm.responses.map((r) => ({
      text: r.label,
      style: r.id === "cancel" ? ("cancel" as const) : r.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => answer(r.id),
    })),
  );
}

function Opened({ shown, files, readOnly, locale, at, onOpenLink, ask, chrome, index, formulaSyntax }: Omit<TableFileViewProps, "read"> & { shown: EmbedShown }) {
  // A large table's rows are saved from its index, after the rest of the file is written.
  const saveIndexed = useRef<((tables: Record<string, ParsedTable>) => Promise<void>) | null>(null);
  const writing = useMemo(
    () => (index ? { ...files, write: async (...args: Parameters<EmbeddedTableFiles["write"]>) => (await files.write(...args), await saveIndexed.current?.(args[1])) } : files),
    [files, index],
  );
  const { state, dispatch, derived, display, tableName, related, callbacks } = useEmbeddedTable(shown, writing, locale);
  const indexed = useIndexedTables({
    state,
    dispatch,
    view: derived.shown.view,
    tell: (heading, body) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }),
    openIndexDatabase: index?.openIndexDatabase ?? noIndex,
  });
  saveIndexed.current = indexed.save;
  useEffect(() => {
    if (index?.first) indexed.hold(index.first);
    // Once: what reading the file gave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // This file's formula syntax, as the host chose it, over the viewer's display settings (the same object while neither changes).
  const shownDisplay = useMemo(() => (formulaSyntax ? { ...display, formulaSyntax } : display), [display, formulaSyntax]);
  const { table, view } = derived;
  const fromArchive = shown.library.paths[bundleOf(shown.key)] === undefined;
  const lookOnly = !!readOnly || fromArchive;
  const questions = ask ?? alertAsk;

  // Going to a row: its table and view shown, the row selected, its page open when it has one.
  const [select, setSelect] = useState<{ place: { rowId: string }; n: number } | null>(null);
  // New Field, asked of the table's header by count.
  const [newFieldAsk, setNewFieldAsk] = useState(0);
  const goTo = (address: string) => {
    const parsed = parseAddress(address);
    if (!parsed) return;
    const key = parsed.tableName ? `${bundleOf(shown.key)}/${parsed.tableName}` : state.active;
    if (!state.tables[key]) return;
    const rowId = parsed.rowId;
    const hasPage = rowId !== undefined && state.tables[key]!.bodies?.[rowId] !== undefined;
    const viewId = parsed.viewId ? (addressedView(state.tables[key]!.views, parsed.viewId)?.id ?? parsed.viewId) : undefined;
    dispatch({ type: "follow", target: { key, ...(viewId ? { viewId } : {}), openBody: hasPage ? rowId : null } });
    if (rowId) setSelect((was) => ({ place: { rowId }, n: (was?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (at) goTo(at.address);
    // Each request once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.n]);
  /** A linked row chosen: gone to here when it is in this file; else the host's to open. */
  const followLink = (address: string) => {
    const link = linkedRowAddress(address, shown.library, state, bundleOf(state.active));
    if (link && parseAddress(link)?.tablePath === shown.library.paths[bundleOf(shown.key)]) goTo(link);
    else if (link) onOpenLink?.(link);
  };

  // A question (deleting a row, say) or a message, in the host's own dialog, once each.
  const asking = state.asking;
  useEffect(() => {
    if (asking?.kind === "confirm") questions(asking.confirm, (response) => dispatch({ type: "answer", response }));
    // A name to type (a cell's note, a range of cells to merge): the system's own text prompt.
    else if (asking?.kind === "name")
      askName(asking.prompt, (text) => dispatch({ type: "answer", response: "create", text }), () => dispatch({ type: "answer", response: "cancel" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);
  const telling = state.telling;
  useEffect(() => {
    if (telling) questions({ heading: telling.heading, body: telling.body ?? "", responses: [{ id: "ok", label: "OK" }] }, () => dispatch({ type: "told" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telling]);

  const bundle = bundleOf(state.active);
  const tables = Object.keys(bundleTables(state.tables, bundle)).map((name) => {
    const key = `${bundle}/${name}`;
    return { key, title: state.tables[key]?.meta.title ?? tableNameOf(key) };
  });
  const file: TableFileChrome = {
    tables,
    table: state.active,
    showTable: (key) => key !== state.active && dispatch({ type: "showTable", key }),
    views: table.views.map((v: View) => ({ id: v.id, name: v.name, layout: LAYOUT_LABELS[v.layout] })),
    view: view.id,
    showView: (id) => id !== view.id && dispatch({ type: "showView", key: state.active, viewId: id }),
    count: derived.summary.count,
    ...(indexed.building ? { reading: readingText(indexed.building) } : {}),
    found: derived.summary.found,
    query: state.search,
    search: (text) => dispatch({ type: "search", text }),
    lookOnly,
    fromArchive,
    addView: () => dispatch({ type: "addView", id: newViewId() }),
    openSettings: () => dispatch({ type: "settings", open: true }),
    canUndo: derived.canUndo,
    canRedo: derived.canRedo,
    undoName: derived.undoName,
    redoName: derived.redoName,
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    breadcrumb: derived.breadcrumb.text,
    valid: derived.summary.valid,
    validity: derived.summary.validity,
    validityHint: derived.summary.validityHint,
    canGoBack: derived.canGoBack,
    canGoForward: derived.canGoForward,
    goBack: () => dispatch({ type: "back" }),
    goForward: () => dispatch({ type: "forward" }),
    canAddRow: !lookOnly,
    canAddField: !lookOnly && view.layout === "table",
    newRow: () => {
      if (!lookOnly) void callbacks.onAddRow?.();
    },
    newField: () => {
      if (!lookOnly && view.layout === "table") setNewFieldAsk((n) => n + 1);
    },
  };

  return (
    <DisplaySettingsProvider value={shownDisplay}>
      {chrome?.(file)}
      <LayoutView
        key={`${state.active}\u0000${view.id}`}
        layout={view.layout}
        view={derived.shown.view}
        rows={derived.shown.rows}
        schema={table.schema}
        bodies={table.bodies}
        relatedTables={related}
        allRows={table.rows}
        cells={table.cells}
        tableKey={tableName}
        sheet={derived.shown.sheet}
        // A large table's rows: from its index, or as many as are read so far while it's made.
        {...(indexed.source ?? indexed.reading ? { source: (indexed.source ?? indexed.reading)! } : {})}
        {...(lookOnly ? {} : callbacks)}
        onOpenRelation={followLink}
        restorePlace={select}
        newFieldRequest={newFieldAsk}
      />
      {state.settingsOpen && !lookOnly ? (
        <ViewSettings
          key={view.id}
          view={derived.shown.view}
          schema={table.schema}
          onChange={(patch) => dispatch({ type: "updateView", patch })}
          sheetReaders={sheetReaders(state.tables, state.active, view)}
          onDelete={table.views.length > 1 ? () => dispatch({ type: "deleteView" }) : undefined}
          onClose={() => dispatch({ type: "settings", open: false })}
          onCancel={() => dispatch({ type: "settings", open: false, revert: true })}
        />
      ) : null}
      {state.openPage !== null ? (
        <BodyEditor
          key={`${state.active}/${state.openPage}`}
          rowId={state.openPage}
          rowTitle={rowTitleFor(table, state.openPage)}
          content={table.bodies?.[state.openPage] ?? ""}
          onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
          onClose={() => dispatch({ type: "openPage", rowId: null })}
        />
      ) : null}
    </DisplaySettingsProvider>
  );
}

/** The document: the file once read, or why it can't be shown, in the host's page. */
export function TableFileView({ read, ...props }: TableFileViewProps) {
  if (read?.kind === "shown") {
    return <Opened key={`${read.library.paths[bundleOf(read.key)] ?? read.key}`} shown={read} {...props} />;
  }
  if (read?.kind === "problem") return <ProblemText text={read.text} />;
  return null;
}

function ProblemText({ text }: { text: string }) {
  return <html.p style={styles.problem}>{text}</html.p>;
}

const styles = css.create({
  problem: { paddingBlock: 16, fontSize: 15, color: { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" } },
});
