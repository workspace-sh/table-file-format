import type { TableAppContextValue } from "./TableAppContext";

/** What the tables sheet lists, and what choosing does. */
export interface TablesListProps {
  /** table-app's sidebar tree: the files, each with its tables. */
  tree: TableAppContextValue["derived"]["sidebarTree"];
  /** The table on screen. */
  active: string;
  onChoose: (key: string) => void;
  onNewTable: (bundle: string) => void;
}
