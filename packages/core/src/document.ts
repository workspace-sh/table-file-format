// A `.table` as a document: a folder or a single file, the same document
// either way (SPEC section 13, DECISIONS D49 and D50). Which one is decided
// by what's on disk, never by its name; a document is saved in the form it
// was opened in; and a single-file save is the whole bundle, attachments
// and all, written beside the document and renamed over it.

import { readTableArchive, writeTableArchive, type ReadArchiveOptions } from "./archive.js";
import { joinPath, readBundle, type ReadOptions, type TableFs, type WriteBundleInput } from "./io.js";
import { BODY_EXTENSION, BUNDLE_EXTENSION, BundleEntry, TableEntry } from "./layout.js";
import { isRowsFileName } from "./rowFiles.js";
import type { ParsedBundle } from "./types.js";

/** A `.table` on disk: the directory (`folder`), or a single file holding it (`file`). */
export type TableForm = "folder" | "file";

/** Which form the `.table` at `path` is, by what's there; null when there's nothing. */
export async function tableFormOf(fs: TableFs, path: string): Promise<TableForm | null> {
  if ((await fs.list(path)) !== null) return "folder";
  if (!fs.readBytes) throw new Error("this file system can't read a single-file .table (no readBytes)");
  return (await fs.readBytes(path)) === null ? null : "file";
}

/** A `.table` read in whichever form it is, and which. */
export interface TableDocument {
  form: TableForm;
  bundle: ParsedBundle;
}

/**
 * Read the `.table` at `path`, a folder or a single file. A single file's
 * attachments and other files come back in `bundle.files`, for its save.
 */
export async function readTableDocument(fs: TableFs, path: string, options: ReadOptions & ReadArchiveOptions = {}): Promise<TableDocument> {
  const form = await tableFormOf(fs, path);
  if (form === null) throw new Error(`${path} isn't there`);
  if (form === "folder") return { form, bundle: await readBundle(fs, path, options) };
  const bundle = await readTableArchive((await fs.readBytes!(path))!, options);
  return { form, bundle: { ...bundle, path } };
}

/** A folder's files a bundle's parsed text doesn't hold, which a single file carries as they are. */
const ownText = (inside: string): boolean => {
  if (inside === BundleEntry.meta) return true;
  const parts = inside.split("/");
  if (parts[0] !== BundleEntry.tables || parts.length < 3) return false;
  const rest = parts.slice(2).join("/");
  if (([TableEntry.schema, TableEntry.rows, TableEntry.views, TableEntry.meta] as string[]).includes(rest)) return true;
  // Its rows files (D51).
  if (parts.length === 4 && parts[2] === TableEntry.rowsDir && isRowsFileName(parts[3]!)) return true;
  return parts.length === 4 && parts[2] === TableEntry.bodies && rest.endsWith(BODY_EXTENSION);
};

/**
 * Everything in a folder-form `.table` besides what its tables' text is
 * written from: `attachments/`, each table's `history.ndjson`, and files no
 * reader knows, by path inside the folder. Never the index, nor a staged
 * `*.tmp`. Read to save the folder as a single file, which carries them.
 */
export async function filesOfFolder(fs: TableFs, dir: string): Promise<Record<string, Uint8Array>> {
  if (!fs.readBytes) throw new Error("this file system can't read files as bytes (no readBytes)");
  const found: Record<string, Uint8Array> = {};
  const walk = async (inside: string): Promise<void> => {
    for (const entry of (await fs.list(joinPath(dir, inside))) ?? []) {
      const path = inside === "" ? entry.name : `${inside}/${entry.name}`;
      if (entry.directory) await walk(path);
      else if (!ownText(path) && !/^index\.sqlite/.test(entry.name) && !entry.name.endsWith(".tmp") && entry.name !== ".DS_Store") {
        const bytes = await fs.readBytes!(joinPath(dir, path));
        if (bytes) found[path] = bytes;
      }
    }
  };
  await walk("");
  return found;
}

/**
 * Save a bundle as the single-file `.table` at `path`: the whole bundle,
 * its `files` included, written to `<path>.tmp` beside it and renamed over
 * it, so a reader sees the old file or the new one, never part of either.
 */
export async function writeTableFileTo(fs: TableFs, path: string, input: WriteBundleInput | ParsedBundle): Promise<void> {
  if (!fs.writeBytes) throw new Error("this file system can't write a single-file .table (no writeBytes)");
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!name.endsWith(BUNDLE_EXTENSION)) throw new Error(`a .table's name ends ${BUNDLE_EXTENSION}: ${name}`);
  const bytes = await writeTableArchive(name, input);
  const staged = `${path}.tmp`;
  await fs.writeBytes(staged, bytes);
  try {
    await fs.rename(staged, path);
  } catch (error) {
    await fs.remove(staged).catch(() => {});
    throw error;
  }
}
