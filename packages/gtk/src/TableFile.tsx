// A .table opened as a document of its own (a folder, or a .table.zip), for
// an app on Node that opens files: its tables and their views to choose
// between, a search, and the view itself filling what it is given. The same
// state as an app of its own (table-app's useEmbeddedTable), so edits are
// written to the folder, go to its history and can be undone. A .table.zip
// has nowhere to be written, and is to look at.

import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkButton, GtkDropDown, GtkEventControllerKey, GtkLabel, GtkSearchEntry } from "@gtkx/jsx/gtk";
import { bundleOf, bundleTables, tableNameOf, type EmbedRead, type EmbedShown } from "@workspace.sh/table-app";
import { embedFiles, readTableFile } from "@workspace.sh/table-app/node";
import { useEmbeddedTable } from "@workspace.sh/table-app/react";
import { LAYOUT_LABELS } from "@workspace.sh/table-ui/shared";
import { DisplaySettingsProvider } from "@workspace.sh/table-ui/shared";
import { newId } from "@workspace.sh/table-core";
import { useEffect, useState } from "react";

import { LayoutView } from "./LayoutView.js";
import { StringList } from "./StringList.js";
import { TableDialogs } from "./TableDialogs.js";
import { styles } from "./theme.js";
import { useSelected } from "./useSelected.js";
import { ViewSettings } from "./ViewSettings.js";

export interface TableFileProps {
  /** The `.table` folder, or a `.table.zip`. */
  path: string;
  /** To look at only: nothing in it can be changed, and nothing is written. A `.table.zip` always is. */
  readOnly?: boolean;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /** A linked row was clicked: its address, for the app to go to. Absent: a linked row is its name. */
  onOpenLink?: (address: string) => void;
}

function Opened({ shown, readOnly, locale, onOpenLink }: { shown: EmbedShown; readOnly: boolean; locale: string | undefined; onOpenLink: ((address: string) => void) | undefined }) {
  const { state, dispatch, derived, display, tableName, related, callbacks } = useEmbeddedTable(shown, embedFiles, locale);
  const { table, view } = derived;
  // A .table.zip was read into memory: there is nowhere to write it back.
  const fromArchive = shown.library.paths[bundleOf(shown.key)] === undefined;
  const lookOnly = readOnly || fromArchive;

  // The file's tables, and the views of the one on screen.
  const keys = Object.keys(bundleTables(state.tables, bundleOf(state.active))).map((name) => `${bundleOf(state.active)}/${name}`);
  const tableAt = Math.max(0, keys.indexOf(state.active));
  const tablesPicker = useSelected<Gtk.DropDown>(tableAt, keys.join("\u0000"));
  const views = table.views;
  const viewAt = Math.max(0, views.findIndex((v) => v.id === view.id));
  const viewsPicker = useSelected<Gtk.DropDown>(viewAt, views.map((v) => v.id).join("\u0000"));

  // The view's own settings (layout, filters, sorts, grouping), changed for everyone who opens the file.
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
          {fromArchive ? <GtkLabel label="Opened from a .table.zip: changes can’t be saved" cssClasses={["dim-label", "caption"]} /> : null}
          <GtkSearchEntry placeholderText="Search rows" onSearchChanged={(entry) => dispatch({ type: "search", text: entry.getText() })} />
          {lookOnly ? null : (
            <>
              <GtkButton iconName="list-add-symbolic" tooltipText="New View" cssClasses={["flat"]} onClicked={() => dispatch({ type: "addView", id: newId() })} />
              <GtkButton iconName="emblem-system-symbolic" tooltipText="View Settings" cssClasses={["flat"]} onClicked={() => setSettingsOpen(true)} />
            </>
          )}
        </GtkBox>
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
          onOpenRelation={onOpenLink}
        />
      </GtkBox>
      {settingsOpen && !lookOnly ? (
        <ViewSettings
          view={derived.shown.view}
          schema={table.schema}
          onChange={callbacks.onUpdateView}
          {...(views.length > 1 ? { onDelete: () => dispatch({ type: "deleteView" }) } : {})}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <TableDialogs state={state} dispatch={dispatch} table={table} />
    </DisplaySettingsProvider>
  );
}

export function TableFile({ path, readOnly = false, locale, onOpenLink }: TableFileProps) {
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
  if (read?.kind === "shown") return <Opened key={path} shown={read} readOnly={readOnly} locale={locale} onOpenLink={onOpenLink} />;
  if (read?.kind === "problem") {
    return (
      <GtkBox name="table-file-problem" vexpand valign={Gtk.Align.START} marginStart={12} marginEnd={12} marginTop={12} cssClasses={[styles.embedProblem]}>
        <GtkLabel label={read.text} xalign={0} wrap hexpand cssClasses={["dim-label"]} />
      </GtkBox>
    );
  }
  return <GtkBox vexpand />;
}
