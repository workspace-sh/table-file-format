// A `.table` drawn inside something else: a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). It is
// the table itself, not a picture of it: the same views an app of its own
// shows, over the same state (table-app's reducer), so a cell edited here
// is written to the file, goes to its history, and can be undone. It is as
// tall as what it holds up to a limit, with the link's caption beneath.
// What can't be drawn says why, in the table's place.

import { css } from "@gtkx/css";
import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkButton, GtkCenterBox, GtkEventControllerKey, GtkLabel } from "@gtkx/jsx/gtk";
import { bundleOf, derive, embedCount, embedFileAddress, embedLeftOut, embedMoreText, linkedRowAddress, type EmbeddedTableFiles, type EmbedRead, type EmbedShown } from "@workspace.sh/table-app";
import { embedFiles, readEmbed, type EmbedTarget, type IndexHost } from "@workspace.sh/table-app/node";
import { useEmbeddedTable } from "@workspace.sh/table-app/react";
import { DisplaySettingsProvider } from "@workspace.sh/table-ui/shared";
import { basename } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmbeddedContext } from "./embedded.js";
import { LayoutView } from "./LayoutView.js";
import { TableDialogs } from "./TableDialogs.js";
import { openWorkerIndexHost } from "./indexed/indexClient.js";
import { IndexedView } from "./indexed/IndexedView.js";
import { sharedIndexHosts } from "./indexed/sharedHosts.js";
import { useIndexedTables } from "./indexed/useIndexedTables.js";
import type { ParsedTable } from "@workspace.sh/table-core";
import { styles } from "./theme.js";

const overs = new Map<number, string>();
/** The view's frame, wider than the page's text by its margin on each side: what scrolls sideways in it reaches the window's edges. */
function overMargins(gutter: number): string {
  let over = overs.get(gutter);
  if (!over) {
    // (No narrower than its two margins, or it would ask for less than no width.)
    over = css({ marginLeft: `-${gutter}px`, marginRight: `-${gutter}px`, minWidth: `${2 * gutter}px` });
    overs.set(gutter, over);
  }
  return over;
}

/** The tallest an embedded view is before it scrolls within itself. */
export const EMBED_MAX_HEIGHT = 480;

export interface TableEmbedProps extends EmbedTarget {
  /** Shown beneath: the link's title. */
  caption?: string;
  /** The tallest the view is, in pixels; past it, it scrolls within itself. */
  maxHeight?: number;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /**
   * The side margin of the page the embed sits in. A view that scrolls sideways then runs over it to
   * the window's edges: resting in line with the page's text, passing under the margin as it is
   * scrolled, and stopping on the far margin at its end. The caption and the lines beneath stay in
   * line with the text. Absent: it is kept to the width it is given.
   */
  gutter?: number;
  /** The table is to look at: nothing in it can be changed, and nothing is written. For a reader who can't write where it is. */
  readOnly?: boolean;
  /**
   * A linked row was clicked: its address as the file's (the `.table`'s path as
   * it was read, the table and the row: `/notes/projects.table#table=projects&row=p2`),
   * for the app to open there. Absent: a linked row is its name, and goes nowhere.
   */
  onOpenLink?: (address: string) => void;
  /**
   * The table opened as a document of its own: the file's address at the table and view drawn
   * (`/notes/projects.table#table=tasks&view=v2`), for the app to open there. Given, the embed offers
   * it beside its caption (Open). Absent: it offers nothing.
   */
  onOpen?: (address: string) => void;
  /** A bundle's index, for a table too large to hold in memory: in a worker of its own unless given (a test's, in this thread). */
  openIndex?: (bundleDir: string) => IndexHost;
}

