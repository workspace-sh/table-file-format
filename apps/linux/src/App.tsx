// The .table demo on Linux: the harness for @workspace.sh/table-gtk, as
// apps/web is for table-ui. A navigation sidebar of every table in the open
// `.table` folders, with the open table's views under it, as the web demo's
// sidebar has them. What a view shows comes from table-app's `showView`,
// the same function the web demo calls.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import * as Adw from "@gtkx/gi/adw";
import * as Gdk from "@gtkx/gi/gdk";
import * as Gio from "@gtkx/gi/gio";
import {
  AdwAlertDialog,
  AdwApplication,
  AdwAboutDialog,
  AdwApplicationWindow,
  AdwBreakpoint,
  AdwDialog,
  AdwPreferencesPage,
  AdwHeaderBar,
  AdwOverlaySplitView,
  AdwSpinner,
  AdwStatusPage,
  AdwToolbarView,
  AdwWindowTitle,
} from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkEntry, GtkLabel, GtkMenuButton, GtkPopoverMenu, GtkProgressBar, GtkToggleButton, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { GMenu, GSimpleAction } from "@gtkx/jsx/gio";
import { quit } from "@gtkx/react";
import {
  derive,
  initialAppState,
  viewCallbacks,
  buildLabel,
  ARCHIVE_ROWS,
  tooLargeToArchiveText,
  type Derived,
  type ViewCallbacks,
  archiveFileName,
  bundleToArchive,
  fromBundle,
  exportFailedText,
  openArchive,
  openFailedText,
  resetPrompt,
  toBundle,
  gtkAccelOf,
  loadSidebarPrefs,
  type AppCommand,
  type AppCommandId,
  attachmentAt,
  attachmentPath,
  bundleOf,
  fileText,
  flattenFilesTree,
  type SidebarEntry,
  displayChoices,
  loadDisplay,
  type KeyValueStore,
  bundleTables,
  rowTitleFor,
  tableNameOf,
  loadArrangements,
  type Confirm,
  type NamePrompt,
} from "@workspace.sh/table-app";
import { useTableApp, type SaveState } from "@workspace.sh/table-app/react";
import { attachFile, attachmentsIn, bundlesIn, loadLibrary, openIndexHost, saveBundle, type IndexHost, type Library } from "@workspace.sh/table-app/node";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { FilePane, FilesSidebar } from "./Files.js";
import { newId, type ParsedTable, type Row, type View, type ViewRows } from "@workspace.sh/table-core";
import { useIndexedTables } from "./useIndexedTables.js";
import {
  AttachmentsProvider,
  BoardView,
  CalendarView,
  DisplayControls,
  DisplaySettingsProvider,
  GalleryView,
  ListView,
  RowPage,
  TableView,
  ViewSettings,
  type ViewProps,
} from "@workspace.sh/table-gtk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** A line of the sidebar: table-app's tree, flattened for a ListBox. */
type Entry = SidebarEntry;

function Sidebar({
  entries,
  selected,
  onSelect,
  onNewTable,
  onToggleFile,
}: {
  entries: Entry[];
  selected: number;
  onSelect: (entry: Entry) => void;
  /** Start a new table in a bundle, as a new sheet in a workbook (D37). */
  onNewTable: (bundle: string) => void;
  /** Fold a .table file's tables away, or show them again. */
  onToggleFile: (bundle: string) => void;
}) {
  return (
    <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkListBox
        cssClasses={["navigation-sidebar"]}
        selectionMode={Gtk.SelectionMode.SINGLE}
        selectedIndex={selected}
        // `row-selected` fires for the selection this sets too; only a
        // row other than the one shown is a choice.
        onRowSelected={(row) => {
          if (row === null || row.getIndex() === selected) return;
          const entry = entries[row.getIndex()];
          if (entry) onSelect(entry);
        }}
      >
        {entries.map((entry) => {
          switch (entry.kind) {
            case "bundle":
              return (
                <GtkListBoxRow key={`b:${entry.bundle.bundle}`} selectable={false} activatable={false}>
                  <GtkBox marginTop={12} spacing={2}>
                    <GtkButton
                      iconName={entry.bundle.folded ? "pan-end-symbolic" : "pan-down-symbolic"}
                      cssClasses={["flat", "circular"]}
                      tooltipText={`${entry.bundle.folded ? "Show" : "Hide"} Tables in ${entry.bundle.title}`}
                      onClicked={() => onToggleFile(entry.bundle.bundle)}
                    />
                    <GtkLabel label={entry.bundle.title} xalign={0} hexpand cssClasses={["heading", "dim-label"]} />
                    <GtkButton
                      iconName="list-add-symbolic"
                      cssClasses={["flat", "circular"]}
                      tooltipText={`New Table in ${entry.bundle.title}`}
                      onClicked={() => onNewTable(entry.bundle.bundle)}
                    />
                  </GtkBox>
                </GtkListBoxRow>
              );
            case "table":
              return (
                <GtkListBoxRow key={`t:${entry.table.key}`}>
                  <GtkLabel label={entry.table.title} xalign={0} marginStart={6} />
                </GtkListBoxRow>
              );
            case "view":
              return (
                <GtkListBoxRow key={`v:${entry.key}#${entry.view.id}`}>
                  <GtkBox spacing={6} marginStart={22}>
                    <GtkLabel label={entry.view.name} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.END} maxWidthChars={1} />
                    <GtkLabel label={entry.view.layoutLabel} cssClasses={["caption", "dim-label"]} />
                  </GtkBox>
                </GtkListBoxRow>
              );
          }
        })}
      </GtkListBox>
    </GtkScrolledWindow>
  );
}

