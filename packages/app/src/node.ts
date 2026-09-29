// table-app's library over node:fs: opening `.table` folders from disk and
// saving them back (the logic is `./library`'s, over any TableFs), plus
// two things only a Node app does. A subpath, `@workspace.sh/table-app/node`,
// as core keeps its node:fs adapter apart.

import { cpSync, existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";

import { openLibrary, writeLibraryBundle, type Library } from "./library.ts";

export { bundleKey, type Library } from "./library.ts";

/** The `.table` folders in `dir`, sorted by name. */
export function bundlesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith(".table"))
    .map((e) => join(dir, e.name))
    .sort();
}

/** Read each `.table` folder in `paths` from disk (relative to the working directory). `held`: see openLibrary. */
export function loadLibrary(paths: string[], held: Iterable<string> = []): Promise<Library> {
  return openLibrary(nodeFs, paths.map((p) => resolve(p)), held);
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
