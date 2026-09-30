// What the app does from its menus and keys, whatever draws them: the
// macOS menu bar (⌘ + key), GTK's primary menu and accelerators
// (<Control> + key). Labels are title case with "…" where a dialog
// follows, which suits both HIGs; a key is platform-neutral, a letter or
// digit each platform puts its own modifier on.

export type AppCommandId =
  | "new-file"
  | "open-folder"
  | "open-zip"
  | "export-zip"
  | "toggle-sidebar"
  | "tables-mode"
  | "files-mode";

export interface AppCommand {
  id: AppCommandId;
  /** Which menu it belongs in, where a platform has more than one. */
  menu: "File" | "View";
  label: string;
  key: string;
  /** With Shift as well. */
  shift?: boolean;
  /** Shown ticked: one of a choice, and the one in force. */
  checked?: boolean;
}

export interface AppCommandState {
  sidebarCollapsed: boolean;
  filesMode: boolean;
}

/** The commands in menu order, labelled and ticked for the state they're shown in. */
export function appCommands(state: AppCommandState): AppCommand[] {
  return [
    { id: "new-file", menu: "File", label: "New .table File…", key: "n" },
    { id: "open-folder", menu: "File", label: "Open .table…", key: "o" },
    { id: "open-zip", menu: "File", label: "Open .table.zip…", key: "o", shift: true },
    { id: "export-zip", menu: "File", label: "Export .table.zip…", key: "e", shift: true },
    { id: "tables-mode", menu: "View", label: "Tables", key: "1", checked: !state.filesMode },
    { id: "files-mode", menu: "View", label: "Files", key: "2", checked: state.filesMode },
    { id: "toggle-sidebar", menu: "View", label: state.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar", key: "b" },
  ];
}
