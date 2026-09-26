// The fixtures, for tests: every bundle under fixtures/ and the tables in
// them (D37). Found by globbing, so a new fixture is picked up at once.

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseBundle } from "./parser.js";
import type { ParsedBundle, ParsedTable } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const fixturesDir = resolve(here, "..", "..", "..", "fixtures");

/** Every fixture bundle, keyed by its name: the directory's name without `.table`. */
export async function fixtureBundles(): Promise<Record<string, ParsedBundle>> {
  const names = (await readdir(fixturesDir)).filter((n) => n.endsWith(".table")).sort();
  const bundles: Record<string, ParsedBundle> = {};
  for (const name of names) bundles[name.slice(0, -".table".length)] = await parseBundle(resolve(fixturesDir, name));
  return bundles;
}

/** One fixture table by its name, from whichever bundle holds it. */
export async function fixtureTable(name: string): Promise<ParsedTable> {
  for (const bundle of Object.values(await fixtureBundles())) {
    if (bundle.tables[name]) return bundle.tables[name]!;
  }
  throw new Error(`no fixture table named ${name}`);
}
