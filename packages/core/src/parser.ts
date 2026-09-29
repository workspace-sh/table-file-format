import type { ParsedBundle, ParsedTable } from "./types.js";
import { readBundle, readTable } from "./io.js";
import { nodeFs } from "./node-fs.js";

/**
 * Parse a `.table` bundle from disk: its manifest and every table under
 * `tables/<name>/` (SPEC section 1, D37). `readBundle` in `./io` holds
 * the reader; this runs it over node:fs.
 */
export function parseBundle(dir: string): Promise<ParsedBundle> {
  return readBundle(nodeFs, dir);
}

/**
 * Parse one table's directory from disk, skip-and-collect (SPEC section 3,
 * D25), fatal only on a missing or malformed `schema.json`. `readTable` in
 * `./io` holds the reader; this runs it over node:fs.
 */
export function parseTable(dir: string): Promise<ParsedTable> {
  return readTable(nodeFs, dir);
}
