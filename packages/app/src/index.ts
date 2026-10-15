// What an app around the .table views does, whatever draws them: tables
// held by `bundle/table` key, a viewer's own sorts and filters kept apart
// from the saved views, display preferences, saved state over any
// key-value store, and single-file `.table`s in and out. The web and Linux
// demos both use it; nothing here touches a DOM or a toolkit.

export * from "./arrangements.ts";
export * from "./bundles.ts";
export * from "./displaySettings.ts";
export * from "./savedTables.ts";
export * from "./sidebarPrefs.ts";
export * from "./tableFiles.ts";
export * from "./singleFile.ts";
export * from "./tableKey.ts";
export * from "./showView.ts";
export * from "./edits.ts";
export type { EditLogState } from "./editLog.ts";
export { appendFolderHistory, appendStoredHistory, clearStoredHistory, forgetStoredHistories, HISTORY_KEY, keepArrivedHistories, storedHistory, withHistories } from "./editHistory.ts";
export * from "./creating.ts";
export * from "./sidebar.ts";
export * from "./library.ts";
export * from "./filesTree.ts";
export * from "./viewSummary.ts";
export * from "./confirm.ts";
export * from "./commands.ts";
export * from "./resetting.ts";
export * from "./closing.ts";
export * from "./breadcrumb.ts";
export * from "./history.ts";
export * from "./starting.ts";
export * from "./leaving.ts";
export * from "./appState.ts";
export * from "./embed.ts";
export * from "./heldFiles.ts";
export * from "./tableFile.ts";

export { createIndexHost, type ClosableDriver, type FileWriter, type IndexDatabase, type IndexHost, type IndexHostPlatform, type OpenedLarge } from "./indexHost.ts";
export { INDEXED_FROM, buildIndexFromBytes, firstRowsInBytes, linesInBytes, rowsInBytes, rowsInChunks, rowsInAsyncChunks, addIndexedRow, canBeIndexed, indexedViewRows, makeIndexEdits, removeIndexedRow, setIndexedBody, setIndexedCell, viewQuery, type IndexEdit } from "./indexed.ts";
export { remoteEdits, remoteViewRows, rowsServer, type RemoteViewRows, type RowsRequest, type TableFacts } from "./remoteRows.ts";
export { buildLabel, currentBuild, type BuildInfo } from "./buildInfo.ts";
export { asStored, ingestingText, readingText } from "./reading.ts";
