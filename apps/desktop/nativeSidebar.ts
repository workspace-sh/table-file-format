// The window's sidebar is the system's own (native/TablePanels: TableShell,
// TableSidebarView). What it lists is table-app's sidebar data, sent here
// as it changes; what's clicked in it comes back as an event.
import { NativeEventEmitter, NativeModules } from "react-native";
import { isImageFile } from "@workspace.sh/table-ui/shared";
import type { FilesTreeEntry, SidebarBundle } from "@workspace.sh/table-app";

interface TableSidebarModule {
  setModel(json: string): void;
  toggle(): void;
  setInspectorShown(shown: boolean): void;
  setInspectorCell(json: string): void;
  setSettingsForm(json: string): void;
  sendSettingsForm(json: string): void;
  pressInspectorCell(action: string): void;
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
  | { type: "shown"; shown: boolean }
  /** The inspector opened or closed, by its toolbar button or by the app. */
  | { type: "inspector"; shown: boolean }
  /** A button pressed in the inspector's account of the selected cell. */
  | { type: "inspectorCell"; action: "edit" | "settings" }
  // Escape pressed in the window while no text is being typed (TableShell.watchEscape).
  | { type: "escape" }
  /** Something done in the inspector's settings form (MacSettings.tsx reads these). */
  | SettingsFormEvent;

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

/** Open or close the inspector pane. */
export function setInspectorShown(shown: boolean): void {
  TableSidebar?.setInspectorShown(shown);
}

/** What the inspector's settings form reports: a row changed, submitted, toggled or pressed; a compound row removed or moved; Cancel or the confirming button. */
export interface SettingsFormEvent {
  type: "settingsForm";
  what: "change" | "submit" | "toggle" | "press" | "remove" | "move" | "cancel" | "confirm";
  /** The row it was on. */
  id?: string;
  value?: string | boolean;
  /** The section a compound row was removed from or moved in, and where. */
  section?: string;
  index?: number;
  from?: number;
  to?: number;
}

/** The settings form for the inspector to show, as its JSON (TableSettingsForm.swift); null for none. */
export function setSettingsForm(json: string | null): void {
  TableSidebar?.setSettingsForm(json ?? "");
}

/** Development only: what a control in the settings form would send. */
export function sendSettingsForm(event: object): void {
  TableSidebar?.sendSettingsForm(JSON.stringify(event));
}

/** The selected cell as the inspector says it (TableCellInspector.swift). */
export interface InspectorCell {
  field: string;
  row: string;
  rowLabel: string;
  value: string;
  valueLabel: string;
  formula: boolean;
  aboutLabel: string;
  about: string[];
  editLabel: string;
  settingsLabel?: string;
}

/** Say the selected cell in the inspector's own form; null hands the pane back to React's view. */
export function setInspectorCell(cell: InspectorCell | null): void {
  TableSidebar?.setInspectorCell(cell ? JSON.stringify(cell) : "");
}

/** Development only: press one of the cell inspector's buttons. */
export function pressInspectorCell(action: "edit" | "settings"): void {
  TableSidebar?.pressInspectorCell(action);
}
