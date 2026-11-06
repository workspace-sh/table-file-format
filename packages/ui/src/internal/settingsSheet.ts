// Whether what's drawn is inside the settings sheet's own Compose tree
// (Sheet.android), where a settings form (SettingsForm.android) adds its
// rows to the sheet's rather than hosting its own.
import { createContext } from "react";

export const InSettingsSheet = createContext(false);
