import type { TableAppContextValue } from "./TableAppContext";

/** What the tables sheet lists, and what choosing does. */
export interface TablesListProps {
  /** table-app's sidebar tree: the files, each with its tables. */
  tree: TableAppContextValue["derived"]["sidebarTree"];
  /** The table on screen. */
  active: string;
  onChoose: (key: string) => void;
  onNewTable: (bundle: string) => void;
  /** Close a file (asks first); offered where the file is `closable`. */
  onClose: (bundle: string) => void;
  /** Documents opened last time that couldn't be opened again, or whose edits were kept apart, and why: said here, in place, under their `group`. */
  unavailable?: { group?: string; name: string; message: string; action?: { label: string; onPress: () => void | Promise<void> } }[];
}

/** Notices by their heading, in the order they first appear. */
export function groupsOf<T extends { group?: string }>(notices: readonly T[] | undefined): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const n of notices ?? []) {
    const g = n.group ?? "Couldn't open";
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  return [...groups];
}