/** The table-gtk view for a layout, as the web demo's `renderView` picks the table-ui one. */
function LayoutView({ layout, ...props }: ViewProps & { layout: View["layout"] }) {
  switch (layout) {
    case "board":
      return <BoardView {...props} />;
    case "gallery":
      return <GalleryView {...props} />;
    case "list":
      return <ListView {...props} />;
    case "calendar":
      return <CalendarView {...props} />;
    default:
      return <TableView {...props} />;
  }
}

/** What the header can do to the table's views, and this viewer's own arrangement of it. */
interface ViewActions {
  onAddView: () => void;
  /** Absent for the table's only view. */
  onDeleteView?: () => void;
  /** This viewer's own filters, sorts and grouping of the view (D4). */
  arranged: boolean;
  onArrange: (patch: Partial<View>) => void;
  onSaveForEveryone: () => void;
  onReset: () => void;
}

function TablePane({
  derived,
  tables,
  tableKey,
  callbacks,
  saving,
  onRetrySave,
  viewActions,
  onSearch,
  settingsOpen,
  onSettings,
  revision,
  navigation,
  menu,
  source,
  building,
  reading,
}: {
  /** While a large table's index is made: its rows as stored, as many as are read so far, shown meanwhile. */
  reading?: ViewRows;
  /** For a table held in the index: its view's rows once read, and how far its index has got while it's being made. */
  source?: ViewRows;
  building: { done: number; total: number } | null;
  /** What table-app's derive gives for the view on screen. */
  derived: Derived;
  tables: Record<string, ParsedTable>;
  tableKey: string;
  /** What the views can ask the app to change: table-app's viewCallbacks, and attaching a file. */
  callbacks: ViewCallbacks & { onAttachFile: (rowId: string, field: string) => void };
  saving: SaveState;
  onRetrySave: () => void;
  viewActions: ViewActions;
  onSearch: (text: string) => void;
  /** View Settings shown: from its button, or for a view just made. */
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
  /** Bumped when a settings change is refused, so its controls show the view as it still is. */
  revision: number;
  /** Back and forward, at the header's start. */
  navigation: ReactNode;
  /** The primary menu, at the header's end. */
  menu: ReactNode;
}) {
  const { table, view, shown, summary, breadcrumb } = derived;
  // The rows of a large table still being read, shown until its own view's rows are here.
  const showReading = view.layout === "table" && !source && !!reading;
  const related = useMemo(() => bundleTables(tables, bundleOf(tableKey)), [tables, tableKey]);

  return (
    <AdwToolbarView
      topBar={
        <AdwHeaderBar
          titleWidget={<AdwWindowTitle title={view.name} subtitle={breadcrumb.text} />}
          start={
            <>
              {navigation}
              <GtkButton iconName="list-add-symbolic" tooltipText="New View" onClicked={viewActions.onAddView} />
            </>
          }
          end={
            <>
              {menu}
              <GtkButton iconName="emblem-system-symbolic" tooltipText="View Settings" onClicked={() => onSettings(true)} />
              <SaveStatus state={saving} onRetry={onRetrySave} />
            </>
          }
        />
      }
    >
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={6}>
          {/* While a large table is read, how far that has got is in the count's place. */}
          {building ? (
            <GtkBox spacing={12} hexpand>
              <GtkLabel
                label={building.total > 0 ? `${building.done.toLocaleString()} of ${building.total.toLocaleString()} rows read` : "Reading rows"}
                cssClasses={["dim-label"]}
              />
              <GtkProgressBar valign={Gtk.Align.CENTER} widthRequest={160} fraction={building.total > 0 ? building.done / building.total : 0} />
            </GtkBox>
          ) : null}
          <GtkBox spacing={6} hexpand visible={!building}>
            <GtkLabel label={summary.count} cssClasses={["dim-label"]} />
            <GtkLabel label="·" cssClasses={["dim-label"]} />
            <GtkLabel label={summary.validity} tooltipText={summary.validityHint} cssClasses={[summary.valid ? "success" : "error"]} />
            {summary.schemaChanged ? (
              <>
                <GtkLabel label="·" cssClasses={["dim-label"]} />
                <GtkLabel label={summary.schemaChangedLabel} tooltipText={summary.schemaChangedHint} cssClasses={["warning"]} />
              </>
            ) : null}
          </GtkBox>
          <GtkSearchEntry placeholderText="Search rows" sensitive={!building} onSearchChanged={(entry) => onSearch(entry.getText())} />
        </GtkBox>
        {building && !showReading ? (
          <AdwStatusPage
            vexpand
            title="Getting This Table Ready"
            description={
              building.total > 0
                ? `${building.done.toLocaleString()} of ${building.total.toLocaleString()} rows read. This happens once; it opens straight away after.`
                : "Reading its rows. This happens once; it opens straight away after."
            }
          >
            <GtkProgressBar halign={Gtk.Align.CENTER} widthRequest={320} fraction={building.total > 0 ? building.done / building.total : 0} />
          </AdwStatusPage>
        ) : table.indexed && view.layout !== "table" && source ? (
          // The other layouts draw every row they're given, so they get a large
          // table's rows only when its view has narrowed them to few enough.
          <FewRows source={source}>
            {(rows) => (
              <LayoutView
                key={view.id}
                layout={view.layout}
                view={shown.view}
                rows={rows}
                schema={table.schema}
                bodies={table.bodies}
                relatedTables={related}
                tableKey={tableNameOf(tableKey)}
                {...callbacks}
                onRemoveEnumValue={undefined}
                onInsertRow={undefined}
              />
            )}
          </FewRows>
        ) : table.indexed && !source && !showReading ? (
          <GtkBox vexpand />
        ) : (
          // A large table shows its rows at once, as its file has them, and as many as have
          // been read so far, while its index is made (LARGE-TABLES-PLAN, decision 1): to
          // scroll through and look at. The view's own order, filters and groups, search
          // and editing come with the index. One table view for both, so where you had
          // scrolled to is where you still are when the reading is done.
          <>
            {showReading ? (
              <GtkLabel label={ingestingText(shown.view)} xalign={0} wrap marginStart={12} marginEnd={12} marginBottom={6} cssClasses={["dim-label", "caption"]} />
            ) : null}
            {/* While it's read it is to look at, not to work in: nothing in it takes the keyboard. */}
            <GtkBox canFocus={!showReading} vexpand>
              {showReading ? (
                <LayoutView
                  key={view.id}
                  layout="table"
                  view={asStored(shown.view)}
                  rows={NO_ROWS}
                  source={reading}
                  schema={table.schema}
                  relatedTables={related}
                  tableKey={tableNameOf(tableKey)}
                />
              ) : (
                <LayoutView
                  key={view.id}
                  layout={view.layout}
                  view={shown.view}
                  rows={shown.rows}
                  schema={table.schema}
                  bodies={table.bodies}
                  relatedTables={related}
                  allRows={table.rows}
                  tableKey={tableNameOf(tableKey)}
                  sheet={shown.sheet}
                  {...callbacks}
                  {...(table.indexed
                    ? {
                        source,
                        // Removing a choice takes it out of every row that holds it, which the index can't yet do in place.
                        onRemoveEnumValue: undefined,
                        onInsertRow: undefined,
                      }
                    : {})}
                />
              )}
            </GtkBox>
          </>
        )}
      </GtkBox>
      {settingsOpen ? (
        <ViewSettings
          view={shown.view}
          schema={table.schema}
          // The reducer asks first when a sheet that formulas read would go (viewPatchPrompt).
          onChange={callbacks.onUpdateView}
          onDelete={viewActions.onDeleteView}
          onArrange={viewActions.onArrange}
          personal={viewActions.arranged}
          onSaveForEveryone={viewActions.onSaveForEveryone}
          onReset={viewActions.onReset}
          onClose={() => onSettings(false)}
          revision={revision}
        />
      ) : null}
    </AdwToolbarView>
  );
}

