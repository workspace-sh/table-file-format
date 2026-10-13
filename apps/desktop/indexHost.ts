// The Mac's indexes (SPEC section 8, #435): table-app's shared index host
// (packages/app/src/indexHost.ts), as the phone runs it, over this
// platform's files (react-native-file-access, in the app's own folder in
// Application Support) and SQLite (op-sqlite over the system's own SQLite, which
// macOS builds with FTS5: "op-sqlite" in package.json). A bundle with a
// large table is a .table folder there, with `index.sqlite` beside its
// rows.

import { open } from "@op-engineering/op-sqlite";
import { Dirs, FileSystem } from "react-native-file-access";
import { BundleEntry } from "@workspace.sh/table-core";
import { joinPath } from "@workspace.sh/table-core/io";
import { createIndexHost } from "@workspace.sh/table-app";
import { opDriver, type OpDatabase } from "@workspace.sh/table-core/sqlite-op";
import { fromBase64, toBase64 } from "./bytes";
import { desktopFs } from "./desktopFs";

export type { IndexDatabase, OpenedLarge } from "@workspace.sh/table-app";

/**
 * Where the Mac keeps the .table folders it holds as files: the app's own
 * folder in Application Support, apart from anything of the person's (the
 * app isn't sandboxed, so Documents would be their own Documents).
 */
const tablesHome = (): string => joinPath(Dirs.LibraryDir ?? Dirs.DocumentDir, "Application Support", "sh.workspace.table.desktop", "tables");

export const { bundleDir, openZip, openIndexDatabase, removeFolder, removeAllFolders } = createIndexHost({
  fs: desktopFs,
  home: tablesHome,
  async size(path) {
    if (!(await FileSystem.exists(path))) return null;
    return (await FileSystem.stat(path)).size;
  },
  async writer(path) {
    await FileSystem.writeFile(path, "", "utf8");
    // Pieces are appended in the order written; close waits for the last.
    let written: Promise<void> = Promise.resolve();
    return {
      write: (bytes) => (written = written.then(() => FileSystem.appendFile(path, toBase64(bytes), "base64"))),
      close: () => written,
    };
  },
  async *pieces(path, size, step) {
    for (let at = 0; at < size; at += step) yield fromBase64(await FileSystem.readFileChunk(path, at, Math.min(step, size - at), "base64"));
  },
  async openDatabase(dir) {
    // op-sqlite's database matches core's structural one but for its wider value types.
    return opDriver(open({ name: BundleEntry.index, location: dir }) as unknown as OpDatabase);
  },
});
