// The app's own display settings (locale, default date format, formula
// syntax), handed to
// every cell without threading a prop through each view. Personal
// preferences, never written into a `.table/` (SPEC section 4).

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DisplayOptions, FormulaSyntax } from "@workspace.sh/table-core";

export interface DisplaySettings extends DisplayOptions {
  /** Which syntax formulas are shown in (#76). Absent: Excel style. */
  formulaSyntax?: FormulaSyntax;
}

const DisplaySettingsContext = createContext<DisplaySettings>({});

export function DisplaySettingsProvider({ value, children }: { value: DisplaySettings; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

export function useDisplaySettings(): DisplaySettings {
  return useContext(DisplaySettingsContext);
}