/** The most rows a layout that draws every row it's given is handed, of a table held in the index. */
const LAYOUT_ROWS = 5000;

/**
 * A view's rows out of the index, all of them, for a layout that isn't the
 * table's: when there are few enough. Otherwise it says how to get there.
 */
function FewRows({ source, children }: { source: ViewRows; children: (rows: Row[]) => ReactNode }) {
  const [read, setRead] = useState<{ version: string; rows: Row[] } | null>(null);
  const few = source.count <= LAYOUT_ROWS;
  useEffect(() => {
    if (!few) return;
    let current = true;
    void Promise.resolve(source.rows(0, source.count)).then((rows) => current && setRead({ version: source.version, rows }));
    return () => {
      current = false;
    };
  }, [source, few]);
  if (!few) {
    return (
      <AdwStatusPage
        vexpand
        title="Too Many Rows for This Layout"
        description={`This view shows ${source.count.toLocaleString()} rows. Layouts other than Table show up to ${LAYOUT_ROWS.toLocaleString()}: add a filter in View Settings, search, or change the layout to Table.`}
      />
    );
  }
  // The last rows read stay until the next arrive, so an edit doesn't blank the view.
  return read ? <>{children(read.rows)}</> : <GtkBox vexpand />;
}

/** A view with only what the head of a file can show: its fields and sizes, not its order, filters, groups or totals. */
function asStored(view: View): View {
  const { sort: _sort, order: _order, filter: _filter, group: _group, totals: _totals, ...rest } = view;
  return rest;
}

