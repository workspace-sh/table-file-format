// The phone's indexes (SPEC section 8): table-app's shared index host over
// expo-file-system and expo-sqlite (@workspace.sh/table-files' expoIndexHost,
// which Workspace runs too). The Mac runs the same host over its own
// (apps/desktop).

import { Directory, Paths } from "expo-file-system";
import { expoIndexHost } from "@workspace.sh/table-files";

export type { IndexDatabase, OpenedLarge } from "@workspace.sh/table-app";

/**
 * Where the phone keeps the .table folders it holds as files: a folder of
 * the app's own in its documents, apart from anything else there. (Its
 * name is the app's choice; it isn't the format's `tables/`.)
 */
export const tablesHome = (): string => new Directory(Paths.document, "tables").uri.replace(/\/+$/, "");

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

export const { bundleDir, openZip, openIndexDatabase, removeFolder, removeAllFolders } = expoIndexHost({
  home: tablesHome,
  mode: DRIVER_MODE,
  yieldAfterMs: YIELD_AFTER_MS,
});
