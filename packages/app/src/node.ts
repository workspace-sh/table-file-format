// table-app's library over node:fs: opening `.table` folders from disk and
// saving them back (the logic is `./library`'s, over any TableFs), plus
// two things only a Node app does. A subpath, `@workspace.sh/table-app/node`,
// as core keeps its node:fs adapter apart.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { HISTORY_FILE, parseAddress, serializeEditEvents, type BundleMeta, type EditEvent, type ParsedTable } from "@workspace.sh/table-core";

import { bundleOf, fromBundle, tableNameOf } from "./bundles.ts";
import { firstTableKey } from "./starting.ts";
import { openArchive } from "./tableFiles.ts";
import { embedProblem, readEmbedWith, type EmbeddedTableFiles, type EmbedRead, type EmbedTarget } from "./embed.ts";
import { INDEXED_FROM } from "./indexed.ts";
import { attachmentName, openLibrary, writeLibraryBundle, type Library } from "./library.ts";
import { largeTables } from "./nodeIndex.ts";
import type { KeyValueStore } from "./savedTables.ts";

export { bundleKey, type Library } from "./library.ts";
export type { EmbedTarget } from "./embed.ts";
export { buildTableIndex, countRows, firstRows, largeTables, mayHoldRows, openIndexHost, saveTableRows, tableContentKey, type IndexHost } from "./nodeIndex.ts";

/** The `.table` folders in `dir`, sorted by name. */
export function bundlesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith(".table"))
    .map((e) => join(dir, e.name))
    .sort();
}

/**
 * Read each `.table` folder in `paths` from disk (relative to the working
 * directory). `held`: see openLibrary. With `indexedFrom`, a table of that
 * many rows or more comes back without them (`ParsedTable.indexed`), for
 * the app to read through the bundle's index.
 */
export function loadLibrary(paths: string[], held: Iterable<string> = [], options: { indexedFrom?: number } = {}): Promise<Library> {
  return openLibrary(
    nodeFs,
    paths.map((p) => resolve(p)),
    held,
    options.indexedFrom === undefined ? {} : { rowsElsewhere: largeTables(options.indexedFrom) },
  );
}

/**
 * Write one bundle of an app's tables back to where it was read from, by
 * core's writer (atomic per file, SPEC section 1). An app calls it after
 * edits; which bundles changed, and when to write, are the app's to say.
 */
export function saveBundle(library: Library, tables: Record<string, ParsedTable>, bundles: Record<string, BundleMeta>, key: string): Promise<void> {
  return writeLibraryBundle(nodeFs, library, tables, bundles, key);
}

/**
 * Append events to a table's edit history, `history.ndjson` in its folder
 * (`tableDir`; SPEC section 14). Only ever adds to the file: what is there
 * is left as it is, and given a line end first when it has none.
 */
export async function appendHistory(tableDir: string, events: readonly EditEvent[]): Promise<void> {
  if (events.length === 0) return;
  await mkdir(tableDir, { recursive: true });
  const path = join(tableDir, HISTORY_FILE);
  let unended = false;
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      if (size > 0) {
        const last = Buffer.alloc(1);
        await file.read(last, 0, 1, size - 1);
        unended = last[0] !== 0x0a;
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await appendFile(path, (unended ? "\n" : "") + serializeEditEvents(events), "utf8");
}

/**
 * Copies of the `.table` folders in `from`, in `to`, made once: a copy
 * already there is left as it is, edits and all. For demos, which edit
 * examples without touching the originals. `except` names the ones not to
 * copy (by their name without `.table`): examples the viewer closed, which
 * stay closed.
 */
export function copiesOf(from: string, to: string, except: Iterable<string> = []): string[] {
  const left = new Set(except);
  return bundlesIn(from)
    .filter((source) => !left.has(basename(source).replace(/\.table$/, "")))
    .map((source) => {
      const copy = join(to, basename(source));
      if (!existsSync(copy)) cpSync(source, copy, { recursive: true });
      return copy;
    });
}

/**
 * A KeyValueStore kept in one JSON file (the web keeps its in the
 * browser): for a desktop app's personal settings, such as display
 * choices. Read once, written on every change; a missing or unreadable
 * file is an empty store, and a failed write only loses the setting.
 */
export function jsonFileStore(path: string): KeyValueStore {
  let data: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object") data = parsed as Record<string, string>;
  } catch {
    // Nothing kept yet.
  }
  const write = () => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    } catch {
      // Not kept past this run; still applied now.
    }
  };
  return {
    getItem: (key) => (typeof data[key] === "string" ? data[key] : null),
    setItem: (key, value) => {
      data = { ...data, [key]: value };
      write();
    },
    removeItem: (key) => {
      const { [key]: _gone, ...rest } = data;
      data = rest;
      write();
    },
  };
}

