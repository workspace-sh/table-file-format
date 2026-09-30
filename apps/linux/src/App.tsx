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
  AdwApplicationWindow,
  AdwDialog,
  AdwPreferencesPage,
  AdwHeaderBar,
  AdwOverlaySplitView,
  AdwSpinner,
  AdwStatusPage,
  AdwToolbarView,
  AdwWindowTitle,
} from "@gtkx/jsx/adw";
import { GtkBox, GtkButton, GtkEntry, GtkImage, GtkLabel, GtkMenuButton, GtkPopoverMenu, GtkToggleButton, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { GMenu, GSimpleAction } from "@gtkx/jsx/gio";
import { quit } from "@gtkx/react";
import {
  appCommands,
  addressLive,
  archiveFileName,
  bundleToArchive,
  firstTableKey,
  fromBundle,
  importSkippedText,
  exportFailedText,
  withFileToggled,
  withFileUnfolded,
  openArchive,
  openFailedText,
  resetPrompt,
  toBundle,
  goBack,
  goForward,
  gtkAccelOf,
  loadSidebarPrefs,
  NO_HISTORY,
  saveSidebarPrefs,
  tableBreadcrumb,
  viewAddress,
  visited,
  type AppCommand,
  type AppCommandId,
  type History,
  type SidebarPrefs,
  attachmentAt,
  attachmentPath,
  bundleOf,
  fileText,
  filesTree,
  flattenFilesTree,
  flattenSidebar,
  sidebarTree,
  type SidebarEntry,
  displayChoices,
  loadDisplay,
  saveDisplay,
  withDisplayChoice,
  type KeyValueStore,
  bundleTables,
  onTable,
  rowTitleFor,
  showView,
  tableKeysIn,
  tableNameOf,
  withBody,
  withCell,
  withChoice,
  withField,
  withFieldMoved,
  withFieldPatch,
  deletingRow,
  deletingView,
  schemaVersions,
  viewPatchPrompt,
  addressTarget,
  arrange,
  forViews,
  isArranged,
  loadArrangements,
  reset as resetArrangement,
  saveArrangements,
  savingForEveryone,
  type Arrangement,
  type Arrangements,
  viewSummary,
  type Confirm,
  newView,
  creating,
  namePrompt,
  type Making,
  type NamePrompt,
  type Made,
  withoutRow,
  withoutView,
  withRow,
  withView,
  withRowAt,
  withViewPatch,
} from "@workspace.sh/table-app";
import { attachFile, attachmentsIn, bundlesIn, loadLibrary, saveBundle, type Library } from "@workspace.sh/table-app/node";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { FilePane, FilesSidebar, type ShownFile } from "./Files.js";
import { newId, textDirection, type TextOrder, type Field, type ParsedTable, type View } from "@workspace.sh/table-core";
import {
  AttachmentsProvider,
  BoardView,
  CalendarView,
  DisplayControls,
  DisplaySettingsProvider,
  type DisplaySettings,
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

/** What the views can ask the app to change, for one table. */
interface Edits {
  onUpdateRow: (rowId: string, field: string, value: unknown) => void;
  onAddRow: () => string;
  onInsertRow: (anchor: string, where: "above" | "below") => void;
  onDeleteRow: (rowId: string) => void;
  onUpdateView: (patch: Partial<View>) => void;
  onUpdateField: (name: string, patch: Partial<Field>) => void;
  onAddEnumValue: (name: string, value: string) => void;
  onMoveField: (name: string, delta: -1 | 1) => void;
  onAddField: (field: Field) => void;
  onOpenBody: (rowId: string) => void;
  onAttachFile: (rowId: string, field: string) => void;
  /** A relation's link followed: its table, its view, its row's page. */
  onOpenRelation: (address: string) => void;
}

/** What the header can do to the table's views. */
interface ViewActions {
  onAddView: () => void;
  /** Absent for the table's only view. */
  onDeleteView?: () => void;
  /** This viewer's own filters, sorts and grouping of the view (D4), and changing them. */
  arrangement: Arrangement | undefined;
  onArrange: (patch: Partial<View>) => void;
  onSaveForEveryone: () => void;
  onReset: () => void;
}

function TablePane({
  tables,
  tableKey,
  view,
  edits,
  saving,
  viewActions,
  openedAt,
  viewerText,
  settingsOpen,
  onSettings,
  subtitle,
  navigation,
  menu,
}: {
  tables: Record<string, ParsedTable>;
  tableKey: string;
  view: View;
  edits: Edits;
  saving: SaveState;
  viewActions: ViewActions;
  /** The table's schema-version when it was opened: "schema changed" is against it (D22). */
  openedAt: number | undefined;
  /** How this viewer's language orders text: a sort only they see follows it. */
  viewerText: TextOrder;
  /** View Settings shown: from its button, or for a view just made. */
  settingsOpen: boolean;
  onSettings: (open: boolean) => void;
  /** Where the view is: its file and table (table-app's tableBreadcrumb). */
  subtitle: string;
  /** Back and forward, at the header's start. */
  navigation: ReactNode;
  /** The primary menu, at the header's end. */
  menu: ReactNode;
}) {
  // A settings change that loses something, asked about first.
  const [asking, setAsking] = useState<{ prompt: Confirm; patch: Partial<View> } | null>(null);
  // Bumped when that's answered Cancel, so the settings show the view as it still is.
  const [refused, setRefused] = useState(0);
  const table = tables[tableKey]!;
  const [search, setSearch] = useState("");
  const shown = showView(tables, tableKey, view, { arrangement: viewActions.arrangement, search, viewerText });
  const related = useMemo(() => bundleTables(tables, bundleOf(tableKey)), [tables, tableKey]);
  const summary = viewSummary(table, { shown: shown.rows.length, inView: shown.inView, searching: search.trim().length > 0, openedAt });

  return (
    <AdwToolbarView
      topBar={
        <AdwHeaderBar
          titleWidget={
            <AdwWindowTitle
              title={view.name}
              subtitle={subtitle}
            />
          }
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
              <SaveStatus state={saving} />
            </>
          }
        />
      }
    >
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={6}>
          <GtkBox spacing={6} hexpand>
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
          <GtkSearchEntry placeholderText="Search rows" onSearchChanged={(entry) => setSearch(entry.getText())} />
        </GtkBox>
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
          {...edits}
        />
      </GtkBox>
      {settingsOpen ? (
        <ViewSettings
          view={shown.view}
          schema={table.schema}
          onChange={(patch) => {
            const prompt = viewPatchPrompt(tables, tableKey, view, patch);
            if (prompt) setAsking({ prompt, patch });
            else edits.onUpdateView(patch);
          }}
          onDelete={viewActions.onDeleteView}
          onArrange={viewActions.onArrange}
          personal={isArranged(viewActions.arrangement)}
          onSaveForEveryone={viewActions.onSaveForEveryone}
          onReset={viewActions.onReset}
          onClose={() => onSettings(false)}
          revision={refused}
        />
      ) : null}
      {asking ? (
        <ConfirmDialog
          prompt={asking.prompt}
          onResponse={(response) => {
            if (response === "stop") edits.onUpdateView(asking.patch);
            else setRefused((n) => n + 1);
            setAsking(null);
          }}
        />
      ) : null}
    </AdwToolbarView>
  );
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

/** Whether the tables on screen are the ones on disk. */
type SaveState = { kind: "saved" } | { kind: "saving" } | { kind: "failed"; message: string };

/**
 * Where the files stand, in the header bar: nothing when they're saved (a
 * document app that saves as you go says nothing when it has), a spinner
 * while writing, and the reason when a write failed.
 */
function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "saved") return null;
  if (state.kind === "saving") return <AdwSpinner widthRequest={16} heightRequest={16} tooltipText="Saving…" />;
  return <GtkImage iconName="dialog-warning-symbolic" cssClasses={["error"]} tooltipText={`Not saved: ${state.message}`} />;
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
}: {
  library: Library;
  initialTable?: string;
  initialView?: string;
  /** Where this viewer's own settings are kept; absent, they last for this run only. */
  settings?: KeyValueStore;
  /** The folder new .table files are made in; absent, none can be made. */
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
  // This viewer's locale, date format and formula syntax: theirs, not the tables'.
  const [display, setDisplay] = useState<DisplaySettings>(() => loadDisplay(settings ?? null));
  const [displayOpen, setDisplayOpen] = useState(false);
  const ownLocale = systemLocale();
  const viewerText = useMemo<TextOrder>(() => new Intl.Collator(display.locale ?? ownLocale, { numeric: true }).compare, [display.locale, ownLocale]);
  // The layout reads the way the display language does (D40), the whole app
  // included, so dialogs and menus mirror too.
  const direction = textDirection(display.locale ?? ownLocale);
  useEffect(() => {
    Gtk.Widget.setDefaultDirection(direction === "rtl" ? Gtk.TextDirection.RTL : Gtk.TextDirection.LTR);
  }, [direction]);
  const shownDisplay = useMemo(() => ({ ...display, direction }), [display, direction]);
  const [tables, setTables] = useState(library.tables);
  // How this viewer has filtered, sorted or grouped each view for
  // themselves (D4), kept with their settings; a deleted view's goes with it.
  const [arrangements, setArrangements] = useState<Arrangements>(() => loadArrangements(settings ?? null));
  useEffect(() => saveArrangements(settings ?? null, forViews(arrangements, tables)), [arrangements, tables, settings]);
  // Each table's schema-version as opened, for "schema changed" (D22).
  const [openedAt] = useState(() => schemaVersions(library.tables));
  const [bundles, setBundles] = useState(library.bundles);
  // Where each bundle is kept: those opened, and new files, made in `newFilesIn`.
  const [paths, setPaths] = useState(library.paths);
  // The sidebar's side (tables and views, or the files on disk), and on the
  // Files side, the folders opened or closed and the file shown.
  // The sidebar: shown or collapsed (Ctrl+B), and its side, kept with this viewer's settings.
  const [sidebarPrefs, setSidebarPrefs] = useState<SidebarPrefs>(() => loadSidebarPrefs(settings ?? null));
  useEffect(() => saveSidebarPrefs(settings ?? null, sidebarPrefs), [sidebarPrefs, settings]);
  const mode: "tables" | "files" = sidebarPrefs.files ? "files" : "tables";
  const setMode = (next: "tables" | "files") => setSidebarPrefs((p) => ({ ...p, files: next === "files" || undefined }));
  const setCollapsed = (collapsed: boolean) => setSidebarPrefs((p) => ({ ...p, collapsed: collapsed || undefined }));
  // Back and forward between the views shown (table-app's history).
  const [history, setHistory] = useState<History>(NO_HISTORY);
  const [openedDirs, setOpenedDirs] = useState<Record<string, boolean>>({});
  const [shownFile, setShownFile] = useState<ShownFile | null>(null);
  // A name being asked for: a new table in a bundle, or a new .table file.
  const [naming, setNaming] = useState<Making | null>(null);
  const [saving, setSaving] = useState<SaveState>({ kind: "saved" });
  // Something to tell, once: what opening a file skipped, or why it couldn't.
  const [notice, setNotice] = useState<{ heading: string; body?: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ key: string; rowId: string } | null>(null);
  const [confirmViewDelete, setConfirmViewDelete] = useState<{ key: string; viewId: string } | null>(null);
  // A row's page open, by table and row.
  const [openPage, setOpenPage] = useState<{ key: string; rowId: string } | null>(null);
  // The open view's settings shown.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pageTable = openPage ? tables[openPage.key] : undefined;
  // Bundles edited since they were last written.
  const dirty = useRef(new Set<string>());
  const firstTable = Object.keys(library.bundles).flatMap((b) => tableKeysIn(library.tables, library.bundles, b))[0] ?? "";
  const [active, setActive] = useState(initialTable && library.tables[initialTable] ? initialTable : firstTable);
  const [viewIds, setViewIds] = useState<Record<string, string>>(initialTable && initialView ? { [initialTable]: initialView } : {});
  // The table on screen is never hidden in a folded file: its file unfolds
  // when it's opened. Folding it again afterwards is still the viewer's.
  useEffect(() => setSidebarPrefs((p) => withFileUnfolded(p, bundleOf(active))), [active]);
  const table = tables[active];
  const view = table ? (table.views.find((v) => v.id === viewIds[active]) ?? table.views[0]) : undefined;
  // The open table is expanded, its views listed; "+ New table" is on each heading.
  const entries = useMemo(
    () =>
      flattenSidebar(
        sidebarTree(tables, bundles, {
          expanded: [active],
          folded: sidebarPrefs.foldedFiles,
          ...(viewIds[active] ? { active: { key: active, viewId: viewIds[active] } } : {}),
          newTableIn: "none",
        }),
      ),
    [tables, bundles, active, viewIds, sidebarPrefs.foldedFiles],
  );

  // Every edit goes through here: the table changes on screen now, and its
  // bundle is written a moment after the last edit.
  const edit = (key: string, change: (t: ParsedTable) => ParsedTable) => {
    setTables((all) => onTable(all, key, change));
    dirty.current.add(bundleOf(key));
  };

  useEffect(() => {
    if (dirty.current.size === 0) return;
    const timer = setTimeout(() => {
      const which = [...dirty.current];
      dirty.current.clear();
      setSaving({ kind: "saving" });
      Promise.all(which.map((b) => saveBundle({ ...library, paths }, tables, bundles, b)))
        .then(() => setSaving({ kind: "saved" }))
        .catch((error: unknown) => {
          which.forEach((b) => dirty.current.add(b));
          setSaving({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tables, bundles, library, paths]);

  // A table's own folder, where its attachments/ is: in its bundle's folder,
  // which a table made in this session hasn't been read from.
  const tableDir = (key: string) => `${paths[bundleOf(key)]}/tables/${tableNameOf(key)}`;

  // Something made (a table, a file): shown at once, and its bundle saved.
  const made = (result: Made) => {
    setTables(result.tables);
    setBundles(result.bundles);
    dirty.current.add(bundleOf(result.key));
    setActive(result.key);
    setViewIds((prev) => ({ ...prev, [result.key]: result.viewId }));
    setOpenPage(null);
  };
  // Nothing is made from an empty name (table-app's creating trims it).
  const create = (typed: string) => {
    if (!naming || (naming.kind === "file" && !newFilesIn)) return;
    const result = creating(tables, bundles, naming, typed);
    if (!result) return;
    if (naming.kind === "file") setPaths((prev) => ({ ...prev, [bundleOf(result.key)]: `${newFilesIn}/${bundleOf(result.key)}.table` }));
    made(result);
  };

  const edits = (key: string, viewId: string): Edits => ({
    onUpdateRow: (rowId, field, value) => edit(key, (t) => withCell(t, rowId, field, value)),
    onAddRow: () => {
      const id = newId();
      edit(key, (t) => withRow(t, id));
      return id;
    },
    onInsertRow: (anchor, where) => edit(key, (t) => withRowAt(t, viewId, anchor, where, newId())),
    onDeleteRow: (rowId) => setConfirmDelete({ key, rowId }),
    onUpdateView: (patch) => edit(key, (t) => withViewPatch(t, viewId, patch)),
    onUpdateField: (name, patch) => edit(key, (t) => withFieldPatch(t, name, patch)),
    onAddEnumValue: (name, value) => edit(key, (t) => withChoice(t, name, value)),
    onMoveField: (name, delta) => edit(key, (t) => withFieldMoved(t, name, delta)),
    onAddField: (field) => edit(key, (t) => withField(t, field, viewId)),
    onOpenBody: (rowId) => setOpenPage({ key, rowId }),
    onOpenRelation: (address) => {
      const target = addressTarget(address, tables, bundles, bundleOf(key));
      if (!target) return;
      setActive(target.key);
      if (target.viewId) setViewIds((prev) => ({ ...prev, [target.key]: target.viewId! }));
      setOpenPage(target.openBody ? { key: target.key, rowId: target.openBody } : null);
    },
    // The file is copied into the table's attachments/ and the cell set to its name.
    onAttachFile: (rowId, field) => {
      void chooseFile().then((source) => {
        if (!source) return;
        try {
          const name = attachFile(tableDir(key), source);
          edit(key, (t) => withCell(t, rowId, field, name));
        } catch (error) {
          setSaving({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  });
  // What deleting asks, and what it closes or shows after: table-app's, as the web's and macOS's.
  const deleting = confirmDelete && tables[confirmDelete.key] ? deletingRow(tables[confirmDelete.key]!, confirmDelete.rowId, openPage?.key === confirmDelete.key ? openPage.rowId : null) : null;

  const viewActions = (key: string, current: View): ViewActions => ({
    // A new view starts as a plain table of everything; its settings are
    // where it's made into what's wanted.
    onAddView: () => {
      const fresh = newView();
      edit(key, (t) => withView(t, fresh));
      setViewIds((prev) => ({ ...prev, [key]: fresh.id }));
      // Its settings open, as on the web: that's where it's made into what's wanted.
      setSettingsOpen(true);
    },
    ...((tables[key]?.views.length ?? 0) > 1 ? { onDeleteView: () => setConfirmViewDelete({ key, viewId: current.id }) } : {}),
    arrangement: arrangements[key]?.[current.id],
    onArrange: (patch) => setArrangements((all) => arrange(all, key, current.id, patch)),
    onSaveForEveryone: () => {
      const saving = savingForEveryone(arrangements, key, current.id);
      edit(key, (t) => withViewPatch(t, current.id, saving.patch));
      setArrangements(saving.arrangements);
    },
    onReset: () => setArrangements((all) => resetArrangement(all, key, current.id)),
  });
  const viewDeleting = confirmViewDelete
    ? (() => {
        const v = tables[confirmViewDelete.key]?.views.find((x) => x.id === confirmViewDelete.viewId);
        return v ? deletingView(tables, confirmViewDelete.key, v) : null;
      })()
    : null;
  // Each view shown is recorded; going back or forward skips any since deleted.
  const here = view ? viewAddress(active, view.id) : null;

  useEffect(() => {
    if (here) setHistory((h) => visited(h, here));
  }, [here]);
  const live = (address: string) => addressLive(address, tables, bundles);
  const go = (moved: { history: History; address: string } | null) => {
    if (!moved) return;
    const target = addressTarget(moved.address, tables, bundles, bundleOf(active));
    if (!target) return;
    setHistory(moved.history);
    setActive(target.key);
    if (target.viewId) setViewIds((prev) => ({ ...prev, [target.key]: target.viewId! }));
    // History is of views: a page open is left behind.
    setOpenPage(null);
    setMode("tables");
  };
  const back = goBack(history, live);
  const forward = goForward(history, live);

  // What's made or opened shows at once, on the Tables side.
  const show = (key: string | undefined) => {
    if (!key) return;
    setActive(key);
    setMode("tables");
    setOpenPage(null);
  };
  // A .table folder from disk, edited where it is.
  const openFolder = async () => {
    const path = await chooseFolder();
    if (!path) return;
    const opened = await loadLibrary([path], Object.keys(bundles));
    const key = Object.keys(opened.bundles)[0];
    const problems = Object.values(opened.problems).flat();
    if (!key || Object.keys(opened.tables).length === 0) {
      setNotice({ heading: openFailedText(basename(path), problems.join("; ") || "there's no table in it") });
      return;
    }
    setTables((all) => ({ ...all, ...opened.tables }));
    setBundles((all) => ({ ...all, ...opened.bundles }));
    setPaths((all) => ({ ...all, ...opened.paths }));
    show(firstTableKey(opened.tables));
    if (problems.length > 0) setNotice({ heading: `Opened ${basename(path)}, with problems:`, body: problems.join("\n") });
  };
  // A .table.zip becomes a .table folder beside the new files, saved as it opens.
  const openZip = async () => {
    const path = await chooseZip();
    if (!path || !newFilesIn) return;
    try {
      // Named apart from the tables held and from any folder already there.
      const onDisk = bundlesIn(newFilesIn).map((folder) => basename(folder).replace(/\.table$/, ""));
      const opened = await openArchive(new Uint8Array(readFileSync(path)), [...Object.keys(bundles), ...onDisk]);
      const entries = fromBundle(opened.key, opened.bundle);
      setTables((all) => ({ ...all, ...entries }));
      setBundles((all) => ({ ...all, [opened.key]: opened.bundle.meta }));
      setPaths((all) => ({ ...all, [opened.key]: `${newFilesIn}/${opened.key}.table` }));
      dirty.current.add(opened.key);
      show(Object.keys(entries)[0]);
      const skipped = importSkippedText(opened);
      if (skipped) setNotice(skipped);
    } catch (error) {
      setNotice({ heading: openFailedText(basename(path), error) });
    }
  };
  // The open table's .table, every table in it, as one .table.zip.
  const exportZip = async () => {
    const key = bundleOf(active);
    const path = await chooseZipSaveAs(archiveFileName(key));
    if (!path) return;
    try {
      writeFileSync(path, await bundleToArchive(key, toBundle(tables, bundles, key)));
    } catch (error) {
      setNotice({ heading: exportFailedText(basename(path), error) });
    }
  };
  // The examples as they shipped; folders opened from elsewhere are left as they are.
  const inExamples = (key: string) => !!newFilesIn && (paths[key] ?? "").startsWith(`${newFilesIn}/`);
  const reset = async () => {
    if (!resetExamples) return;
    const kept = Object.keys(bundles).filter((key) => !inExamples(key));
    for (const key of Object.keys(bundles)) if (!kept.includes(key)) dirty.current.delete(key);
    const fresh = await resetExamples(kept);
    const keep = <T,>(all: Record<string, T>, keyOf: (k: string) => string) => Object.fromEntries(Object.entries(all).filter(([k]) => kept.includes(keyOf(k))));
    setTables((all) => ({ ...keep(all, bundleOf), ...fresh.tables }));
    setBundles((all) => ({ ...keep(all, (k) => k), ...fresh.bundles }));
    setPaths((all) => ({ ...keep(all, (k) => k), ...fresh.paths }));
    setViewIds({});
    setHistory(NO_HISTORY);
    setShownFile(null);
    show(firstTableKey(fresh.tables));
  };

  // The app's commands (table-app's appCommands), each an action on the
  // window with its accelerator, and in the primary menu. Those Linux
  // doesn't do yet are left out.
  const run: Partial<Record<AppCommandId, () => void>> = {
    ...(newFilesIn ? { "new-file": () => setNaming({ kind: "file" }), "open-zip": () => void openZip() } : {}),
    "open-folder": () => void openFolder(),
    "export-zip": () => void exportZip(),
    "copy-link": () => {
      if (!view) return;
      // With the open page's row, as the web's address and the Mac's link have it.
      const link = viewAddress(active, view.id, openPage?.key === active ? openPage.rowId : undefined);
      Gdk.Display.getDefault()?.getClipboard().setContent(Gdk.ContentProvider.newForValue(link));
    },
    "tables-mode": () => setMode("tables"),
    "files-mode": () => setMode("files"),
    "toggle-sidebar": () => setCollapsed(!sidebarPrefs.collapsed),
    "go-back": () => go(back),
    "go-forward": () => go(forward),
  };
  const commands: AppCommand[] = appCommands({
    sidebarCollapsed: sidebarPrefs.collapsed === true,
    filesMode: mode === "files",
    canGoBack: back !== null,
    canGoForward: forward !== null,
  }).filter((c) => run[c.id]);
  const menuSections = ["File", "Edit", "View", "Go"].map((menu) => ({
    section: commands.filter((c) => c.menu === menu).map((c) => ({ label: c.label, action: `win.${c.id}` })),
  })).filter((s) => s.section.length > 0);
  if (resetExamples) menuSections.push({ section: [{ label: "Reset Demo Data…", action: "win.reset-data" }] });
  const primaryMenu = (
    <GtkMenuButton iconName="open-menu-symbolic" tooltipText="Main Menu" primary popover={<GtkPopoverMenu menuModel={<GMenu items={menuSections} />} />} />
  );
  const navigation = (
    <GtkBox cssClasses={["linked"]}>
      <GtkButton iconName="go-previous-symbolic" tooltipText="Back" sensitive={back !== null} onClicked={() => go(back)} />
      <GtkButton iconName="go-next-symbolic" tooltipText="Forward" sensitive={forward !== null} onClicked={() => go(forward)} />
    </GtkBox>
  );

  const selected = entries.findIndex((e) => e.kind === "view" && e.key === active && e.view.id === view?.id);
  const fileEntries = useMemo(
    () =>
      mode === "files"
        ? flattenFilesTree(
            filesTree(tables, bundles, {
              activeTable: active,
              opened: openedDirs,
              attachmentsOf: (key) => (paths[bundleOf(key)] ? attachmentsIn(tableDir(key)) : []),
            }),
          )
        : [],
    // tableDir reads `paths`, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, tables, bundles, active, openedDirs, paths],
  );
  const shownAttachment = shownFile ? attachmentAt(shownFile.bundle, shownFile.path) : null;

  return (
    <AdwApplication actionAccels={commands.map((c) => ({ detailedActionName: `win.${c.id}`, accels: [gtkAccelOf(c)] }))}>
      <AdwApplicationWindow
        title="Tables"
        defaultWidth={1280}
        defaultHeight={800}
        onCloseRequest={() => quit()}
        actions={[
          ...commands.map((c) => <GSimpleAction key={c.id} name={c.id} enabled={c.enabled ?? true} onActivate={() => run[c.id]?.()} />),
          ...(resetExamples ? [<GSimpleAction key="reset-data" name="reset-data" onActivate={() => setConfirmReset(true)} />] : []),
        ]}
      >
        <DisplaySettingsProvider value={shownDisplay}>
          {/* An attachment is a file in its table's attachments/ folder. */}
          <AttachmentsProvider value={(file) => (tables[active] ? attachmentPath({ ...tables[active], path: tableDir(active) }, file) : undefined)}>
          <AdwOverlaySplitView
            showSidebar={sidebarPrefs.collapsed !== true}
            minSidebarWidth={220}
            maxSidebarWidth={300}
            sidebar={
              <AdwToolbarView
                topBar={
                  <AdwHeaderBar
                    showEndTitleButtons={false}
                    titleWidget={
                      <GtkBox cssClasses={["linked"]}>
                        <GtkToggleButton label="Tables" active={mode === "tables"} onToggled={(b) => b.getActive() && setMode("tables")} />
                        <GtkToggleButton label="Files" active={mode === "files"} onToggled={(b) => b.getActive() && setMode("files")} />
                      </GtkBox>
                    }
                    start={<GtkButton iconName="document-new-symbolic" tooltipText="New .table File" onClicked={() => setNaming({ kind: "file" })} />}
                    end={<GtkButton iconName="preferences-desktop-locale-symbolic" tooltipText="Display" onClicked={() => setDisplayOpen(true)} />}
                  />
                }
              >
                {mode === "files" ? (
                  <FilesSidebar
                    entries={fileEntries}
                    shown={shownFile}
                    onToggleDir={(id, open) => setOpenedDirs((prev) => ({ ...prev, [id]: open }))}
                    onShowFile={setShownFile}
                  />
                ) : (
                <Sidebar
                  entries={entries}
                  selected={selected}
                  onSelect={(entry) => {
                    if (entry.kind === "table") setActive(entry.table.key);
                    if (entry.kind === "view") setViewIds((prev) => ({ ...prev, [entry.key]: entry.view.id }));
                  }}
                  onNewTable={(bundle) => setNaming({ kind: "table", bundle })}
                  onToggleFile={(bundle) => setSidebarPrefs((p) => withFileToggled(p, bundle))}
                />
                )}
              </AdwToolbarView>
            }
          >
            {mode === "files" && shownFile ? (
              <AttachmentsProvider
                value={(file) => (shownAttachment && tables[shownAttachment.tableKey] ? attachmentPath({ ...tables[shownAttachment.tableKey]!, path: tableDir(shownAttachment.tableKey) }, file) : undefined)}
              >
                <FilePane file={shownFile} text={fileText(tables, bundles, shownFile.bundle, shownFile.path)} attachmentName={shownAttachment?.name} />
              </AttachmentsProvider>
            ) : table && view ? (
              <TablePane
                // Drawn afresh for each view, so leaving one (table-app's
                // leaving) takes its search and its open settings with it.
                key={`${active}#${view.id}`}
                tables={tables}
                tableKey={active}
                view={view}
                edits={edits(active, view.id)}
                saving={saving}
                viewActions={viewActions(active, view)}
                openedAt={openedAt[active]}
                viewerText={viewerText}
                settingsOpen={settingsOpen}
                onSettings={setSettingsOpen}
                subtitle={tableBreadcrumb(active, tables, bundles, paths[bundleOf(active)]?.split("/").pop()).text}
                navigation={navigation}
                menu={primaryMenu}
              />
            ) : (
              <AdwStatusPage title="No tables" description="Name a .table folder on the command line." />
            )}
          </AdwOverlaySplitView>
          {naming && (naming.kind === "table" || newFilesIn) ? (
            <NameDialog
              prompt={namePrompt(naming, bundles)}
              onName={create}
              onClose={() => setNaming(null)}
            />
          ) : null}
          {displayOpen ? (
            <AdwDialog title="Display" contentWidth={460} onClosed={() => setDisplayOpen(false)}>
              <AdwToolbarView topBar={<AdwHeaderBar />}>
                <AdwPreferencesPage>
                  <DisplayControls
                    rows={displayChoices(display, ownLocale, "System")}
                    onChoose={(kind, value) => {
                      const next = withDisplayChoice(display, kind, value);
                      setDisplay(next);
                      if (settings) saveDisplay(settings, next);
                    }}
                  />
                </AdwPreferencesPage>
              </AdwToolbarView>
            </AdwDialog>
          ) : null}
          {openPage && pageTable ? (
            <RowPage
              key={`${openPage.key}#${openPage.rowId}`}
              rowId={openPage.rowId}
              rowTitle={rowTitleFor(pageTable, openPage.rowId)}
              content={pageTable.bodies?.[openPage.rowId] ?? ""}
              onSave={(content) => edit(openPage.key, (t) => withBody(t, openPage.rowId, content))}
              onClose={() => setOpenPage(null)}
            />
          ) : null}
          {confirmViewDelete && viewDeleting ? (
            <ConfirmDialog
              prompt={viewDeleting.prompt}
              onResponse={(response) => {
                if (response === "delete") {
                  const { key, viewId } = confirmViewDelete;
                  edit(key, (t) => withoutView(t, viewId));
                  setViewIds((prev) => ({ ...prev, [key]: viewDeleting.nextViewId }));
                  setSettingsOpen(false);
                }
                setConfirmViewDelete(null);
              }}
            />
          ) : null}
          {confirmDelete && deleting ? (
            <ConfirmDialog
              prompt={deleting.prompt}
              onResponse={(response) => {
                if (response === "delete") {
                  edit(confirmDelete.key, (t) => withoutRow(t, confirmDelete.rowId));
                  // Its page goes with it: saving it after would write a page for no row.
                  if (deleting.closeBody) setOpenPage(null);
                }
                setConfirmDelete(null);
              }}
            />
          ) : null}
          {confirmReset ? (
            <ConfirmDialog
              prompt={resetPrompt({ openedFolders: Object.keys(bundles).some((key) => !inExamples(key)) })}
              onResponse={(response) => {
                setConfirmReset(false);
                if (response === "reset") void reset();
              }}
            />
          ) : null}
          {notice ? (
            <AdwAlertDialog
              heading={notice.heading}
              body={notice.body}
              closeResponse="ok"
              defaultResponse="ok"
              responses={[{ id: "ok", label: "OK" }]}
              onResponse={() => setNotice(null)}
            />
          ) : null}
          </AttachmentsProvider>
        </DisplaySettingsProvider>
      </AdwApplicationWindow>
    </AdwApplication>
  );
}
