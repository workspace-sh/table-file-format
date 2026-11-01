// The .table library's files and indexes over Expo (expo-file-system and
// expo-sqlite), for the apps on iOS: the .table app and Workspace read and
// write tables through core's reader and writer (SPEC section 1, D24), the
// same code Linux runs over node:fs and the Mac over its own.
//
// Paths here are the `file://` URLs expo-file-system speaks, joined with `/`
// like any path. rename is one rename(2) (index.ts): the file manager behind
// expo-file-system won't move a file onto one that exists, and removing the
// target first isn't atomic.

import { Directory, File, Paths } from "expo-file-system";
import { openDatabaseSync } from "expo-sqlite";
import { BundleEntry } from "@workspace.sh/table-core";
import type { TableFs } from "@workspace.sh/table-core/io";
import { expoDriver } from "@workspace.sh/table-core/sqlite-expo";
import { createIndexHost } from "@workspace.sh/table-app";
import { renameOver } from "./index";

/** A `file://` URL as the path the file system knows it by. */
export const pathOfUri = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//, ""));

/** The last part of a URL's path, decoded: an entry's name. */
const lastPart = (uri: string): string => {
  const path = uri.replace(/\/+$/, "");
  return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
};

export const expoFs: TableFs = {
  async readText(path) {
    const file = new File(path);
    // Missing is a value, not an error; anything else still throws.
    return file.exists ? file.text() : null;
  },
  async writeText(path, content) {
    const file = new File(path);
    if (!file.exists) file.create();
    // Asynchronous since Expo SDK 58: awaited, or a rename after it moves an empty or partial file into place.
    await file.write(content);
  },
  // A single-file .table, and the files a folder holds besides its text (D49): native bytes, never base64.
  async readBytes(path) {
    const file = new File(path);
    return file.exists ? file.bytes() : null;
  },
  async writeBytes(path, bytes) {
    const file = new File(path);
    if (!file.exists) file.create();
    await file.write(bytes);
  },
  // For judging how many rows a table has before reading them (core's shape-first read).
  async size(path) {
    const file = new File(path);
    return file.exists ? file.size : null;
  },
  async readHead(path, bytes) {
    const file = new File(path);
    if (!file.exists) return null;
    const handle = file.open();
    try {
      // readBytes is asynchronous since Expo SDK 58: awaited, so the handle isn't closed before it reads.
      return await handle.readBytes(Math.min(bytes, file.size));
    } finally {
      handle.close();
    }
  },
  async rename(from, to) {
    renameOver(pathOfUri(from), pathOfUri(to));
  },
  async mkdir(path) {
    // Creates any missing parents, and is fine when it's already there.
    new Directory(path).create({ intermediates: true, idempotent: true });
  },
  async list(path) {
    const directory = new Directory(path);
    if (!directory.exists) return null;
    // The entries as the native module gives them: a URL and whether it's a
    // folder. `list()` makes a File or Directory of each, which works out
    // its path and name by parsing URLs in JavaScript: about 300 ms of a
    // document of table embeds opening. The records call is the one `list()`
    // is made from, but internal to expo-file-system, so `list()` stands in
    // should it go.
    const records = (directory as { listAsRecords?: () => { uri: string; isDirectory: boolean | string }[] }).listAsRecords?.();
    if (!records) return directory.list().map((entry) => ({ name: entry.name, directory: entry instanceof Directory }));
    return records.map(({ uri, isDirectory }) => ({ name: lastPart(uri), directory: isDirectory === true || isDirectory === "true" }));
  },
  async remove(path) {
    // A file or a directory: whichever is there.
    const info = Paths.info(path);
    if (!info.exists) return;
    if (info.isDirectory) new Directory(path).delete();
    else new File(path).delete();
  },
};

// expo-sqlite would finalize FTS5's own statements as it closes, and FTS5 them again (core's sqlite-expo.ts).
const OPEN = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false };

export interface ExpoIndexHostOptions {
  /** Where large tables' working folders and indexes live: a folder of the app's own. */
  home: () => string;
  /**
   * How the index's statements are run while building it, and how often a
   * build lets the event loop take a turn (docs/LARGE-TABLES.md, "on a
   * phone"): the driver's defaults unless an app measures otherwise. A save
   * reads on its own connection, asynchronously, either way.
   */
  mode?: "async" | "sync";
  yieldAfterMs?: number;
}

/**
 * A large .table's index (SPEC section 8): table-app's shared index host
 * over expo-file-system and expo-sqlite, whose statements run on its own
 * queue, so nothing needs a worker; the SQL is the indexer's, run by core's
 * expoDriver. A large single-file table opens at once with its first rows,
 * and the rest go into the index behind them.
 */
export function expoIndexHost({ home, mode = "async", yieldAfterMs = 0 }: ExpoIndexHostOptions) {
  return createIndexHost({
    fs: expoFs,
    home,
    async size(path) {
      const file = new File(path);
      return file.exists ? file.size : null;
    },
    async writer(path) {
      const file = new File(path);
      if (file.exists) file.delete();
      file.create();
      const handle = file.open();
      return { write: (bytes) => handle.writeBytes(bytes), close: () => handle.close() };
    },
    // readBytes is asynchronous since Expo SDK 58: each piece is awaited, never handed on as a promise.
    async *pieces(path, size, step) {
      const handle = new File(path).open();
      try {
        for (let at = 0; at < size; at += step) yield await handle.readBytes(Math.min(step, size - at));
      } finally {
        handle.close();
      }
    },
    async openDatabase(dir, role) {
      const db = openDatabaseSync(BundleEntry.index, OPEN, pathOfUri(dir));
      if (role === "reader") return expoDriver(db, "async");
      return expoDriver(db, mode, yieldAfterMs > 0 ? { yieldAfterMs } : {});
    },
    /**
     * Rows per statement in a build. In sync mode a yield can only come
     * between statements, so the longest the screen waits is the longest
     * statement: a smaller batch shortens it at no cost to the build (0.22 s
     * at 1,000 against 0.35 s at core's 5,000, in the Simulator). In async
     * mode it changes nothing.
     */
    ...(mode === "sync" ? { batchSize: 1000 } : {}),
  });
}
