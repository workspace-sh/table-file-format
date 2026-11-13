/** The Material Symbols the Android header draws, each in assets/symbols. */
export type MaterialSymbol =
  | "menu"
  | "stacks"
  | "tune"
  | "more_vert"
  | "check"
  | "add"
  | "table"
  | "note_add"
  | "folder_open"
  | "share"
  | "settings"
  | "undo"
  | "redo"
  | "add_column_right"
  | "close";

export interface MenuItem {
  label: string;
  icon?: MaterialSymbol;
  /** Shown with a check: the one chosen, as the view on screen. */
  checked?: boolean;
  /** Shown, but not to be pressed now: Undo with nothing to undo. */
  disabled?: boolean;
  /** A line above it: where a new group of actions starts. */
  startsGroup?: boolean;
  onPress: () => void;
}

export interface AndroidHeaderActionsProps {
  views: MenuItem[];
  settingsOpen: boolean;
  onSettings: () => void;
  more: MenuItem[];
}
