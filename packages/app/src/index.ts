// What an app around the .table views does, whatever draws them: tables
// held by `bundle/table` key, a viewer's own sorts and filters kept apart
// from the saved views, display preferences, saved state over any
// key-value store, and `.table.zip` files in and out. The web and Linux
// demos both use it; nothing here touches a DOM or a toolkit.

export * from "./arrangements.ts";
export * from "./bundles.ts";
export * from "./displaySettings.ts";
export * from "./savedTables.ts";
export * from "./sidebarPrefs.ts";
export * from "./tableFiles.ts";
export * from "./tableKey.ts";
export * from "./showView.ts";
