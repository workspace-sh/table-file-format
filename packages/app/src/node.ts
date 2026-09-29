// Opening `.table` folders from disk into what an app holds: every table
// by its `bundle/table` key, each bundle's manifest, where it came from and
// what was wrong reading it. Node only (it reads the filesystem), so it's
// a subpath, as core keeps its parser: `@workspace.sh/table-app/node`.

import { cpSync, existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseBundle } from "@workspace.sh/table-core/parser";
import { writeBundle } from "@workspace.sh/table-core/writer";
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

/** The `.table` folders in `dir`, sorted by name. */
export function bundlesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith(".table"))
    .map((e) => join(dir, e.name))
    .sort();
}

/** A bundle's key: its folder's name without `.table` (D37), unique among `taken`. */
export function bundleKey(path: string, taken: Set<string>): string {
  const base = basename(path).replace(/\.table$/i, "") || "table";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

/** Read each `.table` folder in `paths`. A folder that can't be read is a problem, not a throw. */
export async function loadLibrary(paths: string[]): Promise<Library> {
  const library: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const taken = new Set<string>();
  for (const path of paths.map((p) => resolve(p))) {
    const key = bundleKey(path, taken);
    taken.add(key);
    let bundle: ParsedBundle;
    try {
      bundle = await parseBundle(path);
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
export async function saveBundle(library: Library, tables: Record<string, ParsedTable>, bundles: Record<string, BundleMeta>, key: string): Promise<void> {
  const path = library.paths[key];
  if (!path) throw new Error(`no path for bundle ${JSON.stringify(key)}`);
  await writeBundle(path, toBundle(tables, bundles, key));
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
