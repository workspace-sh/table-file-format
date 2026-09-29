// Opening `.table` folders from disk into what an app holds: every table
// by its `bundle/table` key, each bundle's manifest, where it came from and
// what was wrong reading it. Node only (it reads the filesystem), so it's
// a subpath, as core keeps its parser: `@workspace.sh/table-app/node`.

import { readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseBundle } from "@workspace.sh/table-core/parser";
import type { BundleMeta, ParsedBundle, ParsedTable } from "@workspace.sh/table-core";

import { fromBundle } from "./bundles.ts";

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
