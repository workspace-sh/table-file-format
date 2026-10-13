// A `.table` drawn inside something else, over table-ui's views (the web,
// iOS, Android and macOS): a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). It is
// the table itself, not a picture of it: the same views an app of its own
// shows, over the same state (useEmbeddedTable), so a cell edited here is
// written to the file, goes to its history, and can be undone. It is as tall
// as what it holds up to a limit, then scrolls within itself, with the link's
// caption beneath. What can't be drawn says why, in the table's place.
// table-gtk's TableEmbed is the same for GTK. Each platform's frame (what
// scrolls it) and dialogs are in embedView.tsx and embedView.web.tsx.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { css, html } from "react-strict-dom";
import type { View } from "@workspace.sh/table-core";
import { BoardView, BodyEditor, CalendarView, DisplaySettingsProvider, GalleryView, ListView, TableView } from "@workspace.sh/table-ui";
import { boardColumns, type ViewProps } from "@workspace.sh/table-ui/shared";

import { bundleOf } from "./bundles.ts";
import type { Confirm } from "./confirm.ts";
import { embedCount, embedLeftOut, embedMoreText, type EmbeddedTableFiles, type EmbedRead, type EmbedShown } from "./embed.ts";
import { useEmbeddedTable } from "./react.ts";
import { rowTitleFor } from "./edits.ts";

/** The tallest an embedded view is before it scrolls within itself, as on GTK. */
export const EMBED_MAX_HEIGHT = 480;

/** A row's height and the header's, for how tall `rows=n` is: table-ui's own default. */
const ROW_HEIGHT = 44;

export interface TableEmbedProps {
  /** What the link names, read by the host over its own files (readEmbedWith); null while it's read. */
  read: EmbedRead | null;
  /** How the host writes the file back and adds to its history (embedFilesWith over its files). */
  files: EmbeddedTableFiles;
  /** Shown beneath: the link's title. */
  caption?: string;
  /** The tallest the view is, in points; past it, it scrolls within itself. */
  maxHeight?: number;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /** The table is to look at: nothing in it can be changed, and nothing is written. */
  readOnly?: boolean;
  /** A linked row was chosen: its address, for the host to go to. Absent: a linked row goes nowhere. */
  onOpenLink?: (address: string) => void;
  /** Ask a question (deleting a row, say) in the host's own way; `answer` gets the response's id. Each platform has a default. */
  ask?: (confirm: Confirm, answer: (response: string) => void) => void;
}

/** What scrolls an embedded view, as tall as what it holds up to `limit`. */
export type EmbedFrame = (props: { limit: number; children: ReactNode }) => ReactNode;

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

