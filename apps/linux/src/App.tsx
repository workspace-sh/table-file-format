// The .table demo on Linux: the harness for @workspace.sh/table-gtk, as
// apps/web is for table-ui. A navigation sidebar of every table in the open
// `.table` folders, with the open table's views under it, as the web demo's
// sidebar has them. What a view shows comes from table-app's `showView`,
// the same function the web demo calls.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import * as Adw from "@gtkx/gi/adw";
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
import { GtkBox, GtkButton, GtkEntry, GtkImage, GtkLabel, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { quit } from "@gtkx/react";
import {
  attachmentPath,
  bundleOf,
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
  deleteViewPrompt,
  newView,
  withNewFile,
  withNewTable,
  type Made,
  withoutRow,
  withoutView,
  withRow,
  withView,
  withRowAt,
  withViewPatch,
} from "@workspace.sh/table-app";
import { attachFile, saveBundle, type Library } from "@workspace.sh/table-app/node";
import { newId, textDirection, type BundleMeta, type Field, type ParsedTable, type View } from "@workspace.sh/table-core";
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
import { useEffect, useMemo, useRef, useState } from "react";

/** A line of the sidebar: table-app's tree, flattened for a ListBox. */
type Entry = SidebarEntry;

function Sidebar({
  entries,
  selected,
  onSelect,
  onNewTable,
}: {
  entries: Entry[];
  selected: number;
  onSelect: (entry: Entry) => void;
  /** Start a new table in a bundle, as a new sheet in a workbook (D37). */
  onNewTable: (bundle: string) => void;
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
                  <GtkBox marginTop={12} marginStart={6}>
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
}

/** What the header can do to the table's views. */
interface ViewActions {
  onAddView: () => void;
  /** Absent for the table's only view. */
  onDeleteView?: () => void;
}

function TablePane({
  tables,
  bundles,
  tableKey,
  view,
  edits,
  saving,
  viewActions,
}: {
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  tableKey: string;
  view: View;
  edits: Edits;
  saving: SaveState;
  viewActions: ViewActions;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const table = tables[tableKey]!;
  const [search, setSearch] = useState("");
  const shown = showView(tables, tableKey, view, { search });
  const related = useMemo(() => bundleTables(tables, bundleOf(tableKey)), [tables, tableKey]);
  const count = search.trim() ? `${shown.rows.length} of ${shown.inView} matching` : `${shown.rows.length} of ${table.rows.length} rows`;

  return (
    <AdwToolbarView
      topBar={
        <AdwHeaderBar
          titleWidget={
            <AdwWindowTitle
              title={view.name}
              subtitle={`${bundles[bundleOf(tableKey)]?.title ?? bundleOf(tableKey)} › ${table.meta.title ?? tableNameOf(tableKey)}`}
            />
          }
          start={<GtkButton iconName="list-add-symbolic" tooltipText="New View" onClicked={viewActions.onAddView} />}
          end={
            <>
              <GtkButton iconName="emblem-system-symbolic" tooltipText="View Settings" onClicked={() => setSettingsOpen(true)} />
              <SaveStatus state={saving} />
            </>
          }
        />
      }
    >
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={6}>
          <GtkLabel label={count} hexpand xalign={0} cssClasses={["dim-label"]} />
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
          view={view}
          schema={table.schema}
          onChange={edits.onUpdateView}
          onDelete={viewActions.onDeleteView}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </AdwToolbarView>
  );
}

/** The file chooser, for a file to attach. Cancelling is no file. */
async function chooseFileToAttach(): Promise<string | null> {
  try {
    const file = await Gtk.FileDialog.new().open(null, null);
    return file?.getPath() ?? null;
  } catch {
    // Dismissed: the dialog rejects on that as on failure.
    return null;
  }
}

/** Ask for a name: what a new table or file is called. Empty is no name. */
function NameDialog({ heading, action, onName, onClose }: { heading: string; action: string; onName: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <AdwAlertDialog
      heading={heading}
      closeResponse="cancel"
      defaultResponse="create"
      responses={[
        { id: "cancel", label: "Cancel" },
        { id: "create", label: action, appearance: Adw.ResponseAppearance.SUGGESTED },
      ]}
      onResponse={(response) => {
        if (response === "create" && name.trim()) onName(name.trim());
        onClose();
      }}
    >
      <GtkEntry placeholderText="Name" activatesDefault onChanged={(e) => setName(e.getText())} />
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
}) {
  // This viewer's locale, date format and formula syntax: theirs, not the tables'.
  const [display, setDisplay] = useState<DisplaySettings>(() => loadDisplay(settings ?? null));
  const [displayOpen, setDisplayOpen] = useState(false);
  const ownLocale = systemLocale();
  // The layout reads the way the display language does (D40), the whole app
  // included, so dialogs and menus mirror too.
  const direction = textDirection(display.locale ?? ownLocale);
  useEffect(() => {
    Gtk.Widget.setDefaultDirection(direction === "rtl" ? Gtk.TextDirection.RTL : Gtk.TextDirection.LTR);
  }, [direction]);
  const shownDisplay = useMemo(() => ({ ...display, direction }), [display, direction]);
  const [tables, setTables] = useState(library.tables);
  const [bundles, setBundles] = useState(library.bundles);
  // Where each bundle is kept: those opened, and new files, made in `newFilesIn`.
  const [paths, setPaths] = useState(library.paths);
  // A name being asked for: a new table in a bundle, or a new .table file.
  const [naming, setNaming] = useState<{ kind: "table"; bundle: string } | { kind: "file" } | null>(null);
  const [saving, setSaving] = useState<SaveState>({ kind: "saved" });
  const [confirmDelete, setConfirmDelete] = useState<{ key: string; rowId: string } | null>(null);
  const [confirmViewDelete, setConfirmViewDelete] = useState<{ key: string; viewId: string } | null>(null);
  // A row's page open, by table and row.
  const [openPage, setOpenPage] = useState<{ key: string; rowId: string } | null>(null);
  const pageTable = openPage ? tables[openPage.key] : undefined;
  // Bundles edited since they were last written.
  const dirty = useRef(new Set<string>());
  const firstTable = Object.keys(library.bundles).flatMap((b) => tableKeysIn(library.tables, library.bundles, b))[0] ?? "";
  const [active, setActive] = useState(initialTable && library.tables[initialTable] ? initialTable : firstTable);
  const [viewIds, setViewIds] = useState<Record<string, string>>(initialTable && initialView ? { [initialTable]: initialView } : {});
  const table = tables[active];
  const view = table ? (table.views.find((v) => v.id === viewIds[active]) ?? table.views[0]) : undefined;
  // The open table is expanded, its views listed; "+ New table" is on each heading.
  const entries = useMemo(
    () =>
      flattenSidebar(
        sidebarTree(tables, bundles, { expanded: [active], ...(viewIds[active] ? { active: { key: active, viewId: viewIds[active] } } : {}), newTableIn: "none" }),
      ),
    [tables, bundles, active, viewIds],
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
  };
  const create = (title: string) => {
    if (!naming) return;
    if (naming.kind === "table") {
      made(withNewTable(tables, bundles, naming.bundle, title));
    } else if (newFilesIn) {
      const result = withNewFile(tables, bundles, title);
      const bundle = bundleOf(result.key);
      setPaths((prev) => ({ ...prev, [bundle]: `${newFilesIn}/${bundle}.table` }));
      made(result);
    }
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
  const deleting = confirmDelete ? tables[confirmDelete.key] : undefined;

  const viewActions = (key: string, current: View): ViewActions => ({
    // A new view starts as a plain table of everything; its settings are
    // where it's made into what's wanted.
    onAddView: () => {
      const fresh = newView();
      edit(key, (t) => withView(t, fresh));
      setViewIds((prev) => ({ ...prev, [key]: fresh.id }));
    },
    ...((tables[key]?.views.length ?? 0) > 1 ? { onDeleteView: () => setConfirmViewDelete({ key, viewId: current.id }) } : {}),
  });
  const viewPrompt = confirmViewDelete
    ? (() => {
        const v = tables[confirmViewDelete.key]?.views.find((x) => x.id === confirmViewDelete.viewId);
        return v ? deleteViewPrompt(tables, confirmViewDelete.key, v) : null;
      })()
    : null;
  const selected = entries.findIndex((e) => e.kind === "view" && e.key === active && e.view.id === view?.id);

  return (
    <AdwApplication>
      <AdwApplicationWindow title="Tables" defaultWidth={1280} defaultHeight={800} onCloseRequest={() => quit()}>
        <DisplaySettingsProvider value={shownDisplay}>
          {/* An attachment is a file in its table's attachments/ folder. */}
          <AttachmentsProvider value={(file) => (tables[active] ? attachmentPath({ ...tables[active], path: tableDir(active) }, file) : undefined)}>
          <AdwOverlaySplitView
            minSidebarWidth={220}
            maxSidebarWidth={300}
            sidebar={
              <AdwToolbarView
                topBar={
                  <AdwHeaderBar
                    showEndTitleButtons={false}
                    titleWidget={<AdwWindowTitle title="Tables" />}
                    start={<GtkButton iconName="document-new-symbolic" tooltipText="New .table File" onClicked={() => setNaming({ kind: "file" })} />}
                    end={<GtkButton iconName="preferences-desktop-locale-symbolic" tooltipText="Display" onClicked={() => setDisplayOpen(true)} />}
                  />
                }
              >
                <Sidebar
                  entries={entries}
                  selected={selected}
                  onSelect={(entry) => {
                    if (entry.kind === "table") setActive(entry.table.key);
                    if (entry.kind === "view") setViewIds((prev) => ({ ...prev, [entry.key]: entry.view.id }));
                  }}
                  onNewTable={(bundle) => setNaming({ kind: "table", bundle })}
                />
              </AdwToolbarView>
            }
          >
            {table && view ? (
              <TablePane
                key={active}
                tables={tables}
                bundles={bundles}
                tableKey={active}
                view={view}
                edits={edits(active, view.id)}
                saving={saving}
                viewActions={viewActions(active, view)}
              />
            ) : (
              <AdwStatusPage title="No tables" description="Name a .table folder on the command line." />
            )}
          </AdwOverlaySplitView>
          {naming && (naming.kind === "table" || newFilesIn) ? (
            <NameDialog
              heading={naming.kind === "table" ? `New Table in ${bundles[naming.bundle]?.title ?? naming.bundle}` : "New .table File"}
              action="Create"
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
          {confirmViewDelete && viewPrompt ? (
            <AdwAlertDialog
              heading={viewPrompt.heading}
              body={viewPrompt.body}
              closeResponse="cancel"
              defaultResponse="cancel"
              responses={[
                { id: "cancel", label: "Cancel" },
                { id: "delete", label: "Delete", appearance: Adw.ResponseAppearance.DESTRUCTIVE },
              ]}
              onResponse={(response) => {
                if (response === "delete") {
                  const { key, viewId } = confirmViewDelete;
                  edit(key, (t) => withoutView(t, viewId));
                  setViewIds((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                }
                setConfirmViewDelete(null);
              }}
            />
          ) : null}
          {confirmDelete && deleting ? (
            <AdwAlertDialog
              heading={`Delete “${rowTitleFor(deleting, confirmDelete.rowId)}”?`}
              body={
                deleting.bodies?.[confirmDelete.rowId] !== undefined
                  ? "The row and its page are removed from the file."
                  : "The row is removed from the file."
              }
              closeResponse="cancel"
              defaultResponse="cancel"
              responses={[
                { id: "cancel", label: "Cancel" },
                { id: "delete", label: "Delete", appearance: Adw.ResponseAppearance.DESTRUCTIVE },
              ]}
              onResponse={(response) => {
                if (response === "delete") edit(confirmDelete.key, (t) => withoutRow(t, confirmDelete.rowId));
                setConfirmDelete(null);
              }}
            />
          ) : null}
          </AttachmentsProvider>
        </DisplaySettingsProvider>
      </AdwApplicationWindow>
    </AdwApplication>
  );
}
