// Editing a single-file `.table` (SPEC section 13, D49, D50) the way
// Numbers edits its single-file documents: unpacked into a working folder
// in the app's own storage, edited there as any `.table` folder (its index,
// its history and its attachments all as a folder has them, the index
// outside the document as section 13 asks), and packed back into the file
// after each write. Over any platform's files (a TableFs with readBytes and
// writeBytes); the platform gives the folder its storage, and the file's
// own access.

import { filesOfFolder, readTableArchive, writeTableFileTo } from "@workspace.sh/table-core";
import { joinPath, readBundle, writeBundleTo, type TableFs } from "@workspace.sh/table-core/io";

/** A short, stable name for a path, for its working folder: FNV-1a, 32 bits, as hex. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The working folder of the single-file `.table` at `path`, in the app's
 * own storage `home`: `<home>/<hash of path>/<name>.table`, so files of one
 * name in different places don't share one, and the folder keeps the
 * document's name.
 */
export function workDirFor(home: string, path: string): string {
  return joinPath(home, hashOf(path), path.slice(path.lastIndexOf("/") + 1));
}

const stampOf = (workDir: string) => `${workDir}.stamp`;

/**
 * The working folder for a single file's `bytes`, made fresh from them
 * unless it was made from the same file before (`stamp`, which the platform
 * gives: its size and time, or a hash), in which case it's kept as it is,
 * its index with it.
 */
export async function unpackTableFile(fs: TableFs, bytes: Uint8Array, workDir: string, stamp: string): Promise<void> {
  if ((await fs.readText(stampOf(workDir))) === stamp && (await fs.list(workDir)) !== null) return;
  if (!fs.writeBytes) throw new Error("this file system can't write a single-file .table's files (no writeBytes)");
  await fs.remove(workDir);
  await fs.mkdir(workDir);
  const bundle = await readTableArchive(bytes);
  await writeBundleTo(fs, workDir, bundle);
  // Its attachments, and files no reader knows, as they are.
  for (const [path, data] of Object.entries(bundle.files ?? {})) {
    const at = joinPath(workDir, path);
    await fs.mkdir(at.slice(0, at.lastIndexOf("/")));
    await fs.writeBytes(at, data);
  }
  await fs.writeText(stampOf(workDir), stamp);
}

/** A `.gitignore` the index host wrote to keep its index out of git, which isn't the document's. */
const indexIgnore = (text: string) => text.split(/\r?\n/).every((line) => line.trim() === "" || line.trim() === "index.sqlite*");

/**
 * Pack a working folder back into the single file at `target`: the whole
 * bundle (its tables, histories, attachments and files no reader knows,
 * never the index), written beside the file and renamed over it.
 */
export async function packTableFile(fs: TableFs, workDir: string, target: string): Promise<void> {
  const bundle = await readBundle(fs, workDir);
  const files = await filesOfFolder(fs, workDir);
  const ignore = files[".gitignore"];
  if (ignore && indexIgnore(new TextDecoder().decode(ignore))) delete files[".gitignore"];
  await writeTableFileTo(fs, target, { ...bundle, files });
}

/** After a pack, the stamp of the file as it now is: so the next open keeps the working folder. */
export async function restampTableFile(fs: TableFs, workDir: string, stamp: string): Promise<void> {
  await fs.writeText(stampOf(workDir), stamp);
}
