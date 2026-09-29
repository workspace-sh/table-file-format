import type { ParsedBundle, ParsedTable } from "./types.js";
import { writeBundleTo, writeTableTo, type WriteBundleInput, type WriteTableInput } from "./io.js";
import { nodeFs } from "./node-fs.js";

export type { WriteBundleInput, WriteTableInput } from "./io.js";

/**
 * Write a `.table/` directory to disk with the staged, near-atomic commit
 * of SPEC section 1 and D24 (stage to `*.tmp`, rename, trim last).
 * `writeTableTo` in `./io` holds the writer; this runs it over node:fs.
 */
export function writeTable(dir: string, input: WriteTableInput | ParsedTable): Promise<void> {
  return writeTableTo(nodeFs, dir, input);
}

/**
 * Write a `.table` bundle to disk (SPEC section 1, D37): every table, then
 * the manifest, then removing tables no longer in it. `writeBundleTo` in
 * `./io` holds the writer; this runs it over node:fs.
 */
export function writeBundle(dir: string, input: WriteBundleInput | ParsedBundle): Promise<void> {
  return writeBundleTo(nodeFs, dir, input);
}
