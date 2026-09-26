// The app's own display settings (locale, default date format), handed to
// every cell without threading a prop through each view. Personal
// preferences, never written into a `.table/` (SPEC section 4).

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DisplayOptions } from "@workspace.sh/table-core";

const DisplaySettingsContext = createContext<DisplayOptions>({});

export function DisplaySettingsProvider({ value, children }: { value: DisplayOptions; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

export function useDisplaySettings(): DisplayOptions {
  return useContext(DisplaySettingsContext);
}
