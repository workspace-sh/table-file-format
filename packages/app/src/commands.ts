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
  | "undo"
  | "redo"
  | "toggle-sidebar"
  | "tables-mode"
  | "files-mode"
  | "go-back"
  | "go-forward"
  | "copy-link";

export interface AppCommand {
  id: AppCommandId;
  /** Which menu it belongs in, where a platform has more than one. */
  menu: "File" | "Edit" | "View" | "Go";
  label: string;
  key: string;
  /** With Shift as well. */
  shift?: boolean;
  /** With Option (macOS) or Alt (GTK) as well. */
  option?: boolean;
  /**
   * GTK's accelerator where its convention differs from the key's: GNOME
   * goes back with Alt+Left, where the Mac has ⌘[.
   */
  gtkAccel?: string;
  /** False when there's nothing for it to do now (no view to go back to). */
  enabled?: boolean;
  /** Shown ticked: one of a choice, and the one in force. */
  checked?: boolean;
  /** What it does, for a tooltip on its button; add shortcutText where the button's platform has the key. */
  hint?: string;
}

export interface AppCommandState {
  sidebarCollapsed: boolean;
  filesMode: boolean;
  /** From history's canGoBack and canGoForward; both false when absent. */
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Whether the table on screen has an edit to undo, or to redo; both false when absent. */
  canUndo?: boolean;
  canRedo?: boolean;
  /** What each would act on, as a menu says it ("Delete Row"): the labels read "Undo Delete Row". Plain "Undo" and "Redo" when absent. */
  undoName?: string | null;
  redoName?: string | null;
}

/** The commands in menu order, labelled and ticked for the state they're shown in. */
export function appCommands(state: AppCommandState): AppCommand[] {
  return [
    { id: "new-file", menu: "File", label: "New .table File…", key: "n" },
    { id: "open-folder", menu: "File", label: "Open .table…", key: "o" },
    { id: "open-zip", menu: "File", label: "Open .table.zip…", key: "o", shift: true },
    {
      id: "export-zip",
      menu: "File",
      label: "Export .table.zip…",
      key: "e",
      shift: true,
      hint: "Save this table as a .table.zip: a folder of plain files (schema, one row per line, views, pages) that any .table reader opens.",
    },
    { id: "undo", menu: "Edit", label: state.undoName ? `Undo ${state.undoName}` : "Undo", key: "z", enabled: state.canUndo ?? false, hint: "Put the table back as it was before its last edit" },
    { id: "redo", menu: "Edit", label: state.redoName ? `Redo ${state.redoName}` : "Redo", key: "z", shift: true, enabled: state.canRedo ?? false, hint: "Make the edit just undone again" },
    { id: "copy-link", menu: "Edit", label: "Copy Link to View", key: "c", option: true },
    { id: "tables-mode", menu: "View", label: "Tables", key: "1", checked: !state.filesMode },
    { id: "files-mode", menu: "View", label: "Files", key: "2", checked: state.filesMode },
    {
      id: "toggle-sidebar",
      menu: "View",
      label: state.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
      key: "b",
      hint: state.sidebarCollapsed ? "Show the sidebar" : "Hide the sidebar",
    },
    { id: "go-back", menu: "Go", label: "Back", key: "[", gtkAccel: "<Alt>Left", enabled: state.canGoBack ?? false },
    { id: "go-forward", menu: "Go", label: "Forward", key: "]", gtkAccel: "<Alt>Right", enabled: state.canGoForward ?? false },
  ];
}

/**
 * A command's accelerator in GTK's syntax (Gtk.acceleratorParse): its
 * `gtkAccel` where GNOME's convention differs, else Control with the key,
 * and Shift and Alt as the command says.
 */
export function gtkAccelOf(command: AppCommand): string {
  if (command.gtkAccel) return command.gtkAccel;
  return `<Control>${command.shift ? "<Shift>" : ""}${command.option ? "<Alt>" : ""}${command.key}`;
}


/** Tooltips for controls that aren't commands. */
export const TOOLBAR_HINTS = {
  viewSettings:
    "Name, layout, filters, sorting and grouping for this view. Saved with the table, so everyone who opens it sees the same view.",
} as const;

/**
 * A command's shortcut as a person reads it: "⌘B" on the Mac, "Ctrl+B"
 * on GTK (its accelerator, so "Alt+Left" where GNOME's differs), and both
 * on the web, which may run on either: "⌘B / Ctrl+B".
 */
export function shortcutText(command: AppCommand, platform: "mac" | "gtk" | "web"): string {
  const key = command.key.length === 1 ? command.key.toUpperCase() : command.key;
  const mac = `${command.option ? "⌥" : ""}${command.shift ? "⇧" : ""}⌘${key}`;
  const ctrl = `Ctrl+${command.shift ? "Shift+" : ""}${command.option ? "Alt+" : ""}${key}`;
  if (platform === "mac") return mac;
  if (platform === "web") return `${mac} / ${ctrl}`;
  if (!command.gtkAccel) return ctrl;
  // GTK's own syntax, read out: "<Alt>Left" is "Alt+Left".
  const mods = [...command.gtkAccel.matchAll(/<(\w+)>/g)].map((m) => (m[1] === "Control" || m[1] === "Primary" ? "Ctrl" : m[1]!));
  return [...mods, command.gtkAccel.replace(/<\w+>/g, "")].join("+");
}

/** A command's hint with its shortcut, where the platform has one: "Hide the sidebar (⌘B)". */
export function hintWithShortcut(command: AppCommand, platform: "mac" | "gtk" | "web"): string {
  return `${command.hint ?? command.label} (${shortcutText(command, platform)})`;
}
