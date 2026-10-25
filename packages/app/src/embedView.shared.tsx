// A `.table` drawn inside something else, over table-ui's views (the web,
// iOS, Android and macOS): a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). It is
// the table itself, not a picture of it: the same views an app of its own
// shows, over the same state (useEmbeddedTable), so a cell edited here is
// written to the file, goes to its history, and can be undone. It is as tall
// as what it holds up to a limit, then scrolls within itself, with the link's
// title above it. What can't be drawn says why, in the table's place.
// table-gtk's TableEmbed is the same for GTK. Each platform's frame (what
// scrolls it) and dialogs are in embedView.tsx and embedView.web.tsx.

import { useEffect, useState, type ReactNode } from "react";
import { css, html } from "react-strict-dom";
import type { View } from "@workspace.sh/table-core";
import { BodyEditor, DisplaySettingsProvider, KeyboardOnShow } from "@workspace.sh/table-ui";

import { bundleOf } from "./bundles.ts";
import type { Confirm } from "./confirm.ts";
import { EMBED_MAX_HEIGHT, EMBED_ROW_HEIGHT, embedCount, embedFileAddress, embedLeftOut, embedMoreText, embedRoom, linkedRowAddress, type EmbeddedTableFiles, type EmbedRead, type EmbedShown } from "./embed.ts";
import { useEmbeddedTable } from "./react.ts";
import { LayoutView } from "./layoutView.tsx";
import { rowTitleFor } from "./edits.ts";

export { EMBED_MAX_HEIGHT };

const ROW_HEIGHT = EMBED_ROW_HEIGHT;


export interface TableEmbedProps {
  /** What the link names, read by the host over its own files (readEmbedWith); null while it's read. */
  read: EmbedRead | null;
  /** How the host writes the file back and adds to its history (embedFilesWith over its files). */
  files: EmbeddedTableFiles;
  /** Shown above it, as its title: the link's title. */
  caption?: string;
  /** The tallest the view is, in points; past it, it scrolls within itself. */
  maxHeight?: number;
  /** The reader's locale, for dates, numbers and which way it reads. The system's, when not given. */
  locale?: string;
  /** The table is to look at: nothing in it can be changed, and nothing is written. */
  readOnly?: boolean;
  /**
   * A linked row was chosen: its address as the file's (the `.table`'s path as it was read, the
   * table and the row: `/notes/projects.table#table=projects&row=p2`), for the host to open there.
   * Absent: a linked row goes nowhere.
   */
  onOpenLink?: (address: string) => void;
  /**
   * The table opened as a document of its own: the file's address at the table and view drawn
   * (`/notes/projects.table#table=tasks&view=v2`), for the host to open there. Given, the embed
   * offers it from its title, and the ↗ beside it. Absent, or for a file read from a
   * single-file `.table` (no path), it offers nothing.
   */
  onOpen?: (address: string) => void;
  /** Ask a question (deleting a row, say) in the host's own way; `answer` gets the response's id. Each platform has a default. */
  ask?: (confirm: Confirm, answer: (response: string) => void) => void;
  /**
   * The link as written. While it's read, the embed keeps the room it will
   * take (the link's `rows=`, else the limit), so the document around it
   * doesn't move when the table arrives. Absent: no room is kept.
   */
  address?: string;
}

/** What scrolls an embedded view, as tall as what it holds up to `limit`. */
export type EmbedFrame = (props: { limit: number; children: ReactNode }) => ReactNode;


