// A `.table` drawn inside something else: a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). What
// the link's address names in a file just read: which table and which
// view, or why it can't be drawn, in words for whoever is reading the
// document. Every platform's drop-in (table-gtk's and table-ui's
// TableEmbed) asks this, so a link draws the same thing, and fails with
// the same words, everywhere. `./react`'s useEmbeddedTable holds what it
// names; `./node`'s readEmbed finds the file on disk.

import type { Address, BundleMeta, EditEvent, ParsedTable, Row, TableSchema, View } from "@workspace.sh/table-core";
import { boardColumns } from "@workspace.sh/table-ui/shared";

import { bundleOf, tableNameOf } from "./bundles.ts";
import type { Library } from "./library.ts";

/**
 * How much of the view is shown before it scrolls within itself, from the
 * link's address (SPEC section 10): `rows=` for a table or a list, `cards=`
 * for a board (down each column) or a gallery. Absent: the drop-in's own
 * limit.
 */
export interface EmbedSize {
  rows?: number;
  cards?: number;
  /**
   * What becomes of the rows or cards past the count: absent, the view
   * scrolls within itself to them; "more" (`rest=more`), only the counted
   * ones are drawn, with a line beneath that says how many more there are
   * and shows them.
   */
  rest?: "more";
}

/** The most rows or cards an address can ask to be shown at once. */
export const EMBED_COUNT_MAX = 500;

/** A whole number from 1, as an address writes it; anything else is not a count. */
function count(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d{0,5}$/.test(value)) return undefined;
  return Math.min(Number(value), EMBED_COUNT_MAX);
}

/** What an address says of how much to show. A value that isn't a count is ignored, as an unknown key is. */
export function embedSize(address: Pick<Address, "extra">): EmbedSize {
  const rows = count(address.extra?.rows);
  const cards = count(address.extra?.cards);
  return { ...(rows === undefined ? {} : { rows }), ...(cards === undefined ? {} : { cards }), ...(address.extra?.rest === "more" ? { rest: "more" as const } : {}) };
}

/** Which of an address's counts a view's layout shows: rows for a table or a list, cards for a board or a gallery. */
export function embedCount(size: EmbedSize, layout: View["layout"]): number | undefined {
  if (layout === "table" || layout === "list") return size.rows;
  if (layout === "board" || layout === "gallery") return size.cards;
  return undefined;
}

/**
 * How many of a view's rows or cards an embed asked for only the first of
 * (`rest=more`) leaves out: what its "Show 12 more rows" line counts. A
 * board leaves out the cards past the count in each column. 0 when it
 * isn't cut, or leaves nothing out.
 */
export function embedLeftOut(size: EmbedSize, view: View, rows: Row[], schema: TableSchema): number {
  const shown = size.rest === "more" ? embedCount(size, view.layout) : undefined;
  if (shown === undefined) return 0;
  if (view.layout !== "board") return Math.max(0, rows.length - shown);
  const board = boardColumns(view, rows, schema);
  return board.keys.reduce((left, key) => left + Math.max(0, (board.groups[key]?.length ?? 0) - shown), 0);
}

/** The line beneath a cut embed, which shows the rest when pressed: "Show 12 more rows". */
export function embedMoreText(leftOut: number, layout: View["layout"]): string {
  const what = layout === "board" || layout === "gallery" ? "card" : "row";
  return `Show ${leftOut.toLocaleString("en")} more ${what}${leftOut === 1 ? "" : "s"}`;
}

export interface EmbedShown {
  kind: "shown";
  /** The file as read: its tables by `bundle/table` key, and where it is, for writing it back. */
  library: Library;
  /** The table to draw, by its key in `library.tables`. */
  key: string;
  /** Its view's id; "" for a table with no views of its own. */
  viewId: string;
  /** How much of it to show at once, when the address says. */
  size: EmbedSize;
}

export interface EmbedProblem {
  kind: "problem";
  text: string;
}

export type EmbedRead = EmbedShown | EmbedProblem;

export const embedProblem = (text: string): EmbedProblem => ({ kind: "problem", text });

const listed = (names: string[]) => names.map((n) => `“${n}”`).join(", ");

/**
 * What `address` names in `library`, one `.table` file just read (its
 * large tables without their rows: `indexed`). `file` is what the file is
 * called, for the words.
 */
export function embedIn(library: Library, address: Pick<Address, "tableName" | "viewId" | "extra">, file: string): EmbedRead {
  const keys = Object.keys(library.tables);
  if (keys.length === 0) {
    const why = Object.values(library.problems).flat()[0];
    return embedProblem(why ? `“${file}” couldn’t be read: ${why}` : `“${file}” isn’t a .table, or it holds no tables.`);
  }
  const bundle = bundleOf(keys[0]!);
  const names = keys.map(tableNameOf);

  // `table=` may be left out when the bundle holds exactly one (SPEC section 1).
  const name = address.tableName ?? (names.length === 1 ? names[0]! : undefined);
  if (name === undefined) return embedProblem(`“${file}” holds ${names.length} tables. The link says which with “table=”: ${listed(names)}.`);
  const key = keys.find((k) => tableNameOf(k) === name && bundleOf(k) === bundle);
  const table = key === undefined ? undefined : library.tables[key];
  if (key === undefined || !table) return embedProblem(`“${file}” has no table named “${name}”. It has ${listed(names)}.`);
  // A table of many rows is read through an index, in an app of its own (SPEC section 8).
  if (table.indexed) return embedProblem(`“${name}” in “${file}” has too many rows to show in a document yet.`);

  if (address.viewId !== undefined && !table.views.some((v) => v.id === address.viewId)) {
    const has = table.views.length > 0 ? ` It has ${listed(table.views.map((v) => v.id))}.` : " It has no views of its own.";
    return embedProblem(`The table “${name}” has no view “${address.viewId}”.${has}`);
  }
  return { kind: "shown", library, key, viewId: address.viewId ?? table.views[0]?.id ?? "", size: embedSize(address) };
}

/** Where an embedded table's file is, for the platform: how a bundle is written back, and how its history is added to. */
export interface EmbeddedTableFiles {
  /** Write one bundle of `tables` to where `library` read it from. */
  write: (library: Library, tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>, bundle: string) => Promise<void>;
  /** Append events to the history of the table `key` (SPEC section 14). Absent: the platform keeps no history. */
  appendHistory?: (library: Library, key: string, events: EditEvent[]) => Promise<void>;
}