/**
 * Copy `source` into the table folder `tableDir`'s attachments/, under a
 * name no other attachment there has (attachmentName), and return that
 * name, for the cell to store (SPEC section 6).
 */
export function attachFile(tableDir: string, source: string): string {
  const folder = join(tableDir, "attachments");
  mkdirSync(folder, { recursive: true });
  const name = attachmentName(basename(source), readdirSync(folder));
  copyFileSync(source, join(folder, name));
  return name;
}

/** The files in a table folder's attachments/, sorted; none when it has no such folder. */
export function attachmentsIn(tableDir: string): string[] {
  try {
    return readdirSync(join(tableDir, "attachments"), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * What a document's link to a `.table` names, read from disk for drawing
 * in place (embed.ts's readEmbedWith, over the disk as Node sees it, with
 * its large tables' rows left to the index and the folder check made of
 * where links really lead).
 */
export async function readEmbed({ address, baseDir, within }: EmbedTarget): Promise<EmbedRead> {
  return readEmbedWith(nodeFs, { address, baseDir: resolve(baseDir), ...(within === undefined ? {} : { within: resolve(within) }) }, {
    rowsElsewhere: largeTables(INDEXED_FROM),
    real: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
  });
}

/** An embedded table's files on disk, for `./react`'s useEmbeddedTable: edits written where the file was read from, and each to its table's history. */
export const embedFiles: EmbeddedTableFiles = {
  write: saveBundle,
  appendHistory: (library, key, events) => appendHistory(join(library.paths[bundleOf(key)]!, "tables", tableNameOf(key)), events),
};

/**
 * A `.table` opened as a document of its own (a folder, or a `.table.zip`):
 * the file as an app holds it, on its first table in its first view. A
 * folder is written back where it is. A `.table.zip` is read into memory
 * and has nowhere to be written (`library.paths` is empty), so it is to look
 * at. A large table comes back without its rows, as an embed's does.
 */
export async function readTableFile(path: string): Promise<EmbedRead> {
  const file = basename(path);
  let isFolder: boolean;
  try {
    isFolder = statSync(path).isDirectory();
  } catch {
    return embedProblem(`“${file}” isn’t there any more.`);
  }
  let library: Library;
  if (isFolder) {
    library = await loadLibrary([path], [], { indexedFrom: INDEXED_FROM });
  } else {
    try {
      const opened = await openArchive(new Uint8Array(readFileSync(path)), []);
      library = { tables: fromBundle(opened.key, opened.bundle), bundles: { [opened.key]: opened.bundle.meta }, paths: {}, problems: {} };
    } catch (error) {
      return embedProblem(`“${file}” couldn’t be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const key = firstTableKey(library.tables);
  if (key === undefined) {
    const why = Object.values(library.problems).flat()[0];
    return embedProblem(why ? `“${file}” couldn’t be read: ${why}` : `“${file}” isn’t a .table, or it holds no tables.`);
  }
  return { kind: "shown", library, key, viewId: library.tables[key]!.views[0]?.id ?? "", size: {} };
}
