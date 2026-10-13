// A `.table` drawn inside something else: a document that links to it
// (`[Tasks](projects.table#table=tasks&view=v2&embed=1 "Caption")`). What
// the link's address names in a file just read: which table and which
// view, or why it can't be drawn, in words for whoever is reading the
// document. Every platform's drop-in (table-gtk's and table-ui's
// TableEmbed) asks this, so a link draws the same thing, and fails with
// the same words, everywhere. `./react`'s useEmbeddedTable holds what it
// names; `./node`'s readEmbed finds the file on disk.

import type { Address, BundleMeta, EditEvent, ParsedTable } from "@workspace.sh/table-core";

import { bundleOf, tableNameOf } from "./bundles.ts";
import type { Library } from "./library.ts";

export interface EmbedShown {
  kind: "shown";
  /** The file as read: its tables by `bundle/table` key, and where it is, for writing it back. */
  library: Library;
  /** The table to draw, by its key in `library.tables`. */
  key: string;
  /** Its view's id; "" for a table with no views of its own. */
  viewId: string;
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
export function embedIn(library: Library, address: Pick<Address, "tableName" | "viewId">, file: string): EmbedRead {
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
  return { kind: "shown", library, key, viewId: address.viewId ?? table.views[0]?.id ?? "" };
}

/** Where an embedded table's file is, for the platform: how a bundle is written back, and how its history is added to. */
export interface EmbeddedTableFiles {
  /** Write one bundle of `tables` to where `library` read it from. */
  write: (library: Library, tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>, bundle: string) => Promise<void>;
  /** Append events to the history of the table `key` (SPEC section 14). Absent: the platform keeps no history. */
  appendHistory?: (library: Library, key: string, events: EditEvent[]) => Promise<void>;
}
