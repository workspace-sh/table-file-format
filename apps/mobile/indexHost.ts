// The phone's indexes (SPEC section 8): table-app's shared index host
// (packages/app/src/indexHost.ts) over this platform's files and SQLite.
// SQLite here is expo-sqlite, whose statements run on its own queue, so
// nothing needs a worker of ours; the SQL is the indexer's, run by core's
// expoDriver. The Mac runs the same host over its own (apps/desktop).

import { openDatabaseSync } from "expo-sqlite";
import { File } from "expo-file-system";
import { BundleEntry } from "@workspace.sh/table-core";
import { createIndexHost } from "@workspace.sh/table-app";
import { expoDriver } from "@workspace.sh/table-core/sqlite-expo";
import { expoFs, pathOfUri, tablesHome } from "./expoFs";

export type { IndexDatabase, OpenedLarge } from "@workspace.sh/table-app";

// expo-sqlite would finalize FTS5's own statements as it closes, and FTS5 them again (core's sqlite-expo.ts).
const OPEN = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false };

/**
 * How the index's statements are run, and how often a build lets the event
 * loop take a turn. On a phone a build over the async driver holds React
 * Native's timers and React's renders up for seconds, which the Simulator
 * doesn't show; a yield shortens the wait and lengthens the build
 * (docs/LARGE-TABLES.md, "on a phone"). Which mode and yield a phone should
 * have isn't measured yet, so these are the driver's defaults, and a build
 * made to measure can set them: EXPO_PUBLIC_TABLE_INDEX_MODE=sync,
 * EXPO_PUBLIC_TABLE_INDEX_YIELD_MS=30.
 */
const DRIVER_MODE: "async" | "sync" = process.env.EXPO_PUBLIC_TABLE_INDEX_MODE === "sync" ? "sync" : "async";
const YIELD_AFTER_MS = Number(process.env.EXPO_PUBLIC_TABLE_INDEX_YIELD_MS ?? 0) || 0;

export const { bundleDir, openZip, openIndexDatabase, removeFolder, removeAllFolders } = createIndexHost({
  fs: expoFs,
  home: tablesHome,
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
  *pieces(path, size, step) {
    const handle = new File(path).open();
    try {
      for (let at = 0; at < size; at += step) yield handle.readBytes(Math.min(step, size - at));
    } finally {
      handle.close();
    }
  },
  async openDatabase(dir, role) {
    const db = openDatabaseSync(BundleEntry.index, OPEN, pathOfUri(dir));
    // A save reads on its own connection, asynchronously, so the screen's go on beside it.
    if (role === "reader") return expoDriver(db, "async");
    return expoDriver(db, DRIVER_MODE, YIELD_AFTER_MS > 0 ? { yieldAfterMs: YIELD_AFTER_MS } : {});
  },
  /**
   * Rows per statement in a build. In sync mode a yield can only come between
   * statements, so the longest the screen waits is the longest statement: a
   * smaller batch shortens it at no cost to the build (0.22 s at 1,000 against
   * 0.35 s at core's 5,000, in the Simulator). In async mode it changes nothing.
   */
  ...(DRIVER_MODE === "sync" ? { batchSize: 1000 } : {}),
});
