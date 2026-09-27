// The app's own display settings (locale, default date format, formula
// syntax), handed to
// every cell without threading a prop through each view. Personal
// preferences, never written into a `.table/` (SPEC section 4).

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DisplayOptions, FormulaSyntax, TextDirection } from "@workspace.sh/table-core";

export interface DisplaySettings extends DisplayOptions {
  /** Which syntax formulas are shown in (#76). Absent: Excel style. */
  formulaSyntax?: FormulaSyntax;
  /**
   * Which way the interface reads (D40), from the language it's shown
   * in (`textDirection`). Absent: left to right. Styles mirror by
   * themselves; this is for what they can't, like which way a drag
   * widens a column.
   */
  direction?: TextDirection;
}

const DisplaySettingsContext = createContext<DisplaySettings>({});

export function DisplaySettingsProvider({ value, children }: { value: DisplaySettings; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

export function useDisplaySettings(): DisplaySettings {
  return useContext(DisplaySettingsContext);
}

/** Which way the interface reads (D40). */
export function useDirection(): TextDirection {
  return useContext(DisplaySettingsContext).direction ?? "ltr";
}
