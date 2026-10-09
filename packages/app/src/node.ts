// table-app's library over node:fs: opening `.table` folders from disk and
// saving them back (the logic is `./library`'s, over any TableFs), plus
// two things only a Node app does. A subpath, `@workspace.sh/table-app/node`,
// as core keeps its node:fs adapter apart.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

import { attachmentName, openLibrary, writeLibraryBundle, type Library } from "./library.ts";
import { largeTables } from "./nodeIndex.ts";
import type { KeyValueStore } from "./savedTables.ts";

export { bundleKey, type Library } from "./library.ts";
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
 * Copies of the `.table` folders in `from`, in `to`, made once: a copy
 * already there is left as it is, edits and all. For demos, which edit
 * examples without touching the originals.
 */
export function copiesOf(from: string, to: string): string[] {
  return bundlesIn(from).map((source) => {
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
