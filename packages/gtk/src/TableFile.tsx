// A .table opened as a document of its own (a folder, or a single-file .table), for
// an app on Node that opens files: its tables and their views to choose
// between, a search, and the view itself filling what it is given. The same
// state as an app of its own (table-app's useEmbeddedTable), so edits are
// written to the folder, go to its history and can be undone. A single-file .table
// is edited as its working folder and packed back into the file after each
// write (table-app's openSingleFile).

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkButton, GtkDropDown, GtkEventControllerKey, GtkLabel, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { bundleOf, bundleTables, derive, linkedRowAddress, tableNameOf, type EmbeddedTableFiles, type EmbedRead, type EmbedShown, type KeyValueStore } from "@workspace.sh/table-app";
import { embedFiles, readTableFile, type IndexHost } from "@workspace.sh/table-app/node";
import { storeFor, useEmbeddedTable } from "@workspace.sh/table-app/react";
import { LAYOUT_LABELS } from "@workspace.sh/table-ui/shared";
import { DisplaySettingsProvider } from "@workspace.sh/table-ui/shared";
import { newId, parseAddress, type ParsedTable } from "@workspace.sh/table-core";
import { useEffect, useMemo, useRef, useState } from "react";

import { LayoutView } from "./LayoutView.js";
import { StringList } from "./StringList.js";
import { TableDialogs } from "./TableDialogs.js";
import { styles } from "./theme.js";
import { useSelected } from "./useSelected.js";
import { ViewSettings } from "./ViewSettings.js";
import { IndexedView } from "./indexed/IndexedView.js";
import { sharedIndexHosts } from "./indexed/sharedHosts.js";
import { openWorkerIndexHost } from "./indexed/indexClient.js";
import { useIndexedTables } from "./indexed/useIndexedTables.js";

export interface TableFileProps {
  /** The `.table` folder, or a single-file `.table`. */
  path: string;
  /** To look at only: nothing in it can be changed, and nothing is written. */
  readOnly?: boolean;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /**
   * Where to go in the file, from the app: an address as the file's (`…/projects.table#table=tasks&view=v2&row=t3`).
   * Its table and view are shown, its row is selected, and its row's page opens when it has one. Each new `n` goes
   * there again.
   */
  at?: { address: string; n: number };
  /** A bundle's index, for a table too large to hold in memory: in a worker of its own unless given (a test's, in this thread). */
  openIndex?: (bundleDir: string) => IndexHost;
  /**
   * Where this reader's own sorts, filters and groupings of each view are kept (D4), apart from the file:
   * each file's under its own path. Absent: they last while the file is open.
   */
  store?: KeyValueStore;
  /**
   * A linked row in another `.table` was clicked: its address as that file's, for the app to open. A linked row
   * in this file is gone to here.
   */
  onOpenLink?: (address: string) => void;
}