function Shown({
  shown,
  files,
  maxHeight,
  locale,
  readOnly,
  onOpenLink,
  ask,
  Frame,
  onWidest,
}: {
  shown: EmbedShown;
  files: EmbeddedTableFiles;
  maxHeight: number;
  locale: string | undefined;
  readOnly: boolean;
  onOpenLink: ((address: string) => void) | undefined;
  ask: NonNullable<TableEmbedProps["ask"]>;
  Frame: EmbedFrame;
  onWidest: (width: number | null) => void;
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
      {/* In a document, a table comes into view as the page scrolls: it doesn't take the keyboard until it's clicked. */}
      <KeyboardOnShow.Provider value={false}>
      <Frame limit={limit}>
        <LayoutView
          key={view.id}
          layout={view.layout}
          view={derived.shown.view}
          rows={allShown}
          // Cut, the view draws only its first rows or cards; what it counts is still the whole view's.
          {...(cut ? { cut: count } : {})}
          {...(shown.size.width === "full" ? { fillWidth: true } : {})}
          {...(view.layout === "table" || view.layout === "board" ? { onWidest } : {})}
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
          {...(onOpenLink
            ? {
                onOpenRelation: (address: string) => {
                  const link = linkedRowAddress(address, shown.library, state, bundleOf(state.active));
                  if (link) onOpenLink(link);
                },
              }
            : {})}
        />
      </Frame>
      </KeyboardOnShow.Provider>
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
  { read, files, caption, maxHeight = EMBED_MAX_HEIGHT, locale, readOnly = false, onOpenLink, onOpen, ask, address }: TableEmbedProps,
  Frame: EmbedFrame,
  defaultAsk: NonNullable<TableEmbedProps["ask"]>,
) {
  const room = read === null ? embedRoom(address, maxHeight, ROW_HEIGHT) : null;
  // Where Open goes: the file at the table and view drawn. Nothing for a file without a path, or a host that opens none.
  const openAt = onOpen && read?.kind === "shown" ? embedFileAddress(read) : null;
  const captioned = caption && (read || room !== null);
  // As wide as the table grows, the title line ends where it does, not the page's.
  const [widest, setWidest] = useState<number | null>(null);
  // The title: the embed's own name, above it, and nothing else, as other
  // documents' embedded tables have it. The table opens from it, and from
  // the ↗ beside it. Where it comes from (its file and table) isn't shown
  // here (#704): the host says that when the embed itself is selected.
  const head =
    captioned || openAt ? (
      <html.div style={[styles.head, widest !== null && read?.kind === "shown" && styles.headMost(widest)]}>
        {captioned ? (
          openAt ? (
            <html.button aria-label={`${caption}, open as a document`} style={styles.titleButton} onClick={() => onOpen?.(openAt)}>
              <html.span style={styles.title}>{caption}</html.span>
            </html.button>
          ) : (
            <html.span style={styles.title}>{caption}</html.span>
          )
        ) : null}
        {openAt ? (
          <html.button aria-label="Open as a document" style={styles.open} onClick={() => onOpen?.(openAt)}>
            <html.span style={styles.openMark}>↗</html.span>
          </html.button>
        ) : null}
      </html.div>
    ) : null;
  return (
    <html.div style={styles.embed}>
      {head}
      {room !== null ? <html.div aria-hidden={true} style={styles.room(room)} /> : null}
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
          onWidest={setWidest}
        />
      ) : null}
      {read?.kind === "problem" ? (
        <html.div style={styles.problem}>
          <html.span style={styles.problemText}>{read.text}</html.span>
        </html.div>
      ) : null}
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
  head: { display: "flex", flexDirection: "row", alignItems: "center", gap: 2 },
  headMost: (width: number) => ({ maxWidth: width }),
  titleButton: { flexShrink: 1, padding: 0, borderWidth: 0, backgroundColor: "transparent", cursor: "pointer" },
  title: { fontSize: 15, fontWeight: "600", color: { default: "#1d1d1f", "@media (prefers-color-scheme: dark)": "#f2f2f4" } },
  open: { paddingBlock: 2, paddingInline: 6, borderWidth: 0, backgroundColor: "transparent", cursor: "pointer" },
  openMark: { fontSize: 15, color: dim },
  room: (height: number) => ({ height }),
  more: { alignSelf: "flex-start", paddingBlock: 4, paddingInline: 6, borderWidth: 0, backgroundColor: "transparent", cursor: "pointer" },
  moreText: { fontSize: 14, color: { default: "#007aff", "@media (prefers-color-scheme: dark)": "#0a84ff" } },
});
