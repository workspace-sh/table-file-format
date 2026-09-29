// The .table demo on Linux: the harness for @workspace.sh/table-gtk, as
// apps/web is for table-ui. A navigation sidebar of every table in the open
// `.table` folders, with the open table's views under it, as the web demo's
// sidebar has them. What a view shows comes from table-app's `showView`,
// the same function the web demo calls.

import * as Gtk from "@gtkx/gi/gtk";
import * as Pango from "@gtkx/gi/pango";
import {
  AdwApplication,
  AdwApplicationWindow,
  AdwHeaderBar,
  AdwOverlaySplitView,
  AdwStatusPage,
  AdwToolbarView,
  AdwWindowTitle,
} from "@gtkx/jsx/adw";
import { GtkBox, GtkLabel, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { quit } from "@gtkx/react";
import { bundleOf, bundleTables, showView, tableKeysIn, tableNameOf } from "@workspace.sh/table-app";
import type { Library } from "@workspace.sh/table-app/node";
import type { View } from "@workspace.sh/table-core";
import {
  BoardView,
  CalendarView,
  DisplaySettingsProvider,
  GalleryView,
  ListView,
  TableView,
  type ViewProps,
} from "@workspace.sh/table-gtk";
import { useMemo, useState } from "react";

const LAYOUT_NAMES: Record<View["layout"], string> = {
  table: "Table",
  board: "Board",
  gallery: "Gallery",
  list: "List",
  calendar: "Calendar",
};

type Entry =
  | { kind: "bundle"; bundle: string; title: string }
  | { kind: "table"; key: string; title: string }
  | { kind: "view"; key: string; view: View };

/**
 * The sidebar's rows: each bundle's heading, then its tables in manifest
 * order, and under the open table its views.
 */
function sidebarEntries(library: Library, active: string): Entry[] {
  return Object.keys(library.bundles).flatMap((bundle) => [
    { kind: "bundle" as const, bundle, title: library.bundles[bundle]?.title ?? bundle },
    ...tableKeysIn(library.tables, library.bundles, bundle).flatMap((key): Entry[] => {
      const table = library.tables[key]!;
      const row: Entry = { kind: "table", key, title: table.meta.title ?? tableNameOf(key) };
      return key === active ? [row, ...table.views.map((view): Entry => ({ kind: "view", key, view }))] : [row];
    }),
  ]);
}

function Sidebar({ entries, selected, onSelect }: { entries: Entry[]; selected: number; onSelect: (entry: Entry) => void }) {
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
                <GtkListBoxRow key={`b:${entry.bundle}`} selectable={false} activatable={false}>
                  <GtkLabel label={entry.title} xalign={0} cssClasses={["heading", "dim-label"]} marginTop={12} marginStart={6} />
                </GtkListBoxRow>
              );
            case "table":
              return (
                <GtkListBoxRow key={`t:${entry.key}`}>
                  <GtkLabel label={entry.title} xalign={0} marginStart={6} />
                </GtkListBoxRow>
              );
            case "view":
              return (
                <GtkListBoxRow key={`v:${entry.key}#${entry.view.id}`}>
                  <GtkBox spacing={6} marginStart={22}>
                    <GtkLabel label={entry.view.name} xalign={0} hexpand ellipsize={Pango.EllipsizeMode.END} maxWidthChars={1} />
                    <GtkLabel label={LAYOUT_NAMES[entry.view.layout]} cssClasses={["caption", "dim-label"]} />
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

function TablePane({ library, tableKey, view }: { library: Library; tableKey: string; view: View }) {
  const table = library.tables[tableKey]!;
  const [search, setSearch] = useState("");
  const shown = showView(library.tables, tableKey, view, { search });
  const related = useMemo(() => bundleTables(library.tables, bundleOf(tableKey)), [library, tableKey]);
  const count = search.trim() ? `${shown.rows.length} of ${shown.inView} matching` : `${shown.rows.length} of ${table.rows.length} rows`;

  return (
    <AdwToolbarView
      topBar={
        <AdwHeaderBar
          titleWidget={
            <AdwWindowTitle
              title={view.name}
              subtitle={`${library.bundles[bundleOf(tableKey)]?.title ?? bundleOf(tableKey)} › ${table.meta.title ?? tableNameOf(tableKey)}`}
            />
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
        />
      </GtkBox>
    </AdwToolbarView>
  );
}

export function App({ library, initialTable, initialView }: { library: Library; initialTable?: string; initialView?: string }) {
  const firstTable = Object.keys(library.bundles).flatMap((b) => tableKeysIn(library.tables, library.bundles, b))[0] ?? "";
  const [active, setActive] = useState(initialTable && library.tables[initialTable] ? initialTable : firstTable);
  const [viewIds, setViewIds] = useState<Record<string, string>>(initialTable && initialView ? { [initialTable]: initialView } : {});
  const table = library.tables[active];
  const view = table ? (table.views.find((v) => v.id === viewIds[active]) ?? table.views[0]) : undefined;
  const entries = useMemo(() => sidebarEntries(library, active), [library, active]);
  const selected = entries.findIndex((e) => e.kind === "view" && e.key === active && e.view.id === view?.id);

  return (
    <AdwApplication>
      <AdwApplicationWindow title="Tables" defaultWidth={1280} defaultHeight={800} onCloseRequest={() => quit()}>
        <DisplaySettingsProvider value={{}}>
          <AdwOverlaySplitView
            minSidebarWidth={220}
            maxSidebarWidth={300}
            sidebar={
              <AdwToolbarView topBar={<AdwHeaderBar showEndTitleButtons={false} titleWidget={<AdwWindowTitle title="Tables" />} />}>
                <Sidebar
                  entries={entries}
                  selected={selected}
                  onSelect={(entry) => {
                    if (entry.kind === "table") setActive(entry.key);
                    if (entry.kind === "view") setViewIds((prev) => ({ ...prev, [entry.key]: entry.view.id }));
                  }}
                />
              </AdwToolbarView>
            }
          >
            {table && view ? (
              <TablePane key={active} library={library} tableKey={active} view={view} />
            ) : (
              <AdwStatusPage title="No tables" description="Name a .table folder on the command line." />
            )}
          </AdwOverlaySplitView>
        </DisplaySettingsProvider>
      </AdwApplicationWindow>
    </AdwApplication>
  );
}