function Shown({
  shown,
  files,
  maxHeight,
  locale,
  readOnly,
  onOpenLink,
  ask,
  Frame,
}: {
  shown: EmbedShown;
  files: EmbeddedTableFiles;
  maxHeight: number;
  locale: string | undefined;
  readOnly: boolean;
  onOpenLink: ((address: string) => void) | undefined;
  ask: NonNullable<TableEmbedProps["ask"]>;
  Frame: EmbedFrame;
}) {
  const { state, dispatch, derived, display, tableName, related, callbacks } = useEmbeddedTable(shown, files, locale);
  const { table, view } = derived;
  // How much to show at once: the link's own count of rows, else the limit. Cut to the
  // count (`rest=more`), only the counted rows or cards are drawn, each column's first on a
  // board, until the line beneath is pressed; from then on it is the whole view.
  const count = embedCount(shown.size, view.layout);
  const [opened, setOpened] = useState(false);
  const cut = shown.size.rest === "more" && count !== undefined && !opened;
  const allShown = derived.shown.rows;
  const drawn = useMemo(() => {
    if (!cut) return allShown;
    if (view.layout !== "board") return allShown.slice(0, count);
    const board = boardColumns(derived.shown.view, allShown, table.schema);
    const kept = new Set(board.keys.flatMap((key) => (board.groups[key] ?? []).slice(0, count).map((r) => r.id)));
    return allShown.filter((r) => kept.has(r.id));
  }, [cut, count, allShown, view.layout, derived.shown.view, table.schema]);
  const leftOut = cut ? embedLeftOut(shown.size, derived.shown.view, allShown, table.schema) : 0;
  const rows = shown.size.rows;
  const limit =
    !cut && rows !== undefined && (view.layout === "table" || view.layout === "list") ? Math.min(maxHeight, ROW_HEIGHT + rows * (view.rowHeight ?? ROW_HEIGHT)) : maxHeight;
  // A question (deleting a row, say) or a message, in the host's own dialog, once each.
  const asking = state.asking;
  useEffect(() => {
    if (asking?.kind === "confirm") ask(asking.confirm, (response) => dispatch({ type: "answer", response }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);
  const telling = state.telling;
  useEffect(() => {
    if (telling) ask({ heading: telling.heading, body: telling.body ?? "", responses: [{ id: "ok", label: "OK" }] }, () => dispatch({ type: "told" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telling]);
  return (
    <DisplaySettingsProvider value={display}>
      <Frame limit={limit}>
        <LayoutView
          key={view.id}
          layout={view.layout}
          view={derived.shown.view}
          rows={drawn}
          schema={table.schema}
          bodies={table.bodies}
          relatedTables={related}
          allRows={table.rows}
          tableKey={tableName}
          sheet={derived.shown.sheet}
          {...(readOnly ? {} : callbacks)}
          // A row added while the rest is left out would be out of sight: the rest is shown first.
          {...(readOnly || !cut
            ? {}
            : {
                onAddRow: () => {
                  setOpened(true);
                  return callbacks.onAddRow();
                },
              })}
          {...(onOpenLink ? { onOpenRelation: onOpenLink } : {})}
        />
      </Frame>
      {leftOut > 0 ? (
        <html.button style={styles.more} onClick={() => setOpened(true)}>
          <html.span style={styles.moreText}>{embedMoreText(leftOut, view.layout)}</html.span>
        </html.button>
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

/** The drop-in, given a platform's frame and its default dialog. */
export function TableEmbedWith(
  { read, files, caption, maxHeight = EMBED_MAX_HEIGHT, locale, readOnly = false, onOpenLink, ask }: TableEmbedProps,
  Frame: EmbedFrame,
  defaultAsk: NonNullable<TableEmbedProps["ask"]>,
) {
  return (
    <html.div style={styles.embed}>
      {read?.kind === "shown" ? (
        <Shown
          key={`${read.library.paths[bundleOf(read.key)]}\u0000${read.key}\u0000${read.viewId}`}
          shown={read}
          files={files}
          maxHeight={maxHeight}
          locale={locale}
          readOnly={readOnly}
          onOpenLink={onOpenLink}
          ask={ask ?? defaultAsk}
          Frame={Frame}
        />
      ) : null}
      {read?.kind === "problem" ? (
        <html.div style={styles.problem}>
          <html.span style={styles.problemText}>{read.text}</html.span>
        </html.div>
      ) : null}
      {caption && read ? <html.span style={styles.caption}>{caption}</html.span> : null}
    </html.div>
  );
}

const dim = { default: "#6e6e73", "@media (prefers-color-scheme: dark)": "#8a8a93" };

const styles = css.create({
  embed: { display: "flex", flexDirection: "column", gap: 6, alignSelf: "stretch" },
  problem: {
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: { default: "#d1d1d6", "@media (prefers-color-scheme: dark)": "#3a3a3f" },
  },
  problemText: { fontSize: 14, color: dim },
  caption: { fontSize: 13, color: dim, textAlign: "center" },
  more: { alignSelf: "flex-start", paddingBlock: 4, paddingInline: 6, borderWidth: 0, backgroundColor: "transparent" },
  moreText: { fontSize: 14, color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" } },
});