function Opened({
  shown,
  readOnly,
  locale,
  at,
  store,
  openIndex,
  onOpenLink,
}: {
  shown: EmbedShown;
  store: KeyValueStore | null;
  openIndex: (bundleDir: string) => IndexHost;
  readOnly: boolean;
  locale: string | undefined;
  at: TableFileProps["at"];
  onOpenLink: ((address: string) => void) | undefined;
}) {
  const kept = useMemo(() => (store ? storeFor(store, shown.library.paths[bundleOf(shown.key)] ?? shown.key) : null), [store, shown]);
  // A large table's rows are in its bundle's index: written back after the rest of the bundle is.
  const saveIndexed = useRef<(bundles: string[], tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const files: EmbeddedTableFiles = {
    ...embedFiles,
    write: async (library, tables, metas, bundle) => {
      await embedFiles.write(library, tables, metas, bundle);
      await saveIndexed.current([bundle], tables);
    },
  };
  const { state, dispatch, derived: drawn, display, tableName, related, callbacks } = useEmbeddedTable(shown, files, locale, kept);
  // One index per folder, shared with any other view of this file (an embed of it).
  const sharedOpen = useMemo(() => sharedIndexHosts(openIndex), [openIndex]);
  const indexed = useIndexedTables({
    state,
    dispatch,
    view: drawn.shown.view,
    pathOf: (bundle) => shown.library.paths[bundle],
    openIndex: sharedOpen,
    tell: (heading, body) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } }),
  });
  saveIndexed.current = indexed.save;
  // The count says what the index has read, for a large table.
  const derived = indexed.source ? derive(state, { locale, newTableIn: "none", indexedShown: { count: indexed.source.count, inView: indexed.source.inView } }) : drawn;
  const { table, view } = derived;
  // Read into memory with nowhere to be written (no path): to look at.
  const fromArchive = shown.library.paths[bundleOf(shown.key)] === undefined;
  const lookOnly = readOnly || fromArchive;

  // The file's tables, and the views of the one on screen.
  const keys = Object.keys(bundleTables(state.tables, bundleOf(state.active))).map((name) => `${bundleOf(state.active)}/${name}`);
  const tableAt = Math.max(0, keys.indexOf(state.active));
  const tablesPicker = useSelected<Gtk.DropDown>(tableAt, keys.join("\u0000"));
  const views = table.views;
  const viewAt = Math.max(0, views.findIndex((v) => v.id === view.id));
  const viewsPicker = useSelected<Gtk.DropDown>(viewAt, views.map((v) => v.id).join("\u0000"));

  // Going to a row: its table and view shown, the row selected, its page open when it has one.
  const [select, setSelect] = useState<{ place: { rowId: string }; n: number } | null>(null);
  const goTo = (address: string) => {
    const parsed = parseAddress(address);
    if (!parsed) return;
    const bundle = bundleOf(shown.key);
    const key = parsed.tableName ? `${bundle}/${parsed.tableName}` : state.active;
    if (!state.tables[key]) return;
    const rowId = parsed.rowId;
    const hasPage = rowId !== undefined && state.tables[key]!.bodies?.[rowId] !== undefined;
    dispatch({ type: "follow", target: { key, ...(parsed.viewId ? { viewId: parsed.viewId } : {}), openBody: hasPage ? rowId : null } });
    if (rowId) setSelect((was) => ({ place: { rowId }, n: (was?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (at) goTo(at.address);
    // Each request once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.n]);
  /** A linked row clicked: gone to here when it is in this file; else the app's to open. */
  const followLink = (address: string) => {
    const link = linkedRowAddress(address, shown.library, state, bundleOf(state.active));
    if (link && parseAddress(link)?.tablePath === shown.library.paths[bundleOf(shown.key)]) goTo(link);
    else if (link) onOpenLink?.(link);
  };

  // The view's own settings: its layout and fields for everyone who opens the file; sorts, filters and
  // grouping this reader's own until saved for everyone.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const undoKeys = (keyval: number, mods: Gdk.ModifierType): boolean => {
    if (lookOnly || !(mods & Gdk.ModifierType.CONTROL_MASK)) return false;
    const key = Gdk.keyvalToLower(keyval);
    const shift = !!(mods & Gdk.ModifierType.SHIFT_MASK);
    if (key === Gdk.KEY_z && !shift && derived.canUndo) dispatch({ type: "undo" });
    else if (((key === Gdk.KEY_z && shift) || key === Gdk.KEY_y) && derived.canRedo) dispatch({ type: "redo" });
    else return false;
    return true;
  };

  return (
    <DisplaySettingsProvider value={display}>
      <GtkBox name="table-file" orientation={Gtk.Orientation.VERTICAL} vexpand hexpand controllers={<GtkEventControllerKey onKeyPressed={(keyval, _code, mods) => undoKeys(keyval, mods)} />}>
        <GtkBox spacing={8} marginStart={12} marginEnd={12} marginTop={6} marginBottom={6}>
          {keys.length > 1 ? (
            <GtkDropDown
              ref={tablesPicker}
              name="table-file-tables"
              tooltipText="Table"
              model={<StringList strings={keys.map((key) => state.tables[key]?.meta.title ?? tableNameOf(key))} />}
              onNotifySelected={(index) => {
                const key = index === null ? undefined : keys[index];
                if (key && key !== state.active) dispatch({ type: "showTable", key });
              }}
            />
          ) : null}
          {views.length > 1 ? (
            <GtkDropDown
              ref={viewsPicker}
              name="table-file-views"
              tooltipText="View"
              model={<StringList strings={views.map((v) => `${v.name} · ${LAYOUT_LABELS[v.layout]}`)} />}
              onNotifySelected={(index) => {
                const chosen = index === null ? undefined : views[index];
                if (chosen && chosen.id !== view.id) dispatch({ type: "showView", key: state.active, viewId: chosen.id });
              }}
            />
          ) : null}
          <GtkLabel name="table-file-count" label={derived.summary.count} hexpand xalign={0} cssClasses={["dim-label"]} />
          {fromArchive ? <GtkLabel label="To look at only: there’s nowhere to save changes" cssClasses={["dim-label", "caption"]} /> : null}
          <GtkSearchEntry placeholderText="Search rows" onSearchChanged={(entry) => dispatch({ type: "search", text: entry.getText() })} />
          {lookOnly ? null : (
            <>
              <GtkButton iconName="list-add-symbolic" tooltipText="New View" cssClasses={["flat"]} onClicked={() => dispatch({ type: "addView", id: newId() })} />
              <GtkButton iconName="emblem-system-symbolic" tooltipText="View Settings" cssClasses={["flat"]} onClicked={() => setSettingsOpen(true)} />
            </>
          )}
        </GtkBox>
        {table.indexed ? (
          // A table this large is read through its bundle's index (SPEC section 8), as the table app reads it.
          <IndexedView
            indexed={indexed}
            view={derived.shown.view}
            table={table}
            tableName={tableName}
            related={related}
            sheet={derived.shown.sheet}
            viewKey={`${state.active}\u0000${view.id}`}
            edits={lookOnly ? {} : callbacks}
            onOpenRelation={followLink}
            restorePlace={select}
          />
        ) : (
          <LayoutView
            key={`${state.active}\u0000${view.id}`}
            layout={view.layout}
            view={derived.shown.view}
            rows={derived.shown.rows}
            schema={table.schema}
            bodies={table.bodies}
            relatedTables={related}
            allRows={table.rows}
            tableKey={tableName}
            sheet={derived.shown.sheet}
            {...(lookOnly ? {} : callbacks)}
            onOpenRelation={followLink}
            restorePlace={select}
          />
        )}
      </GtkBox>
      {settingsOpen && !lookOnly ? (
        <ViewSettings
          view={derived.shown.view}
          schema={table.schema}
          onChange={callbacks.onUpdateView}
          {...(views.length > 1 ? { onDelete: () => dispatch({ type: "deleteView" }) } : {})}
          // Sorts, filters and grouping are this reader's own until saved for everyone (D4).
          onArrange={(patch) => dispatch({ type: "arrange", patch })}
          personal={derived.arranged}
          onSaveForEveryone={() => dispatch({ type: "saveForEveryone" })}
          onReset={() => dispatch({ type: "resetArrangement" })}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <TableDialogs state={state} dispatch={dispatch} table={table} />
    </DisplaySettingsProvider>
  );
}

export function TableFile({ path, readOnly = false, locale, at, store, openIndex = openWorkerIndexHost, onOpenLink }: TableFileProps) {
  const [read, setRead] = useState<EmbedRead | null>(null);
  useEffect(() => {
    let current = true;
    setRead(null);
    void readTableFile(path).then((result) => {
      if (current) setRead(result);
    });
    return () => {
      current = false;
    };
  }, [path]);
  if (read?.kind === "shown") return <Opened key={path} shown={read} readOnly={readOnly} locale={locale} at={at} store={store ?? null} openIndex={openIndex} onOpenLink={onOpenLink} />;
  if (read?.kind === "problem") {
    return (
      <GtkBox name="table-file-problem" vexpand valign={Gtk.Align.START} marginStart={12} marginEnd={12} marginTop={12} cssClasses={[styles.embedProblem]}>
        <GtkLabel label={read.text} xalign={0} wrap hexpand cssClasses={["dim-label"]} />
      </GtkBox>
    );
  }
  return <GtkBox vexpand />;
}
