// A .table folder packed as a single-file .table (SPEC section 13, D49, D50), the same bytes every
// time: one <name>.table/ root, the manifest first and the rest in path order, each entry with a fixed
// time. Each is read back two ways before it's used: unzipped it is the folder byte for byte, and
// opened as an app opens a single file it is the same tables as the folder. Used by
// fixture-single-files.mts and fixtures-export.mts.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync, unzipSync } from "fflate";
import { readBundle } from "../packages/core/src/io.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";
import { openArchive } from "../packages/app/src/tableFiles.ts";

const FIXED = new Date(Date.UTC(2026, 9, 14, 0, 0, 0));

const walk = (at: string): string[] => readdirSync(at).flatMap((n) => (statSync(join(at, n)).isDirectory() ? walk(join(at, n)) : [join(at, n)]));

/** A folder's files, as paths inside it, in the order they're packed: what a .table holds, not an index or the system's own files. */
export function folderFiles(folder: string): string[] {
  return walk(folder)
    .map((f) => relative(folder, f))
    .filter((p) => !p.endsWith("index.sqlite") && !p.split("/").some((part) => part.startsWith(".")))
    .sort((a, b) => (a === "meta.json" ? -1 : b === "meta.json" ? 1 : a < b ? -1 : 1));
}

export interface Packed {
  bytes: Uint8Array;
  files: number;
  /** Unzipped, it is the folder byte for byte. */
  unzipsToFolder: boolean;
  /** Opened as an app opens a single file, it is the same tables as the folder read from disk. */
  opensAsFolder: boolean;
  sha256: string;
}

/** `<name>.table`, the folder at `folder`, as a single file. */
export async function packFolder(folder: string, name: string): Promise<Packed> {
  const files = folderFiles(folder);
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const p of files) entries[`${name}.table/${p}`] = [new Uint8Array(readFileSync(join(folder, p))), { mtime: FIXED }];
  const bytes = zipSync(entries, { level: 9 });
  const back = unzipSync(bytes);
  const unzipsToFolder =
    Object.keys(back).length === files.length &&
    files.every((p) => Buffer.compare(Buffer.from(back[`${name}.table/${p}`]!), readFileSync(join(folder, p))) === 0);
  const fromDisk = await readBundle(nodeFs, folder);
  const opened = (await openArchive(bytes, [])).bundle;
  const tablesOf = (b: { tables: Record<string, { rows: unknown[]; views: unknown[]; schema: unknown; bodies?: unknown }> }) =>
    JSON.stringify(Object.fromEntries(Object.entries(b.tables).sort().map(([k, t]) => [k, { rows: t.rows, views: t.views, schema: t.schema, bodies: t.bodies ?? {} }])));
  const opensAsFolder = tablesOf(fromDisk as never) === tablesOf(opened as never);
  return { bytes, files: files.length, unzipsToFolder, opensAsFolder, sha256: createHash("sha256").update(bytes).digest("hex") };
}
