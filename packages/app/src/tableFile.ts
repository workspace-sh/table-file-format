// A .table opened as a document of its own, read over any platform's files
// (a TableFs): node.ts's readTableFile does the same over Node's. A folder
// is read where it is and written back there; a .table.zip is read into
// memory, has nowhere to be written (`library.paths` is empty), and is to
// look at.

import type { TableFs } from "@workspace.sh/table-core/io";

import { fromBundle } from "./bundles.ts";
import { embedProblem, type EmbedRead } from "./embed.ts";
import { openLibrary, type Library } from "./library.ts";
import { firstTableKey } from "./starting.ts";
import { openArchive } from "./tableFiles.ts";

/** The last part of a path or `file://` URL, without a trailing slash. */
const fileName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  return decodeURIComponent(trimmed.slice(trimmed.lastIndexOf("/") + 1));
};

/** What was read, on its first table in its first view; or why it can't be shown. */
function opened(library: Library, file: string): EmbedRead {
  const key = firstTableKey(library.tables);
  if (key === undefined) {
    const why = Object.values(library.problems).flat()[0];
    return embedProblem(why ? `“${file}” couldn’t be read: ${why}` : `“${file}” isn’t a .table, or it holds no tables.`);
  }
  return { kind: "shown", library, key, viewId: library.tables[key]!.views[0]?.id ?? "", size: {} };
}

/** A `.table` folder at `path`, read over `fs`. */
export async function readTableFileWith(fs: TableFs, path: string): Promise<EmbedRead> {
  const file = fileName(path);
  if ((await fs.list(path)) === null) return embedProblem(`“${file}” isn’t there any more.`);
  return opened(await openLibrary(fs, [path], []), file);
}

/** A `.table.zip`'s bytes, read into memory: to look at. */
export async function readTableArchiveFile(bytes: Uint8Array, file: string): Promise<EmbedRead> {
  try {
    const archive = await openArchive(bytes, []);
    return opened({ tables: fromBundle(archive.key, archive.bundle), bundles: { [archive.key]: archive.bundle.meta }, paths: {}, problems: {} }, file);
  } catch (error) {
    return embedProblem(`“${file}” couldn’t be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
