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
  /** Documents opened last time that couldn't be opened again, and why: said here, in place. */
  unavailable?: { name: string; message: string; action?: { label: string; onPress: () => void | Promise<void> } }[];
}