const NO_ROWS: Row[] = [];

/** What the line above the first rows says while the index is made. */
function ingestingText(view: View): string {
  const arranged = !!(view.sort?.length || view.order?.length || view.filter?.length || view.group);
  return arranged
    ? "Showing rows as stored, as they're read. This view's sorting, filters and groups, and search and editing, are ready once the table is read. This happens once."
    : "Showing rows as stored, as they're read. Search and editing are ready once the table is read. This happens once.";
}

/** A path from GTK's file chooser, set up by `ask`; null when it's dismissed. */
async function choosePath(ask: (dialog: Gtk.FileDialog) => Promise<Gio.File>): Promise<string | null> {
  try {
    const file = await ask(Gtk.FileDialog.new());
    return file?.getPath() ?? null;
  } catch {
    // Dismissed: the dialog rejects on that as on failure.
    return null;
  }
}

/** A .table.zip file to choose, and no other kind. */
function zipFilter(dialog: Gtk.FileDialog): Gtk.FileDialog {
  const filter = Gtk.FileFilter.new();
  filter.setName(".table.zip");
  filter.addPattern("*.zip");
  dialog.setDefaultFilter(filter);
  return dialog;
}

const chooseFileToAttach = () => choosePath((d) => d.open(null, null));
const chooseFolderToOpen = () => choosePath((d) => d.selectFolder(null, null));
const chooseZipToOpen = () => choosePath((d) => zipFilter(d).open(null, null));
const chooseZipToSave = (name: string) =>
  choosePath((d) => {
    d.setInitialName(name);
    return zipFilter(d).save(null, null);
  });

/** A question from table-app (a Confirm), asked as an alert; closing it is Cancel. */
function ConfirmDialog({ prompt, onResponse }: { prompt: Confirm; onResponse: (response: string) => void }) {
  return (
    <AdwAlertDialog
      heading={prompt.heading}
      body={prompt.body}
      closeResponse="cancel"
      defaultResponse="cancel"
      responses={prompt.responses.map((r) => ({
        id: r.id,
        label: r.label,
        ...(r.destructive ? { appearance: Adw.ResponseAppearance.DESTRUCTIVE } : {}),
      }))}
      onResponse={onResponse}
    />
  );
}

/** Ask for a name, worded by table-app's namePrompt; what's typed goes to `onName` as it is. */
function NameDialog({ prompt, onName, onClose }: { prompt: NamePrompt; onName: (typed: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <AdwAlertDialog
      heading={prompt.heading}
      closeResponse="cancel"
      defaultResponse="create"
      responses={[
        { id: "cancel", label: "Cancel" },
        { id: "create", label: prompt.action, appearance: Adw.ResponseAppearance.SUGGESTED },
      ]}
      onResponse={(response) => {
        if (response === "create") onName(name);
        onClose();
      }}
    >
      <GtkEntry placeholderText={prompt.placeholder} activatesDefault onChanged={(e) => setName(e.getText())} />
    </AdwAlertDialog>
  );
}

/**
 * Where the files stand, in the header bar: nothing when they're saved (a
 * document app that saves as you go says nothing when it has), a spinner
 * while writing, and the reason when a write failed.
 */
function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === "saved") return null;
  if (state.kind === "saving") return <AdwSpinner widthRequest={16} heightRequest={16} tooltipText="Saving…" />;
  // Not written: says why, and tries again when pressed.
  return <GtkButton iconName="dialog-warning-symbolic" cssClasses={["flat", "error"]} tooltipText={`Not saved: ${state.message}. Try Again`} onClicked={onRetry} />;
}

/** How long after the last edit its bundle is written. */
const SAVE_DELAY_MS = 400;

/** The system's locale, as the platform resolves it (LANG and friends on Linux). */
function systemLocale(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en-US";
  }
}

