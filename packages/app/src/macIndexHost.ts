// A large .table's index on the Mac (SPEC section 8, #435): the shared index
// host (indexHost.ts) over react-native-file-access, for what's read and
// written a piece at a time, and op-sqlite over the system's own SQLite,
// which macOS builds with FTS5. The .table app on the Mac and Workspace's
// Mac app run it; each gives its own files (`fs`) and folder (`home`).
// (Its base64 helpers are core's, given here too for the Mac's files.)

import { open } from "@op-engineering/op-sqlite";
import { FileSystem } from "react-native-file-access";
import { BundleEntry, fromBase64, toBase64 } from "@workspace.sh/table-core";
import type { TableFs } from "@workspace.sh/table-core/io";
import { opDriver, type OpDatabase } from "@workspace.sh/table-core/sqlite-op";
import { createIndexHost } from "./indexHost.ts";

export { fromBase64, toBase64 };

export function macIndexHost({ fs, home }: { fs: TableFs; home: () => string }) {
  return createIndexHost({
    fs,
    home,
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
}
