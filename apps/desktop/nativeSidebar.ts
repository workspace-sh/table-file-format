// The window's sidebar is the system's own (native/TablePanels: TableShell,
// TableSidebarView). What it lists is table-app's sidebar data, sent here
// as it changes; what's clicked in it comes back as an event.
import { NativeEventEmitter, NativeModules } from "react-native";
import { isImageFile } from "@workspace.sh/table-ui/shared";
import type { FilesTreeEntry, SidebarBundle } from "@workspace.sh/table-app";

interface TableSidebarModule {
  setModel(json: string): void;
  toggle(): void;
  pick(tag: string): void;
  addListener(event: string): void;
  removeListeners(count: number): void;
}

const TableSidebar = NativeModules.TableSidebar as TableSidebarModule | undefined;
const events = TableSidebar ? new NativeEventEmitter(TableSidebar as never) : undefined;

export type SidebarEvent =
  | { type: "selectTable"; key: string }
  | { type: "selectView"; key: string; viewId: string }
  | { type: "toggleFile"; bundle: string }
  | { type: "newView" }
  | { type: "newTable" }
  | { type: "filesMode"; files: boolean }
  | { type: "toggleDir"; bundle: string; path: string; open: boolean }
  | { type: "showFile"; bundle: string; path: string }
  | { type: "shown"; shown: boolean };

export interface SidebarShown {
  tree: SidebarBundle[];
  /** The table on screen, as its `bundle/table` key. */
  active: string;
  filesMode: boolean;
  files: FilesTreeEntry[];
  shownFile: { bundle: string; path: string } | null;
}

/** What the sidebar lists, as the native view reads it (TableSidebarView.swift). */
export function setSidebar({ tree, active, filesMode, files, shownFile }: SidebarShown): void {
  TableSidebar?.setModel(
    JSON.stringify({
      filesMode,
      tablesLabel: "Tables",
      filesLabel: "Files",
      newViewLabel: "New View",
      newTableLabel: "New Table",
      bundles: tree.map((b) => ({
        bundle: b.bundle,
        title: b.title,
        file: b.file,
        folded: b.folded,
        offersNewTable: b.offersNewTable,
        tables: b.tables.map((t) => ({
          key: t.key,
          title: t.title,
          rowCount: t.rowCount,
          expanded: t.expanded,
          active: t.key === active,
          views: t.views.map((v) => ({ id: v.id, name: v.name, layout: v.layout, layoutLabel: v.layoutLabel, active: v.active })),
        })),
      })),
      files: files.map((line) => {
        if (line.kind === "bundle") {
          const b = line.bundle;
          return { id: `${b.bundle}/`, kind: "bundle", bundle: b.bundle, path: "", name: b.name, depth: 0, open: !b.folded, selected: false, image: false };
        }
        if (line.kind === "dir") {
          const d = line.dir;
          return {
            id: `${line.bundle}/${d.path}/`,
            kind: "dir",
            bundle: line.bundle,
            path: d.path,
            name: `${d.name}/`,
            depth: line.depth,
            open: d.open,
            note: d.count === undefined ? undefined : String(d.count),
            selected: false,
            image: false,
          };
        }
        const f = line.file;
        return {
          id: `${line.bundle}/${f.path}`,
          kind: "file",
          bundle: line.bundle,
          path: f.path,
          name: f.name,
          depth: line.depth,
          open: false,
          note: f.note,
          selected: shownFile?.bundle === line.bundle && shownFile.path === f.path,
          image: isImageFile(f.name),
        };
      }),
    }),
  );
}

/** Call `then` with what's clicked in the sidebar. Returns the unsubscribe. */
export function onSidebar(then: (event: SidebarEvent) => void): () => void {
  const sub = events?.addListener("TableSidebarEvent", then);
  return () => sub?.remove();
}

/** Show or hide the sidebar, as the toolbar's button does. */
export function toggleNativeSidebar(): void {
  TableSidebar?.toggle();
}

/** Development only: pick a sidebar row as a click on it does (`table:<key>`, `view:<key>:<viewId>`, or a Files line's id). */
export function pickInSidebar(tag: string): void {
  TableSidebar?.pick(tag);
}
