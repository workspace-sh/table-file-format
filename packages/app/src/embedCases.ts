// The embed cases every platform checks: workspace-fixtures'
// Fixtures/markdown/*.cases.json, one beside each document of embeds. Each
// case is a link in the document and what it should give: a view drawn,
// the reason it can't be, or a plain link. A platform's tests draw each case
// their own way and compare what they see with `expect`.

import type { Row, TableSchema, View } from "@workspace.sh/table-core";
import { tableNameOf } from "./bundles.ts";
import { boardColumns, groupLabel, groupedRows } from "@workspace.sh/table-ui/shared";
import { embedCount, embedLeftOut, embedMoreText, type EmbedRead } from "./embed.ts";
import { showView } from "./showView.ts";

/** A cases file: the document it is for, and its links in the order they're written. */
export interface EmbedCases {
  document: string;
  cases: EmbedCase[];
}

export interface EmbedCase {
  /** The line of the document the link is on, exactly as written. */
  line: string;
  /** The link's address. */
  address: string;
  expect: EmbedExpected;
}

/** What a link gives: a view drawn, why it can't be, or a link (it isn't an embed). */
export type EmbedExpected = EmbedDrawn | { problem: string } | { link: true };

export interface EmbedDrawn {
  table: string;
  view: string;
  layout: View["layout"];
  /** How many rows the view holds. */
  rows: number;
  /**
   * The first rows or cards drawn, by their first field, in the order they're
   * drawn: up to five, or all the count shows when the link cuts the view
   * to it (`rest=more`). A grouped table, in its groups' order. A board,
   * column by column: each one's first card, or as many as it's cut to.
   */
  first: string[];
  /** A grouped table's groups drawn, or a board's columns: each one's heading and how many rows it holds. */
  groups?: { label: string; count: number }[];
  /** The line beneath a view cut to its count ("Show 5 more rows"), when it leaves any out. */
  more?: string;
}

const FIRST = 5;

const titleOf = (row: Row, view: View, schema: TableSchema): string => {
  const field = view.fields?.[0] ?? schema.fields[0]?.name;
  const value = field === undefined ? undefined : row[field];
  return value === undefined || value === null ? "" : String(value);
};

/** What `read` draws, as a cases file says it. Its table's rows must be read (not left to an index). */
export function embedDrawn(read: EmbedRead): EmbedExpected {
  if (read.kind === "problem") return { problem: read.text };
  const { library, key, viewId, size } = read;
  const table = library.tables[key]!;
  const view = table.views.find((v) => v.id === viewId) ?? table.views[0]!;
  const { rows } = showView(library.tables, key, view);
  const count = embedCount(size, view.layout);
  const cut = size.rest === "more" ? count : undefined;
  const drawn: { title: string }[] = [];
  let groups: { label: string; count: number }[] | undefined;
  if (view.layout === "board") {
    const board = boardColumns(view, rows, table.schema);
    groups = board.keys.map((k) => ({ label: groupLabel(k, board.field, table.schema), count: board.groups[k]?.length ?? 0 }));
    // Each column's first cards: as many as it's cut to, else its first.
    for (const k of board.keys) for (const row of (board.groups[k] ?? []).slice(0, cut ?? 1)) drawn.push({ title: titleOf(row, view, table.schema) });
  } else {
    // Cut to its count, a grouped table draws only the groups its first rows are in.
    const ordered = groupedRows(view, rows, table.schema);
    if (view.group?.field) groups = (cut === undefined ? ordered : ordered.slice(0, cut)).flatMap((r) => (r.starts ? [r.starts] : []));
    for (const r of ordered.slice(0, cut ?? FIRST)) drawn.push({ title: titleOf(r.row, view, table.schema) });
  }
  const leftOut = embedLeftOut(size, view, rows, table.schema);
  return {
    table: tableNameOf(key),
    view: view.name,
    layout: view.layout,
    rows: rows.length,
    first: (cut === undefined && view.layout !== "board" ? drawn.slice(0, FIRST) : drawn).map((d) => d.title),
    ...(groups ? { groups } : {}),
    ...(leftOut > 0 ? { more: embedMoreText(leftOut, view.layout) } : {}),
  };
}

/** A link alone in its paragraph, as a whole line: `[text](address)` or `[text](address "title")`. */
const ALONE = /^\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)$/;
const LINK = /\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g;

/** Whether an address asks to be embedded: an `embed` key whose value isn't "0". */
const asksToEmbed = (address: string): boolean => {
  const fragment = address.split("#")[1];
  if (fragment === undefined) return false;
  const value = new URLSearchParams(fragment).get("embed");
  return value !== null && value !== "0";
};

const linksTable = (address: string): boolean => /\.table(#|$)/.test(address.split("?")[0]!);

/**
 * The cases of a document of embeds: each link to a `.table` on its own line
 * or in a sentence, in order. A paragraph that is one link asking to be
 * embedded is an embed, and `read` says what it gives; any other is a link.
 */
export async function embedCasesOf(markdown: string, document: string, read: (address: string) => Promise<EmbedRead>): Promise<EmbedCases> {
  const lines = markdown.split("\n");
  const cases: EmbedCase[] = [];
  for (const [i, line] of lines.entries()) {
    const alone = ALONE.exec(line);
    const paragraph = (lines[i - 1] ?? "").trim() === "" && (lines[i + 1] ?? "").trim() === "";
    for (const match of line.matchAll(LINK)) {
      const address = match[1]!;
      if (!linksTable(address)) continue;
      const embeds = alone !== null && paragraph && asksToEmbed(address);
      cases.push({ line, address, expect: embeds ? embedDrawn(await read(address)) : { link: true } });
    }
  }
  return { document, cases };
}