/** The table, held and edited as an app of its own holds it (table-app's useEmbeddedTable), and written where it was read from. */
function Shown({
  shown,
  maxHeight,
  locale,
  readOnly,
  gutter,
  openIndex,
  onOpenLink,
}: {
  shown: EmbedShown;
  gutter: number;
  openIndex: (bundleDir: string) => IndexHost;
  maxHeight: number;
  locale: string | undefined;
  readOnly: boolean;
  onOpenLink: ((address: string) => void) | undefined;
}) {
  // A large table's rows are in its bundle's index: written back after the rest of the bundle is.
  const saveIndexed = useRef<(bundles: string[], tables: Record<string, ParsedTable>) => Promise<void>>(async () => {});
  const files: EmbeddedTableFiles = {
    ...embedFiles,
    write: async (library, tables, metas, bundle) => {
      await embedFiles.write(library, tables, metas, bundle);
      await saveIndexed.current([bundle], tables);
    },
  };
  const { state, dispatch, derived: drawn, display, tableName, related, callbacks } = useEmbeddedTable(shown, files, locale);
  // One index per folder, shared with every other view of this file (the file opened as a document, another embed).
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
  const derived = indexed.source ? derive(state, { locale, newTableIn: "none", indexedShown: { count: indexed.source.count, inView: indexed.source.inView } }) : drawn;
  const { table } = derived;
  // How much to show at once: the link's own count of rows or cards, else the limit. Cut to
  // that count (`rest=more`), the rest isn't drawn until the line beneath is pressed; from
  // then on it is the whole view at its usual height.
  const { rows, cards, rest } = shown.size;
  const [opened, setOpened] = useState(false);
  const cut = rest === "more" && !opened;
  const embedded = useMemo(() => (opened ? { maxHeight, gutter } : { maxHeight, gutter, rows, cards, cut }), [maxHeight, gutter, rows, cards, cut, opened]);
  // Read through the index, a table or a list leaves out what is past the count of all its rows; a board isn't cut there.
  const counted = embedCount(shown.size, derived.view.layout);
  const leftOut = !cut
    ? 0
    : table.indexed
      ? indexed.source && counted !== undefined && derived.view.layout !== "board"
        ? Math.max(0, indexed.source.count - counted)
        : 0
      : embedLeftOut(shown.size, derived.shown.view, derived.shown.rows, table.schema);
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
  }, [derived.view.layout, maxHeight, table.indexed && !!indexed.source]);
  /** A linked row, said as the file's address, for the app to open there. */
  const followLink = (address: string) => {
    const link = linkedRowAddress(address, shown.library, state, bundleOf(state.active));
    if (link) onOpenLink?.(link);
  };
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
        <GtkBox ref={frame} heightRequest={height} cssClasses={gutter > 0 ? [overMargins(gutter)] : []} controllers={<GtkEventControllerKey onKeyPressed={(keyval, _code, mods) => undoKeys(keyval, mods)} />}>
          {table.indexed ? (
            // A table this large is read through its bundle's index, shared with the file opened as a document.
            <IndexedView
              indexed={indexed}
              view={derived.shown.view}
              table={table}
              tableName={tableName}
              related={related}
              sheet={derived.shown.sheet}
              viewKey={derived.view.id}
              edits={readOnly ? {} : leftOut > 0 ? { ...callbacks, onAddRow: undefined } : callbacks}
              onOpenRelation={onOpenLink ? followLink : undefined}
            />
          ) : (
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
              // With rows left out there is nowhere to add one: it would go after rows that aren't shown.
              {...(leftOut > 0 ? { onAddRow: undefined } : {})}
              // A linked row, said as the file's address, for the app to open there.
              onOpenRelation={
                onOpenLink
                  ? (address) => {
                      const link = linkedRowAddress(address, shown.library, state, bundleOf(state.active));
                      if (link) onOpenLink(link);
                    }
                  : undefined
              }
            />
          )}
        </GtkBox>
      </EmbeddedContext.Provider>
      {leftOut > 0 ? (
        <GtkButton name="table-embed-more" label={embedMoreText(leftOut, derived.view.layout)} halign={Gtk.Align.START} cssClasses={["flat"]} onClicked={() => setOpened(true)} />
      ) : null}
      <TableDialogs state={state} dispatch={dispatch} table={table} />
    </DisplaySettingsProvider>
  );
}

export function TableEmbed({ address, baseDir, within, caption, maxHeight = EMBED_MAX_HEIGHT, locale, readOnly = false, gutter = 0, onOpenLink, onOpen, openIndex = openWorkerIndexHost }: TableEmbedProps) {
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

  // Where Open goes: the file at the table and view drawn. Nothing for a file without a path, or a host that opens none.
  const openAt = onOpen && read?.kind === "shown" ? embedFileAddress(read) : null;
  return (
    <GtkBox name="table-embed" orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand>
      {read?.kind === "shown" ? <Shown key={`${read.library.paths[bundleOf(read.key)]}\u0000${read.key}\u0000${read.viewId}`} shown={read} maxHeight={maxHeight} locale={locale} readOnly={readOnly} gutter={gutter} openIndex={openIndex} onOpenLink={onOpenLink} /> : null}
      {read?.kind === "problem" ? (
        <GtkBox name="table-embed-problem" cssClasses={[styles.embedProblem]}>
          <GtkLabel label={read.text} xalign={0} wrap hexpand cssClasses={["dim-label"]} />
        </GtkBox>
      ) : null}
      {(caption && read) || openAt ? (
        // The caption, centred under the table; and Open, at its end, for the table as a document.
        <GtkCenterBox
          name="table-embed-foot"
          centerWidget={caption && read ? <GtkLabel name="table-embed-caption" label={caption} wrap justify={Gtk.Justification.CENTER} cssClasses={["caption", "dim-label"]} /> : undefined}
          endWidget={
            openAt ? (
              <GtkButton
                name="table-embed-open"
                iconName="view-fullscreen-symbolic"
                tooltipText={`Open ${basename(read?.kind === "shown" ? (read.library.paths[bundleOf(read.key)] ?? "") : "")}`}
                cssClasses={["flat", "circular"]}
                valign={Gtk.Align.CENTER}
                onClicked={() => onOpen!(openAt)}
              />
            ) : undefined
          }
        />
      ) : null}
    </GtkBox>
  );
}
