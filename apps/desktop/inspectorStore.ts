// What the inspector shows. The window has two React views in one
// JavaScript runtime: the main one (App.tsx) and the inspector's
// (Inspector.tsx), in the system's trailing pane. The app puts here what's
// selected, and the inspector draws it; callbacks cross as they are.
import type { GlassBarProps } from "@workspace.sh/glass-bar";
import type { DisplaySettings, ViewSettingsProps } from "@workspace.sh/table-ui";

/** A row's page, as table-ui's BodyEditor takes it. */
export interface InspectorPage {
  /** One per page shown, so each gets a fresh editor. */
  key: string;
  rowId: string;
  rowTitle: string;
  content: string;
  onSave: (content: string) => void;
  onClose: () => void;
}

export interface InspectorShown {
  page: InspectorPage | null;
  /** The view's settings, while they're open: table-ui's ViewSettings as it is. */
  settings?: (ViewSettingsProps & { key: string }) | null;
  /** The selected cell, and a formula being written: glass-bar's state and callbacks. */
  cell: GlassBarProps | null;
  /** The ref glass-bar's hook hands its bar, for a clicked cell to go into a formula. */
  cellRef?: unknown;
  display?: DisplaySettings;
}

let shown: InspectorShown = { page: null, cell: null };
const listeners = new Set<() => void>();

export const inspectorStore = {
  get: (): InspectorShown => shown,
  set: (next: InspectorShown): void => {
    shown = next;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
