// table-app's library over node:fs: opening `.table` folders from disk and
// saving them back (the logic is `./library`'s, over any TableFs), plus
// two things only a Node app does. A subpath, `@workspace.sh/table-app/node`,
// as core keeps its node:fs adapter apart.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { appendFile, mkdir, open } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { readTableRows } from "@workspace.sh/table-core/io";
import type { AppAction } from "./appState.ts";
import { HISTORY_FILE, parseAddress, serializeEditEvents, type BundleMeta, type EditEvent, type ParsedTable } from "@workspace.sh/table-core";

import { bundleOf, tableNameOf } from "./bundles.ts";
import { firstTableOfFile } from "./tableFile.ts";
import { settled } from "./heldFiles.ts";
import { embedProblem, readEmbedWith, withOtherFiles, type EmbeddedTableFiles, type EmbedRead, type EmbedTarget } from "./embed.ts";
import { INDEXED_FROM } from "./indexed.ts";
import { attachmentName, openLibrary, writeLibraryBundle, type Library } from "./library.ts";
import { largeTables } from "./nodeIndex.ts";
import { packTableFile, restampTableFile, unpackTableFile, workDirFor } from "./singleFile.ts";
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
 * the app to read through the bundle's index. With `rowsLater`, no table's
 * rows are read: each comes back `loading`, about how many it has, for
 * the app to draw at once and read them after (readRows); with
 * `indexedFrom` too, one judged to have that many or more is indexed.
 */
export async function loadLibrary(paths: string[], held: Iterable<string> = [], options: { indexedFrom?: number; rowsLater?: boolean } = {}): Promise<Library> {
  const resolved = paths.map((p) => resolve(p));
  if (!options.rowsLater) return openLibrary(nodeFs, resolved, held, options.indexedFrom === undefined ? {} : { rowsElsewhere: largeTables(options.indexedFrom) });
  const library = await openLibrary(nodeFs, resolved, held, { rows: "later" });
  if (options.indexedFrom !== undefined) {
    for (const [key, table] of Object.entries(library.tables)) {
      if (!table.loading || table.loading.estimate < options.indexedFrom) continue;
      const { loading: _, ...rest } = table;
      library.tables[key] = { ...rest, indexed: { count: 0, version: 0 } };
    }
  }
  return library;
}

/** A table opened without its rows (`loading`), read: the action that gives it them. */
export async function readRows(key: string, table: ParsedTable): Promise<Extract<AppAction, { type: "rowsRead" }>> {
  if (!table.path) throw new Error(`${key} has no folder to read its rows from`);
  const read = await readTableRows(nodeFs, table.path);
  return { type: "rowsRead", key, rows: read.rows, rowFiles: read.rowFiles, unread: read.unread, diagnostics: read.diagnostics };
}

// -- Single files ------------------------------------------------------------
//
// A single-file `.table` (SPEC section 13, D49) is edited as a working folder
// in this user's cache (singleFile.ts), and packed back into the file after
// each write to it: a bundle saved, a history appended, a large table's rows
// saved out of its index. Packs of one file run one after another, and those
// asked for while one runs are made once after it.

/** Where single files are unpacked to be edited: the XDG cache, as Linux keeps rebuildable things. */
export function singleFilesHome(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "workspace-table", "single-files");
}

const singleFiles = new Map<string, { target: string; running: Promise<void> | null; again: boolean }>();

/** A file's size and time, for knowing a working folder was made from it as it now is. */
const stampOf = (path: string) => {
  const s = statSync(path);
  return `${s.size}:${s.mtimeMs}`;
};

/**
 * Open the single-file `.table` at `path` to edit: unpacked to its working
 * folder (kept from before when the file hasn't changed since, its index
 * with it), and read from there as any folder. Writes to it are packed back
 * into the file.
 */
export async function openSingleFile(path: string, held: Iterable<string> = [], options: { indexedFrom?: number; rowsLater?: boolean; home?: string } = {}): Promise<Library> {
  const file = resolve(path);
  const workDir = workDirFor(options.home ?? singleFilesHome(), file);
  await unpackTableFile(nodeFs, new Uint8Array(readFileSync(file)), workDir, stampOf(file));
  singleFiles.set(workDir, { target: file, running: null, again: false });
  const library = await loadLibrary([workDir], held, options);
  const key = Object.keys(library.bundles)[0];
  if (key !== undefined) library.singleFiles = { [key]: file };
  return library;
}

/** The working folder of a single file `path` is in (a table's folder, say), if it's one. */
function workDirOf(path: string): string | undefined {
  for (const dir of singleFiles.keys()) if (path === dir || path.startsWith(`${dir}/`)) return dir;
  return undefined;
}

/**
 * Pack the single file whose working folder `path` is in back into it, once
 * what's being written has been: after a write to it. Nothing for a folder.
 */
export function packSingleFile(path: string): Promise<void> {
  const dir = workDirOf(path);
  const held = dir === undefined ? undefined : singleFiles.get(dir);
  if (!held || dir === undefined) return Promise.resolve();
  if (held.running) {
    held.again = true;
    return held.running;
  }
  const run = async (): Promise<void> => {
    do {
      held.again = false;
      await packTableFile(nodeFs, dir, held.target);
      await restampTableFile(nodeFs, dir, stampOf(held.target));
    } while (held.again);
  };
  held.running = run().finally(() => {
    held.running = null;
  });
  return held.running;
}

/**
 * Write one bundle of an app's tables back to where it was read from, by
 * core's writer (atomic per file, SPEC section 1). An app calls it after
 * edits; which bundles changed, and when to write, are the app's to say.
 */
export async function saveBundle(library: Library, tables: Record<string, ParsedTable>, bundles: Record<string, BundleMeta>, key: string): Promise<void> {
  await writeLibraryBundle(nodeFs, library, tables, bundles, key);
  // A single file's working folder: packed back into the file.
  const path = library.paths[key];
  if (path !== undefined) await packSingleFile(path);
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
  // A single file's: packed back into it.
  await packSingleFile(tableDir);
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
    // GTK's drop-in reads a large table through its index.
    readsIndex: true,
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
 * A `.table` opened as a document of its own (a folder, or a single file):
 * the file as an app holds it, on its first table in its first view. A
 * folder is written back where it is; a single file is edited as its working
 * folder and packed back into it (`openSingleFile`). A large table comes
 * back without its rows, as an embed's does.
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
    // After any write of it another view has under way.
    await settled(path);
    // With the .table files its relations name beside it (SPEC section 2).
    library = await withOtherFiles(nodeFs, await loadLibrary([path], [], { indexedFrom: INDEXED_FROM }), { rowsElsewhere: largeTables(INDEXED_FROM) });
  } else {
    try {
      // A single file: edited as its working folder, and packed back into it after each write.
      library = await openSingleFile(path, [], { indexedFrom: INDEXED_FROM });
    } catch (error) {
      return embedProblem(`“${file}” couldn’t be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // The file's first table, in the order its manifest gives.
  const key = firstTableOfFile(library);
  if (key === undefined) {
    const why = Object.values(library.problems).flat()[0];
    return embedProblem(why ? `“${file}” couldn’t be read: ${why}` : `“${file}” isn’t a .table, or it holds no tables.`);
  }
  return { kind: "shown", library, key, viewId: library.tables[key]!.views[0]?.id ?? "", size: {} };
}
