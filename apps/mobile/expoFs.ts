// Core's TableFs over expo-file-system, so the phone reads and writes
// .table folders through core's reader and writer (SPEC section 1, D24),
// the same code Linux runs over node:fs and the Mac over its own.
//
// Paths here are the `file://` URLs expo-file-system speaks, joined with
// `/` like any path. rename is one rename(2) (modules/table-files): the
// file manager behind expo-file-system won't move a file onto one that
// exists, and removing the target first isn't atomic.

import { Directory, File, Paths } from "expo-file-system";
import type { TableFs } from "@workspace.sh/table-core/io";
import { renameOver } from "./modules/table-files";

/** A `file://` URL as the path the file system knows it by. */
export const pathOfUri = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//, ""));

export const expoFs: TableFs = {
  async readText(path) {
    const file = new File(path);
    // Missing is a value, not an error; anything else still throws.
    return file.exists ? file.text() : null;
  },
  async writeText(path, content) {
    const file = new File(path);
    if (!file.exists) file.create();
    file.write(content);
  },
  async rename(from, to) {
    renameOver(pathOfUri(from), pathOfUri(to));
  },
  async mkdir(path) {
    // Creates any missing parents, and is fine when it's already there.
    new Directory(path).create({ intermediates: true, idempotent: true });
  },
  async list(path) {
    const dir = new Directory(path);
    if (!dir.exists) return null;
    return dir.list().map((entry) => ({ name: entry.name, directory: entry instanceof Directory }));
  },
  async remove(path) {
    // A file or a directory: whichever is there.
    const info = Paths.info(path);
    if (!info.exists) return;
    if (info.isDirectory) new Directory(path).delete();
    else new File(path).delete();
  },
};

/**
 * Where the phone keeps the .table folders it holds as files: a folder of
 * the app's own in its documents, apart from anything else there. (Its
 * name is the app's choice; it isn't the format's `tables/`.)
 */
export const tablesHome = (): string => new Directory(Paths.document, "tables").uri.replace(/\/+$/, "");
