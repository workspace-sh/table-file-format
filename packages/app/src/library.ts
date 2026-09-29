// Opening `.table` folders into what an app holds, over any file system
// (core's `TableFs`): every table by its `bundle/table` key, each bundle's
// manifest, where it came from and what was wrong reading it; and writing
// a bundle back. No Node here: a React Native app passes its own TableFs.
// `./node` runs the same over node:fs.

import { readBundle, writeBundleTo, type TableFs } from "@workspace.sh/table-core/io";
import type { BundleMeta, ParsedBundle, ParsedTable } from "@workspace.sh/table-core";

import { fromBundle, toBundle } from "./bundles.ts";

export interface Library {
  /** Every table, keyed `bundle/table` as table-app keys them. */
  tables: Record<string, ParsedTable>;
  /** Each bundle's manifest, by bundle key. */
  bundles: Record<string, BundleMeta>;
  /** Where each bundle was read from. */
  paths: Record<string, string>;
  /** Problems reading a bundle, by bundle key. Shown, never thrown. */
  problems: Record<string, string[]>;
}

/** A bundle's key: its folder's name without `.table` (D37), unique among `taken`. */
export function bundleKey(path: string, taken: Set<string>): string {
  const name = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const base = name.replace(/\.table$/i, "") || "table";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

/**
 * Read each `.table` folder in `paths`. A folder that can't be read is a
 * problem, not a throw. `held` is the bundle keys an app already has: a
 * folder named like one gets a new key (`projects-2`) instead of replacing
 * it when the two libraries are merged.
 */
export async function openLibrary(fs: TableFs, paths: string[], held: Iterable<string> = []): Promise<Library> {
  const library: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const taken = new Set<string>(held);
  for (const path of paths) {
    const key = bundleKey(path, taken);
    taken.add(key);
    let bundle: ParsedBundle;
    try {
      bundle = await readBundle(fs, path);
    } catch (error) {
      library.problems[key] = [error instanceof Error ? error.message : String(error)];
      continue;
    }
    Object.assign(library.tables, fromBundle(key, bundle));
    library.bundles[key] = bundle.meta;
    library.paths[key] = path;
    const messages = (bundle.diagnostics ?? []).map((d) => d.message);
    if (messages.length > 0) library.problems[key] = messages;
  }
  return library;
}

/**
 * Write one bundle of an app's tables back to where it was read from, by
 * core's writer (atomic per file, SPEC section 1). An app calls it after
 * edits; which bundles changed, and when to write, are the app's to say.
 */
export async function writeLibraryBundle(
  fs: TableFs,
  library: Library,
  tables: Record<string, ParsedTable>,
  bundles: Record<string, BundleMeta>,
  key: string,
): Promise<void> {
  const path = library.paths[key];
  if (!path) throw new Error(`no path for bundle ${JSON.stringify(key)}`);
  await writeBundleTo(fs, path, toBundle(tables, bundles, key));
}
