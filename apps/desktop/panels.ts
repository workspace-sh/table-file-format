// The system Open and Save panels (native/TablePanels).

import { NativeModules } from "react-native";

interface TablePanelsModule {
  chooseFolder(title: string): Promise<string | null>;
  chooseFile(title: string, extensions: string[]): Promise<string | null>;
  choosePath(title: string, suggestedName: string): Promise<string | null>;
}

const panels = NativeModules.TablePanels as TablePanelsModule | undefined;

/** The chosen folder's path, or null when the panel is cancelled. */
export function chooseFolder(title: string): Promise<string | null> {
  return panels ? panels.chooseFolder(title) : Promise.resolve(null);
}

/** A file with one of `extensions` (without the dot), or null when cancelled. */
export function chooseFile(title: string, extensions: string[]): Promise<string | null> {
  return panels ? panels.chooseFile(title, extensions) : Promise.resolve(null);
}

/** Where to save a new file, starting from `suggestedName`, or null when cancelled. */
export function choosePath(title: string, suggestedName: string): Promise<string | null> {
  return panels ? panels.choosePath(title, suggestedName) : Promise.resolve(null);
}
