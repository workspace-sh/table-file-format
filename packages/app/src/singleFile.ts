// Editing a single-file `.table` (SPEC section 13, D49, D50) the way
// Numbers edits its single-file documents: unpacked into a working folder
// in the app's own storage, edited there as any `.table` folder (its index,
// its history and its attachments all as a folder has them, the index
// outside the document as section 13 asks), and packed back into the file
// after each write. Over any platform's files (a TableFs with readBytes and
// writeBytes); the platform gives the folder its storage, and the file's
// own access. Neither way parses the document: unpacking inflates each
// file to its own, and packing copies the files that didn't change as they
// are, so a table of a million rows opens and saves for what its bytes cost.

import { packTableFileFrom, unpackTableFileTo } from "@workspace.sh/table-core";
import { joinPath, type TableFs } from "@workspace.sh/table-core/io";

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
  await fs.remove(workDir);
  await unpackTableFileTo(fs, bytes, workDir);
  await fs.writeText(stampOf(workDir), stamp);
}

/**
 * The file changed since its working folder was made from it (or last
 * packed into it): another app, another copy of this one, a sync. Packing
 * would write over that, so it isn't packed; the edits stay in the working
 * folder.
 */
export class ChangedElsewhere extends Error {
  constructor(readonly target: string) {
    super(`${target.slice(target.lastIndexOf("/") + 1)} was changed somewhere else since it was opened here, so it wasn't saved over. Open it again to see it as it is now.`);
    this.name = "ChangedElsewhere";
  }
}

/**
 * Pack a working folder back into the single file at `target`: every file
 * of the document's (its tables, histories, attachments and files no reader
 * knows, never the index), those unchanged since the file was written
 * copied from it as they are; written beside the file and renamed over it.
 * `now` is the file's stamp as it is now: when it isn't the one the working
 * folder was made from, the file changed elsewhere, and it's left as it is
 * (ChangedElsewhere).
 */
export async function packTableFile(fs: TableFs, workDir: string, target: string, now?: string): Promise<void> {
  if (now !== undefined) {
    const made = await fs.readText(stampOf(workDir));
    if (made !== null && made !== now) throw new ChangedElsewhere(target);
  }
  await packTableFileFrom(fs, workDir, target);
}

/** After a pack, the stamp of the file as it now is: so the next open keeps the working folder. */
export async function restampTableFile(fs: TableFs, workDir: string, stamp: string): Promise<void> {
  await fs.writeText(stampOf(workDir), stamp);
}