export function App({
  library,
  initialTable,
  initialView,
  settings,
  newFilesIn,
  chooseFile = chooseFileToAttach,
  chooseFolder = chooseFolderToOpen,
  chooseZip = chooseZipToOpen,
  chooseZipSaveAs = chooseZipToSave,
  resetExamples,
  openIndex = openIndexHost,
  indexedFrom,
}: {
  /** Opens a bundle's index: in a worker in the app, in place where nothing else is drawing. */
  openIndex?: (bundleDir: string) => IndexHost;
  /** Tables with this many rows or more, opened from here on, are read through the index. Absent: every table is held in memory. */
  indexedFrom?: number;
  library: Library;
  initialTable?: string;
  initialView?: string;
  /** Where this viewer's own settings are kept; absent, they last for this run only. */
  settings?: KeyValueStore;
  /** The folder new .table files are made in (the examples' own); absent, none can be made. */
  newFilesIn?: string;
  /** Ask for a file to attach; a path, or null when none was chosen. */
  chooseFile?: () => Promise<string | null>;
  /** Ask for a .table folder to open. */
  chooseFolder?: () => Promise<string | null>;
  /** Ask for a .table.zip to open. */
  chooseZip?: () => Promise<string | null>;
  /** Ask where to save a .table.zip, suggesting `name`. */
  chooseZipSaveAs?: (name: string) => Promise<string | null>;
  /**
   * Put the examples back as they shipped, in `newFilesIn`, and read them,
   * keyed apart from `held`. Absent: there's no demo data to reset.
   */
  resetExamples?: (held: string[]) => Promise<Library>;
}) {
  const ownLocale = systemLocale();
  const store = settings ?? null;
  // Everything the app holds, and every change to it: table-app's reducer
  // (docs/APP-STATE.md), as the web and the Mac hold theirs. What's left
  // here is Linux's own: where bundles are on disk, the file choosers, the
  // window's narrow layout, and drawing.
  // Every change to it is written as the web and the Mac write theirs:
  // table-app's useTableApp, with Linux's own writer.
  const resetting = useRef(false);
  // Closed once, and not everything could be written: a second close quits anyway.
  const closing = useRef(false);
  // Set once the indexed tables' hook below has run: a write can only come after.
  const saveIndexed = useRef<(bundles: string[], tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const { state, dispatch, display: shownDisplay, saving, flush } = useTableApp(() => {
    // The examples, in newFilesIn, are the demo's own, and a reset puts them
    // back; a folder named on the command line or opened is the viewer's.
    const inExamples = (path: string) => !!newFilesIn && path.startsWith(`${newFilesIn}/`);
    // `--open` names where to start (a link lands on the Tables side);
    // otherwise table-app's first table, and the side the viewer left.
    const startKey = initialTable && library.tables[initialTable] ? initialTable : undefined;
    return initialAppState({
      tables: library.tables,
      bundles: library.bundles,
      opened: Object.fromEntries(Object.entries(library.paths).filter(([, path]) => !inExamples(path))),
      stored: { sidebar: loadSidebarPrefs(store), arrangements: loadArrangements(store), display: loadDisplay(store) },
      ...(startKey ? { start: { tablePath: startKey, ...(initialView ? { viewId: initialView } : {}) } } : {}),
    });
  }, {
    store,
    delayMs: SAVE_DELAY_MS,
    // Each bundle to where it is on disk. A reset holds writing while it puts the examples back.
    write: async (bundles, tables, metas) => {
      if (resetting.current) return false;
      const paths = Object.fromEntries(bundles.map((b) => [b, pathOf(b)]).filter(([, p]) => p !== undefined) as [string, string][]);
      await Promise.all(bundles.map((b) => saveBundle({ ...library, paths }, tables, metas, b)));
      await saveIndexed.current(bundles, tables);
    },
  }, ownLocale);
  const { tables, bundles } = state;

  // Where a bundle is on disk: the folder it was opened from, else the new-files folder.
  const pathOf = (bundle: string): string | undefined => state.opened[bundle] ?? (newFilesIn ? `${newFilesIn}/${bundle}.table` : undefined);
  // A table's own folder, where its attachments/ is.
  const tableDir = (key: string) => `${pathOf(bundleOf(key))}/tables/${tableNameOf(key)}`;

  const deriveOptions = {
    locale: ownLocale,
    newTableIn: "none" as const,
    attachmentsOf: (key: string) => (pathOf(bundleOf(key)) ? attachmentsIn(tableDir(key)) : []),
    fileNameOf: (bundle: string) => pathOf(bundle)?.split("/").pop(),
  };
  const tell = (heading: string, body?: string) => dispatch({ type: "tell", message: { heading, ...(body ? { body } : {}) } });
  // Tables held in the index: their rows are read, edited and saved there.
  const indexed = useIndexedTables({ state, dispatch, view: derive(state, deriveOptions).shown.view, pathOf, openIndex, tell });
  saveIndexed.current = indexed.save;
  const derived = derive(state, {
    ...deriveOptions,
    ...(indexed.source ? { indexedShown: { count: indexed.source.count, inView: indexed.source.inView } } : {}),
  });
  // The layout reads the way the display language does (D40), the whole app included.
  useEffect(() => {
    Gtk.Widget.setDefaultDirection(derived.direction === "rtl" ? Gtk.TextDirection.RTL : Gtk.TextDirection.LTR);
  }, [derived.direction]);

  // A narrow window: the sidebar lays over the content, hidden until asked for.
  const [narrow, setNarrow] = useState(false);
  const [shownWhileNarrow, setShownWhileNarrow] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Bumped when a settings change is answered Cancel, so its controls show the view as it still is.
  const [refused, setRefused] = useState(0);

  const callbacks = {
    ...viewCallbacks(state, dispatch, newId),
    // The file is copied into the table's attachments/ and the cell set to its name.
    onAttachFile: (rowId: string, field: string) => {
      void chooseFile().then((source) => {
        if (!source) return;
        try {
          dispatch({ type: "updateRow", rowId, field, value: attachFile(tableDir(state.active), source) });
        } catch (error) {
          tell(`Couldn't attach ${basename(source)}`, error instanceof Error ? error.message : String(error));
        }
      });
    },
  };
  const viewActions: ViewActions = {
    onAddView: () => dispatch({ type: "addView", id: newId() }),
    ...(derived.table.views.length > 1 ? { onDeleteView: () => dispatch({ type: "deleteView" }) } : {}),
    arranged: derived.arranged,
    onArrange: (patch) => dispatch({ type: "arrange", patch }),
    onSaveForEveryone: () => dispatch({ type: "saveForEveryone" }),
    onReset: () => dispatch({ type: "resetArrangement" }),
  };

  // A .table folder from disk, edited where it is.
  const openFolder = async () => {
    const path = await chooseFolder();
    if (!path) return;
    const opened = await loadLibrary([path], Object.keys(bundles), indexedFrom === undefined ? {} : { indexedFrom });
    const problems = Object.values(opened.problems).flat();
    if (Object.keys(opened.tables).length === 0) return tell(openFailedText(basename(path), problems.join("; ") || "there's no table in it"));
    dispatch({ type: "opened", library: opened, ...(problems.length > 0 ? { skipped: problems } : {}) });
  };
  // A .table.zip becomes a .table folder beside the new files, written as it opens.
  const openZip = async () => {
    const path = await chooseZip();
    if (!path || !newFilesIn) return;
    try {
      // Named apart from the tables held and from any folder already there.
      const onDisk = bundlesIn(newFilesIn).map((folder) => basename(folder).replace(/\.table$/, ""));
      const opened = await openArchive(new Uint8Array(readFileSync(path)), [...Object.keys(bundles), ...onDisk]);
      const library: Library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
      dispatch({ type: "opened", library, ...(opened.skipped.length > 0 ? { skipped: opened.skipped } : {}) });
    } catch (error) {
      tell(openFailedText(basename(path), error));
    }
  };
  // The open table's .table, every table in it, as one .table.zip.
  const exportZip = async () => {
    const key = bundleOf(state.active);
    const path = await chooseZipSaveAs(archiveFileName(key));
    if (!path) return;
    try {
      // A table held in the index has its rows read out of it for the archive, which is made in memory.
      const whole = { ...tables };
      for (const [k, t] of Object.entries(tables)) {
        if (bundleOf(k) !== key || !t.indexed) continue;
        if (t.indexed.count > ARCHIVE_ROWS) {
          const { heading, body } = tooLargeToArchiveText(tableNameOf(k), t.indexed.count);
          return tell(heading, `${body} The .table folder itself can be copied as it is.`);
        }
        const { indexed: _held, ...rest } = t;
        whole[k] = { ...rest, rows: await indexed.everyRow(k) };
      }
      writeFileSync(path, await bundleToArchive(key, toBundle(whole, bundles, key)));
    } catch (error) {
      tell(exportFailedText(basename(path), error));
    }
  };
  // The examples as they shipped, once asked (resetPrompt): asked here, as
  // putting them back rewrites their folder, and only then given to the reducer.
  const reset = async () => {
    if (!resetExamples) return;
    resetting.current = true;
    try {
      const fresh = await resetExamples(Object.keys(state.opened));
      dispatch({ type: "reset", fresh });
      dispatch({ type: "answer", response: "reset" });
    } finally {
      resetting.current = false;
    }
  };

  // The app's commands (table-app's appCommands), each an action on the
  // window with its accelerator, and in the primary menu. Those Linux
  // doesn't do are left out.
  const run: Partial<Record<AppCommandId, () => void>> = {
    ...(newFilesIn ? { "new-file": () => dispatch({ type: "create", making: { kind: "file" } }), "open-zip": () => void openZip() } : {}),
    "open-folder": () => void openFolder(),
    "export-zip": () => void exportZip(),
    // With the open page's row, as the web's address and the Mac's link have it.
    "copy-link": () => Gdk.Display.getDefault()?.getClipboard().setContent(Gdk.ContentProvider.newForValue(derived.address)),
    "tables-mode": () => dispatch({ type: "setFilesSide", files: false }),
    "files-mode": () => dispatch({ type: "setFilesSide", files: true }),
    // Narrow, Ctrl+B shows or hides the sidebar over the content, leaving the saved choice as it was.
    "toggle-sidebar": () =>
      narrow ? setShownWhileNarrow(!shownWhileNarrow) : dispatch({ type: "setSidebarCollapsed", collapsed: state.sidebar.collapsed !== true }),
    "go-back": () => dispatch({ type: "back" }),
    "go-forward": () => dispatch({ type: "forward" }),
  };
  const commands: AppCommand[] = derived.commands.filter((c) => run[c.id]);
  const menuSections = ["File", "Edit", "View", "Go"]
    .map((menu) => ({ section: commands.filter((c) => c.menu === menu).map((c) => ({ label: c.label, action: `win.${c.id}` })) }))
    .filter((s) => s.section.length > 0);
  if (resetExamples) menuSections.push({ section: [{ label: "Reset Demo Data…", action: "win.reset-data" }] });
  // The app's own: this viewer's display settings, and what build this is.
  menuSections.push({ section: [{ label: "Display…", action: "win.display" }, { label: "About Tables", action: "win.about" }] });
  const primaryMenu = (
    <GtkMenuButton iconName="open-menu-symbolic" tooltipText="Main Menu" primary popover={<GtkPopoverMenu menuModel={<GMenu items={menuSections} />} />} />
  );
  const sidebarShown = narrow ? shownWhileNarrow : state.sidebar.collapsed !== true;
  const navigation = (
    <>
      {sidebarShown ? null : <GtkButton iconName="sidebar-show-symbolic" tooltipText="Show Sidebar" onClicked={() => run["toggle-sidebar"]?.()} />}
      <GtkBox cssClasses={["linked"]}>
        <GtkButton iconName="go-previous-symbolic" tooltipText="Back" sensitive={derived.canGoBack} onClicked={() => dispatch({ type: "back" })} />
        <GtkButton iconName="go-next-symbolic" tooltipText="Forward" sensitive={derived.canGoForward} onClicked={() => dispatch({ type: "forward" })} />
      </GtkBox>
    </>
  );

  const entries = derived.sidebarEntries;
  const held = tables[state.active] !== undefined;
  const selected = entries.findIndex((e) => e.kind === "view" && e.key === state.active && e.view.id === derived.view.id);
  const fileEntries = useMemo(() => flattenFilesTree(derived.filesTree), [derived.filesTree]);
  const shownFile = state.shownFile;
  const shownAttachment = shownFile ? attachmentAt(shownFile.bundle, shownFile.path) : null;
  const asking = state.asking;
  const pageTable = state.openPage !== null ? tables[state.active] : undefined;

  return (
    <AdwApplication actionAccels={commands.map((c) => ({ detailedActionName: `win.${c.id}`, accels: [gtkAccelOf(c)] }))}>
      <AdwApplicationWindow
        title="Tables"
        defaultWidth={1280}
        defaultHeight={800}
        // What's still to write is written before the app goes, rather than
        // lost with the delay. If it can't be, the window stays and says
        // why; closing again quits anyway.
        onCloseRequest={() => {
          if (closing.current) return quit();
          closing.current = true;
          void flush().then((written) => {
            if (written) quit();
            else tell("Not everything could be saved", "Close the window again to quit anyway.");
          });
          return true;
        }}
        // Narrow (the web's 760px), the sidebar lays over the content rather than beside it.
        widthRequest={360}
        heightRequest={294}
        breakpoints={
          <AdwBreakpoint
            condition={Adw.BreakpointCondition.parse("max-width: 760sp")}
            onApply={() => {
              setNarrow(true);
              setShownWhileNarrow(false);
            }}
            onUnapply={() => setNarrow(false)}
          />
        }
        actions={[
          ...commands.map((c) => <GSimpleAction key={c.id} name={c.id} enabled={c.enabled ?? true} onActivate={() => run[c.id]?.()} />),
          ...(resetExamples ? [<GSimpleAction key="reset-data" name="reset-data" onActivate={() => setConfirmReset(true)} />] : []),
          <GSimpleAction key="display" name="display" onActivate={() => setDisplayOpen(true)} />,
          <GSimpleAction key="about" name="about" onActivate={() => setAboutOpen(true)} />,
        ]}
      >
        <DisplaySettingsProvider value={shownDisplay}>
          {/* An attachment is a file in its table's attachments/ folder. */}
          <AttachmentsProvider value={(file) => (held ? attachmentPath({ ...tables[state.active]!, path: tableDir(state.active) }, file) : undefined)}>
          <AdwOverlaySplitView
            collapsed={narrow}
            showSidebar={sidebarShown}
            // Laid over the content, it closes when the content is clicked.
            onNotifyShowSidebar={(shown) => {
              if (narrow && !shown && shownWhileNarrow) setShownWhileNarrow(false);
            }}
            minSidebarWidth={220}
            maxSidebarWidth={300}
            sidebar={
              <AdwToolbarView
                topBar={
                  <AdwHeaderBar
                    showEndTitleButtons={false}
                    titleWidget={
                      <GtkBox cssClasses={["linked"]}>
                        <GtkToggleButton label="Tables" active={derived.mode === "tables"} onToggled={(b) => b.getActive() && dispatch({ type: "setFilesSide", files: false })} />
                        <GtkToggleButton label="Files" active={derived.mode === "files"} onToggled={(b) => b.getActive() && dispatch({ type: "setFilesSide", files: true })} />
                      </GtkBox>
                    }
                    start={newFilesIn ? <GtkButton iconName="document-new-symbolic" tooltipText="New .table File" onClicked={() => run["new-file"]?.()} /> : undefined}
                  />
                }
              >
                {derived.mode === "files" ? (
                  <FilesSidebar
                    entries={fileEntries}
                    shown={shownFile}
                    onToggleDir={(id, open) => dispatch({ type: "toggleDir", id, open })}
                    onShowFile={(file) => dispatch({ type: "showFile", file })}
                  />
                ) : (
                  <Sidebar
                    entries={entries}
                    selected={selected}
                    onSelect={(entry) => {
                      if (entry.kind === "table") dispatch({ type: "showTable", key: entry.table.key });
                      if (entry.kind === "view") dispatch({ type: "showView", key: entry.key, viewId: entry.view.id });
                      // Over the content, the sidebar gets out of the way of what was chosen.
                      if (narrow) setShownWhileNarrow(false);
                    }}
                    onNewTable={(bundle) => dispatch({ type: "create", making: { kind: "table", bundle } })}
                    onToggleFile={(bundle) => dispatch({ type: "toggleFile", bundle })}
                  />
                )}
              </AdwToolbarView>
            }
          >
            {derived.mode === "files" && shownFile ? (
              <AttachmentsProvider
                value={(file) => (shownAttachment && tables[shownAttachment.tableKey] ? attachmentPath({ ...tables[shownAttachment.tableKey]!, path: tableDir(shownAttachment.tableKey) }, file) : undefined)}
              >
                <FilePane file={shownFile} text={fileText(tables, bundles, shownFile.bundle, shownFile.path)} attachmentName={shownAttachment?.name} />
              </AttachmentsProvider>
            ) : held ? (
              <TablePane
                // Drawn afresh for each view: its search entry starts empty, as leaving a view clears the search.
                key={`${state.active}#${derived.view.id}`}
                derived={derived}
                tables={tables}
                tableKey={state.active}
                callbacks={callbacks}
                saving={saving}
                onRetrySave={() => void flush()}
                viewActions={viewActions}
                onSearch={(text) => dispatch({ type: "search", text })}
                settingsOpen={state.settingsOpen}
                onSettings={(open) => dispatch({ type: "settings", open })}
                revision={refused}
                navigation={navigation}
                menu={primaryMenu}
                source={indexed.source}
                building={indexed.building}
                reading={indexed.reading}
              />
            ) : (
              <AdwStatusPage title="No tables" description="Name a .table folder on the command line." />
            )}
          </AdwOverlaySplitView>
          {aboutOpen ? (
            // Which build this is (docs/VERSIONING.md): what a person testing it quotes.
            <AdwAboutDialog
              applicationName="Tables"
              applicationIcon="x-office-spreadsheet"
              version={buildLabel()}
              comments="A demo of the .table file format."
              website="https://github.com/workspace-sh/table-file-format"
              onClosed={() => setAboutOpen(false)}
            />
          ) : null}
          {displayOpen ? (
            <AdwDialog title="Display" contentWidth={460} onClosed={() => setDisplayOpen(false)}>
              <AdwToolbarView topBar={<AdwHeaderBar />}>
                <AdwPreferencesPage>
                  <DisplayControls
                    rows={displayChoices(state.display, ownLocale, "System")}
                    onChoose={(kind, value) => dispatch({ type: "display", choice: { kind, value } })}
                  />
                </AdwPreferencesPage>
              </AdwToolbarView>
            </AdwDialog>
          ) : null}
          {state.openPage !== null && pageTable ? (
            <RowPage
              key={`${state.active}#${state.openPage}`}
              rowId={state.openPage}
              rowTitle={rowTitleFor(pageTable, state.openPage)}
              content={pageTable.bodies?.[state.openPage] ?? ""}
              onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
              onClose={() => dispatch({ type: "openPage", rowId: null })}
            />
          ) : null}
          {asking?.kind === "confirm" ? (
            <ConfirmDialog
              prompt={asking.confirm}
              onResponse={(response) => {
                // A settings change refused: its controls are drawn again from the view.
                if (response === "cancel" && asking.on.type === "updateView") setRefused((n) => n + 1);
                dispatch({ type: "answer", response });
              }}
            />
          ) : null}
          {asking?.kind === "name" ? (
            <NameDialog
              prompt={asking.prompt}
              onName={(text) => dispatch({ type: "answer", response: "create", text })}
              onClose={() => dispatch({ type: "answer", response: "cancel" })}
            />
          ) : null}
          {confirmReset ? (
            <ConfirmDialog
              prompt={resetPrompt({ openedFolders: Object.keys(state.opened).length > 0 })}
              onResponse={(response) => {
                setConfirmReset(false);
                if (response === "reset") void reset();
              }}
            />
          ) : null}
          {state.telling ? (
            <AdwAlertDialog
              heading={state.telling.heading}
              body={state.telling.body}
              closeResponse="ok"
              defaultResponse="ok"
              responses={[{ id: "ok", label: "OK" }]}
              onResponse={() => dispatch({ type: "told" })}
            />
          ) : null}
          </AttachmentsProvider>
        </DisplaySettingsProvider>
      </AdwApplicationWindow>
    </AdwApplication>
  );
}
