import type { ReactNode } from "react";

/**
 * One entry in the tree: a folder (it has `children`) or a file. Nothing
 * here knows what the files are; the app that builds the tree does.
 */
export interface FileNode {
  /** Unique in the tree; handed back to `load` when the file is opened. */
  id: string;
  name: string;
  /** A folder's entries. Absent for a file. */
  children?: FileNode[];
  /** A short word beside the name: "6 rows", a count of files. */
  note?: string;
  /** A folder that starts open. */
  open?: boolean;
  /** What opening a file shows; "none" lists it without opening it. Default "text". */
  opens?: "text" | "image" | "none";
}

/** What an opened file shows. */
export type FileContents =
  | { kind: "text"; text: string }
  | { kind: "image"; uri: string }
  /** Nothing to show, and why. */
  | { kind: "note"; text: string };

/** One line of the tree as it shows: folded folders list nothing under them. */
export interface FileRow {
  node: FileNode;
  /** 0 for the tree's own entries, 1 inside them, and so on. */
  depth: number;
  folder: boolean;
  expanded: boolean;
}

/** The browser's state and what it can do: all a custom interface needs. */
export interface FileBrowserState {
  /** The tree's entries as they show, top to bottom. */
  rows: FileRow[];
  /** Open or close a folder. */
  toggle: (id: string) => void;
  /** Open a file. */
  open: (id: string) => void;
  /** Back from a file to the tree. */
  close: () => void;
  /** The file open, with its contents once they've loaded. */
  file: { node: FileNode; contents: FileContents | null } | null;
}

export interface FileBrowserProps {
  nodes: FileNode[];
  /** A file's contents, when it's opened. */
  load: (node: FileNode) => FileContents | Promise<FileContents>;
  /**
   * Draw the tree in the app's own way, instead of the platform's list.
   * Gets the browser's state; `useFileBrowser` gives the same without any
   * default view at all.
   */
  renderBrowser?: (state: FileBrowserState) => ReactNode;
  /** Draw an open file in the app's own way, instead of the default view. */
  renderFile?: (file: { node: FileNode; contents: FileContents | null }, close: () => void) => ReactNode;
}
