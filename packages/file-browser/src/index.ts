// A file browser for React Native, knowing nothing of what the files are.
//
// - `FileBrowser`: the platform's own list (SwiftUI's on iOS), opening a
//   file over it; `renderBrowser` / `renderFile` swap in an app's own.
// - `useFileBrowser`: the same state with no view at all, for an app that
//   draws everything itself, or mixes its own with `FileTree` (the list
//   alone) and `FileContent` (a file alone).
// - `visibleRows` and friends: the tree as plain data.
export { FileBrowser, FileTree } from "./FileBrowser";
export { FileContent } from "./FileContent";
export { useFileBrowser } from "./useFileBrowser.ts";
export { findNode, initiallyOpen, symbolFor, visibleRows } from "./tree.ts";
export type { FileBrowserProps, FileBrowserState, FileContents, FileNode, FileRow } from "./types.ts";
