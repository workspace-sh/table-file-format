// A `.table` as a document: a folder or a single file, the same document
// either way (SPEC section 13, DECISIONS D49 and D50). Which one is decided
// by what's on disk, never by its name; a document is saved in the form it
// was opened in; and a single-file save is the whole bundle, attachments
// and all, written beside the document and renamed over it.

import { readTableArchive, writeTableArchive, type ReadArchiveOptions } from "./archive.js";
import { joinPath, readBundle, type ReadOptions, type TableFs, type WriteBundleInput } from "./io.js";
import { BODY_EXTENSION, BUNDLE_EXTENSION, BundleEntry, TableEntry } from "./layout.js";
import { isRowsFileName } from "./rowFiles.js";
import { crc32, rawChunks, readZipRaw, writeZipEntries, type RawZipEntry, type ZipEntry } from "./zip.js";
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

/** Paths in a document's folder that aren't the document's: its index, files being written, Finder's leftovers. */
const notTheDocument = (name: string): boolean => /^index\.sqlite/.test(name) || name.endsWith(".tmp") || name === ".DS_Store";

/** A `.gitignore` the index host wrote to keep its index out of git, which isn't the document's either. */
const indexIgnore = (text: string): boolean => text.split(/\r?\n/).every((line) => line.trim() === "" || line.trim() === "index.sqlite*");

/**
 * Unpack the single-file `.table` in `bytes` into the folder `dir`, each
 * file inflated straight to its own file: nothing is parsed, so a table of
 * a million rows costs what its bytes cost. The folder is the document as
 * its file holds it; reading it is the reader's work, as for any folder.
 * Throws for a file that isn't one `<name>.table/` root.
 */
export async function unpackTableFileTo(fs: TableFs, bytes: Uint8Array, dir: string): Promise<void> {
  if (!fs.writeBytes) throw new Error("this file system can't write a single-file .table's files (no writeBytes)");
  const entries = readZipRaw(bytes).filter((e) => !isJunkEntry(e.name));
  const roots = new Set(entries.map((e) => e.name.split("/")[0]!));
  const root = [...roots][0];
  if (roots.size !== 1 || !root?.endsWith(BUNDLE_EXTENSION) || entries.some((e) => !e.name.includes("/"))) {
    throw new Error(`a single-file .table holds one <name>${BUNDLE_EXTENSION} folder`);
  }
  await fs.mkdir(dir);
  for (const entry of entries) {
    const inside = entry.name.slice(root.length + 1);
    if (notTheDocument(inside.slice(inside.lastIndexOf("/") + 1))) continue;
    const at = joinPath(dir, inside);
    await fs.mkdir(at.slice(0, at.lastIndexOf("/")));
    await fs.writeBytes(at, joined([...rawChunks(entry)], entry.size));
  }
}

/**
 * Pack the folder `dir` into the single file at `target`, as unpacked into
 * it: every file of the document's (never its index), read one at a time.
 * A file the target already holds with the same size and CRC-32 is copied
 * from it as it is, compressed bytes and all; only files that changed are
 * compressed again (with D51 that is usually one rows file). Written beside
 * the target and renamed over it.
 */
export async function packTableFileFrom(fs: TableFs, dir: string, target: string): Promise<void> {
  if (!fs.readBytes || !fs.writeBytes) throw new Error("this file system can't read and write files as bytes");
  const name = target.slice(target.lastIndexOf("/") + 1);
  if (!name.endsWith(BUNDLE_EXTENSION)) throw new Error(`a .table's name ends ${BUNDLE_EXTENSION}: ${name}`);
  const before = await fs.readBytes(target);
  const held = new Map<string, RawZipEntry>();
  if (before) {
    try {
      for (const e of readZipRaw(before)) held.set(e.name, e);
    } catch {
      // Not an archive we can read: everything is compressed again.
    }
  }
  const paths: string[] = [];
  const walk = async (inside: string): Promise<void> => {
    for (const entry of (await fs.list(joinPath(dir, inside))) ?? []) {
      const path = inside === "" ? entry.name : `${inside}/${entry.name}`;
      if (entry.directory) await walk(path);
      else if (!notTheDocument(entry.name)) paths.push(path);
    }
  };
  await walk("");
  // The manifest first, then the rest in byte order: the same folder packs in the same order.
  paths.sort((a, b) => (a === BundleEntry.meta ? -1 : b === BundleEntry.meta ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const entries: (ZipEntry | RawZipEntry)[] = [];
  for (const path of paths) {
    const data = await fs.readBytes(joinPath(dir, path));
    if (!data) continue;
    if (path === ".gitignore" && indexIgnore(new TextDecoder().decode(data))) continue;
    const entryName = `${name}/${path}`;
    const old = held.get(entryName);
    entries.push(old && old.size === data.length && old.crc === crc32(data) ? old : { name: entryName, data });
  }
  const staged = `${target}.tmp`;
  await fs.writeBytes(staged, writeZipEntries(entries));
  try {
    await fs.rename(staged, target);
  } catch (error) {
    await fs.remove(staged).catch(() => {});
    throw error;
  }
}

function joined(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** What zip tools add that isn't a document's: macOS's resource forks and Finder and Explorer's leftovers. */
function isJunkEntry(name: string): boolean {
  if (name.startsWith("__MACOSX/")) return true;
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base === ".DS_Store" || base === "Thumbs.db";
}
