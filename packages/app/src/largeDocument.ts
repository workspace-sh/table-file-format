// A single-file `.table` holding a large table (INDEXED_FROM rows or more),
// opened as a document through the index (SPEC section 8): its first rows at
// once, the rest read meanwhile into the index and into the host's folder
// for it, which is then its working folder. What the iOS demo's documents
// do, for any host to share (Workspace's TableFileView among them), so no
// host reads a large file's every row into memory to show it.

import { readTableArchive, type Row } from "@workspace.sh/table-core";
import type { Address } from "@workspace.sh/table-core";
import { fromBundle } from "./bundles.ts";
import { embedIn, type EmbedRead } from "./embed.ts";
import { INDEXED_FROM, linesInBytes } from "./indexed.ts";
import type { IndexHost } from "./indexHost.ts";
import type { Library } from "./library.ts";

/** How much of a large rows file is read to judge how many rows it holds. */
const JUDGED_FROM_BYTES = 256 * 1024;

/**
 * Whether a single file holds a table of INDEXED_FROM rows or more: judged
 * from the start of each large rows file, the rest left compressed.
 */
export async function holdsLargeTable(bytes: Uint8Array, from: number = INDEXED_FROM): Promise<boolean> {
  let large = false;
  await readTableArchive(bytes, {
    rowsLazily: (_name, _table, rows) => {
      const head = rows.head(JUDGED_FROM_BYTES);
      const count = head.length >= rows.size ? linesInBytes(head) : (linesInBytes(head) / Math.max(1, head.length)) * rows.size;
      if (count >= from) large = true;
      // Never parsed here: this is only a look.
      return true;
    },
  });
  return large;
}

/** A large single file read as a document: what to show, its large tables' first rows, and its folder (its working folder from now on). */
export interface LargeDocument {
  read: EmbedRead;
  /** Each large table's first rows by `bundle/table` key: TableFileView's `index.first`. */
  first: Record<string, Row[]>;
  /** The bundle's key, and its folder in the host's home: packed back into the file after a write. */
  key: string;
  folder: string;
}

/**
 * Open a single file holding a large table through the index host: the
 * bundle comes back with its large tables `indexed` (no rows here), their
 * first rows to show, and the rest on their way into the index. `file` is
 * the file's name, for what's said; `address` what to show (its table and
 * view). Null when the file holds no large table after all: read it as any.
 */
export async function readLargeTableFile(
  bytes: Uint8Array,
  file: string,
  host: Pick<IndexHost, "openZip" | "bundleDir">,
  address: Pick<Address, "tableName" | "viewId" | "extra"> = { extra: {} },
  taken: Iterable<string> = [],
): Promise<LargeDocument | null> {
  const { opened, first } = await host.openZip(bytes, taken);
  if (!Object.values(opened.bundle.tables).some((t) => t.indexed)) return null;
  const folder = host.bundleDir(opened.key);
  const library: Library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: { [opened.key]: folder }, problems: {} };
  const keyed = Object.fromEntries(Object.entries(first).map(([table, rows]) => [table.includes("/") ? table : `${opened.key}/${table}`, rows]));
  return { read: embedIn(library, address, file, { readsIndex: true }), first: keyed, key: opened.key, folder };
}
