// The .table demo on Linux: the harness for @workspace.sh/table-gtk, as
// apps/web is for table-ui. A sidebar of every table in the open `.table`
// folders, and the chosen table's views. What a view shows comes from
// table-app's `showView`, the same function the web demo calls.

import * as Gtk from "@gtkx/gi/gtk";
import {
  AdwApplication,
  AdwApplicationWindow,
  AdwHeaderBar,
  AdwOverlaySplitView,
  AdwStatusPage,
  AdwToolbarView,
  AdwWindowTitle,
} from "@gtkx/jsx/adw";
import { GtkBox, GtkLabel, GtkListBox, GtkListBoxRow, GtkScrolledWindow, GtkSearchEntry, GtkToggleButton } from "@gtkx/jsx/gtk";
import { quit } from "@gtkx/react";
import { bundleOf, bundleTables, showView, tableKeysIn } from "@workspace.sh/table-app";
import type { Library } from "@workspace.sh/table-app/node";
import { DisplaySettingsProvider, TableView } from "@workspace.sh/table-gtk";
import type { View } from "@workspace.sh/table-core";
import { useMemo, useState } from "react";

const LAYOUT_NAMES: Record<View["layout"], string> = {
  table: "Table",
  board: "Board",
  gallery: "Gallery",
  list: "List",
  calendar: "Calendar",
};

type Entry = { kind: "bundle"; bundle: string; title: string } | { kind: "table"; key: string; title: string };

/** The sidebar's rows: each bundle's heading, then its tables in manifest order. */
function sidebarEntries(library: Library): Entry[] {
  return Object.keys(library.bundles).flatMap((bundle) => [
    { kind: "bundle" as const, bundle, title: library.bundles[bundle]?.title ?? bundle },
    ...tableKeysIn(library.tables, library.bundles, bundle).map((key) => ({
      kind: "table" as const,
      key,
      title: library.tables[key]?.meta.title ?? key.slice(key.indexOf("/") + 1),
    })),
  ]);
}

function Sidebar({ entries, active, onSelect }: { entries: Entry[]; active: string; onSelect: (key: string) => void }) {
  return (
    <GtkScrolledWindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
      <GtkListBox
        cssClasses={["navigation-sidebar"]}
        selectionMode={Gtk.SelectionMode.SINGLE}
        selectedIndex={entries.findIndex((e) => e.kind === "table" && e.key === active)}
        onRowSelected={(row) => {
          const entry = row === null ? undefined : entries[row.getIndex()];
          if (entry?.kind === "table" && entry.key !== active) onSelect(entry.key);
        }}
      >
        {entries.map((entry) =>
          entry.kind === "bundle" ? (
            <GtkListBoxRow key={`b:${entry.bundle}`} selectable={false} activatable={false}>
              <GtkLabel label={entry.title} xalign={0} cssClasses={["heading", "dim-label"]} marginTop={12} marginStart={6} />
            </GtkListBoxRow>
          ) : (
            <GtkListBoxRow key={`t:${entry.key}`}>
              <GtkLabel label={entry.title} xalign={0} marginStart={6} />
            </GtkListBoxRow>
          ),
        )}
      </GtkListBox>
    </GtkScrolledWindow>
  );
}

function ViewSwitcher({ views, active, onSelect }: { views: View[]; active: string; onSelect: (id: string) => void }) {
  return (
    <GtkBox cssClasses={["linked"]}>
      {views.map((v) => (
        <GtkToggleButton
          key={v.id}
          label={v.name}
          tooltipText={LAYOUT_NAMES[v.layout]}
          active={v.id === active}
          onToggled={(button) => {
            if (button.getActive() && v.id !== active) onSelect(v.id);
          }}
        />
      ))}
    </GtkBox>
  );
}

function TablePane({ library, tableKey, initialView }: { library: Library; tableKey: string; initialView?: string }) {
  const table = library.tables[tableKey]!;
  const [viewIds, setViewIds] = useState<Record<string, string>>(initialView ? { [tableKey]: initialView } : {});
  const [search, setSearch] = useState("");
  const view = table.views.find((v) => v.id === viewIds[tableKey]) ?? table.views[0]!;
  const shown = showView(library.tables, tableKey, view, { search });
  const related = useMemo(() => bundleTables(library.tables, bundleOf(tableKey)), [library, tableKey]);
  const count = search.trim() ? `${shown.rows.length} of ${shown.inView} matching` : `${shown.rows.length} of ${table.rows.length} rows`;

  return (
    <AdwToolbarView
      topBar={
        <AdwHeaderBar
          titleWidget={
            <AdwWindowTitle
              title={table.meta.title ?? tableKey}
              subtitle={library.bundles[bundleOf(tableKey)]?.title ?? bundleOf(tableKey)}
            />
          }
        />
      }
    >
      <GtkBox orientation={Gtk.Orientation.VERTICAL}>
        <GtkBox spacing={12} marginStart={12} marginEnd={12} marginTop={6} marginBottom={6}>
          <ViewSwitcher
            views={table.views}
            active={view.id}
            onSelect={(id) => setViewIds((prev) => ({ ...prev, [tableKey]: id }))}
          />
          <GtkLabel label={count} hexpand xalign={0} cssClasses={["dim-label"]} />
          <GtkSearchEntry placeholderText="Search rows" onSearchChanged={(entry) => setSearch(entry.getText())} />
        </GtkBox>
        {view.layout === "table" ? (
          <TableView
            view={shown.view}
            rows={shown.rows}
            schema={table.schema}
            bodies={table.bodies}
            relatedTables={related}
            allRows={table.rows}
            tableKey={tableKey.slice(tableKey.indexOf("/") + 1)}
            sheet={shown.sheet}
          />
        ) : (
          <AdwStatusPage
            vexpand
            iconName="view-grid-symbolic"
            title={`${LAYOUT_NAMES[view.layout]} views are next`}
            description="table-gtk draws tables so far. Board, list, gallery and calendar come in the next step."
          />
        )}
      </GtkBox>
    </AdwToolbarView>
  );
}

export function App({ library, initialTable, initialView }: { library: Library; initialTable?: string; initialView?: string }) {
  const entries = useMemo(() => sidebarEntries(library), [library]);
  const first = entries.find((e) => e.kind === "table");
  const [active, setActive] = useState(
    initialTable && library.tables[initialTable] ? initialTable : first?.kind === "table" ? first.key : "",
  );

  return (
    <AdwApplication>
      <AdwApplicationWindow title="Tables" defaultWidth={1280} defaultHeight={800} onCloseRequest={() => quit()}>
        <DisplaySettingsProvider value={{}}>
          <AdwOverlaySplitView
            minSidebarWidth={200}
            maxSidebarWidth={280}
            sidebar={
              <AdwToolbarView topBar={<AdwHeaderBar showEndTitleButtons={false} titleWidget={<AdwWindowTitle title="Tables" />} />}>
                <Sidebar entries={entries} active={active} onSelect={setActive} />
              </AdwToolbarView>
            }
          >
            {active && library.tables[active] ? (
              <TablePane key={active} library={library} tableKey={active} initialView={active === initialTable ? initialView : undefined} />
            ) : (
              <AdwStatusPage title="No tables" description="Name a .table folder on the command line." />
            )}
          </AdwOverlaySplitView>
        </DisplaySettingsProvider>
      </AdwApplicationWindow>
    </AdwApplication>
  );
}
