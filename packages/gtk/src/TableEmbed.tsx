// A `.table` drawn inside something else: a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). It is
// the table itself, not a picture of it: the same views an app of its own
// shows, over the same state (table-app's reducer), so a cell edited here
// is written to the file, goes to its history, and can be undone. It is as
// tall as what it holds up to a limit, with the link's caption beneath.
// What can't be drawn says why, in the table's place.

import * as Adw from "@gtkx/gi/adw";
import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { AdwAlertDialog } from "@gtkx/jsx/adw";
import { GtkBox, GtkEventControllerKey, GtkLabel } from "@gtkx/jsx/gtk";
import { bundleOf, rowTitleFor, type EmbedRead, type EmbedShown } from "@workspace.sh/table-app";
import { embedFiles, readEmbed, type EmbedTarget } from "@workspace.sh/table-app/node";
import { useEmbeddedTable } from "@workspace.sh/table-app/react";
import { DisplaySettingsProvider } from "@workspace.sh/table-ui/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmbeddedContext } from "./embedded.js";
import { LayoutView } from "./LayoutView.js";
import { RowPage } from "./RowPage.js";
import { styles } from "./theme.js";

/** The tallest an embedded view is before it scrolls within itself. */
export const EMBED_MAX_HEIGHT = 480;

export interface TableEmbedProps extends EmbedTarget {
  /** Shown beneath: the link's title. */
  caption?: string;
  /** The tallest the view is, in pixels; past it, it scrolls within itself. */
  maxHeight?: number;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /** The table is to look at: nothing in it can be changed, and nothing is written. For a reader who can't write where it is. */
  readOnly?: boolean;
  /**
   * A linked row was clicked: its address (`projects.table#table=projects&row=p2`),
   * for the app to go to. Absent: a linked row is its name, and goes nowhere.
   */
  onOpenLink?: (address: string) => void;
}

/** The table, held and edited as an app of its own holds it (table-app's useEmbeddedTable), and written where it was read from. */
function Shown({
  shown,
  maxHeight,
  locale,
  readOnly,
  onOpenLink,
}: {
  shown: EmbedShown;
  maxHeight: number;
  locale: string | undefined;
  readOnly: boolean;
  onOpenLink: ((address: string) => void) | undefined;
}) {
  const { state, dispatch, derived, display, tableName, related, callbacks } = useEmbeddedTable(shown, embedFiles, locale);
  const { table } = derived;
  // How much to show at once: the link's own count of rows or cards, else the limit.
  const { rows, cards } = shown.size;
  const embedded = useMemo(() => ({ maxHeight, rows, cards }), [maxHeight, rows, cards]);
  // What holds the table (a document's text) gives it the least height it asks for, and a
  // scroller asks for almost none: so the height it would like (its rows, up to the limit)
  // is asked for outright, and again whenever what it holds grows or shrinks.
  const frame = useRef<Gtk.Box | null>(null);
  const [height, setHeight] = useState(-1);
  const fit = () => {
    const scroller = frame.current?.getFirstChild();
    if (!scroller) return;
    const [, natural] = scroller.measure(Gtk.Orientation.VERTICAL, scroller.getWidth() > 0 ? scroller.getWidth() : -1);
    // (No taller than the limit, or than the rows or cards the link asked for: the scroller's own.)
    setHeight(natural);
  };
  useEffect(fit);
  useEffect(() => {
    const scroller = frame.current?.getFirstChild();
    const down = scroller instanceof Gtk.ScrolledWindow ? scroller.getVadjustment() : null;
    if (!down) return;
    const changed = () => fit();
    down.on("changed", changed);
    return () => {
      down.off("changed", changed);
    };
    // A view of another layout is another scroller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.view.layout, maxHeight]);
  const asking = state.asking;
  const undoKeys = (keyval: number, mods: Gdk.ModifierType): boolean => {
    if (readOnly || !(mods & Gdk.ModifierType.CONTROL_MASK)) return false;
    const key = Gdk.keyvalToLower(keyval);
    const shift = !!(mods & Gdk.ModifierType.SHIFT_MASK);
    if (key === Gdk.KEY_z && !shift && derived.canUndo) dispatch({ type: "undo" });
    else if (((key === Gdk.KEY_z && shift) || key === Gdk.KEY_y) && derived.canRedo) dispatch({ type: "redo" });
    else return false;
    return true;
  };

  return (
    <DisplaySettingsProvider value={display}>
      <EmbeddedContext.Provider value={embedded}>
        {/* Undo and redo here are the table's own: the keys don't reach the document around it. */}
        <GtkBox ref={frame} heightRequest={height} controllers={<GtkEventControllerKey onKeyPressed={(keyval, _code, mods) => undoKeys(keyval, mods)} />}>
          <LayoutView
            key={derived.view.id}
            layout={derived.view.layout}
            view={derived.shown.view}
            rows={derived.shown.rows}
            schema={table.schema}
            bodies={table.bodies}
            relatedTables={related}
            allRows={table.rows}
            tableKey={tableName}
            sheet={derived.shown.sheet}
            {...(readOnly ? {} : callbacks)}
            onOpenRelation={onOpenLink}
          />
        </GtkBox>
      </EmbeddedContext.Provider>
      {state.openPage !== null ? (
        <RowPage
          key={`${state.active}#${state.openPage}`}
          rowId={state.openPage}
          rowTitle={rowTitleFor(table, state.openPage)}
          content={table.bodies?.[state.openPage] ?? ""}
          onSave={(content) => dispatch({ type: "updateBody", rowId: state.openPage!, content, table: state.active })}
          onClose={() => dispatch({ type: "openPage", rowId: null })}
        />
      ) : null}
      {asking?.kind === "confirm" ? (
        <AdwAlertDialog
          heading={asking.confirm.heading}
          body={asking.confirm.body}
          closeResponse="cancel"
          defaultResponse="cancel"
          responses={asking.confirm.responses.map((r) => ({
            id: r.id,
            label: r.label,
            ...(r.destructive ? { appearance: Adw.ResponseAppearance.DESTRUCTIVE } : {}),
          }))}
          onResponse={(response) => dispatch({ type: "answer", response })}
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
    </DisplaySettingsProvider>
  );
}

export function TableEmbed({ address, baseDir, within, caption, maxHeight = EMBED_MAX_HEIGHT, locale, readOnly = false, onOpenLink }: TableEmbedProps) {
  const [read, setRead] = useState<EmbedRead | null>(null);
  useEffect(() => {
    let current = true;
    void readEmbed({ address, baseDir, within }).then((result) => {
      if (current) setRead(result);
    });
    return () => {
      current = false;
    };
  }, [address, baseDir, within]);

  return (
    <GtkBox name="table-embed" orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
      {read?.kind === "shown" ? <Shown key={`${read.library.paths[bundleOf(read.key)]}\u0000${read.key}\u0000${read.viewId}`} shown={read} maxHeight={maxHeight} locale={locale} readOnly={readOnly} onOpenLink={onOpenLink} /> : null}
      {read?.kind === "problem" ? (
        <GtkBox name="table-embed-problem" cssClasses={[styles.embedProblem]}>
          <GtkLabel label={read.text} xalign={0} wrap hexpand cssClasses={["dim-label"]} />
        </GtkBox>
      ) : null}
      {caption && read ? <GtkLabel name="table-embed-caption" label={caption} wrap justify={Gtk.Justification.CENTER} cssClasses={["caption", "dim-label"]} /> : null}
    </GtkBox>
  );
}
