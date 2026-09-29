// The system Open panel (native/TablePanels), for choosing a .table folder.

import { NativeModules } from "react-native";

interface TablePanelsModule {
  chooseFolder(title: string): Promise<string | null>;
}

const panels = NativeModules.TablePanels as TablePanelsModule | undefined;

/** The chosen folder's path, or null when the panel is cancelled. */
export function chooseFolder(title: string): Promise<string | null> {
  return panels ? panels.chooseFolder(title) : Promise.resolve(null);
}
