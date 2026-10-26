// The app's own display settings (locale, default date format, formula
// syntax, the resize handles' look), handed to
// every cell without threading a prop through each view. Personal
// preferences, never written into a `.table/` (SPEC section 4).

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { DisplayOptions, FormulaSyntax, TextDirection } from "@workspace.sh/table-core";

export interface DisplaySettings extends DisplayOptions {
  /** Which syntax formulas are shown in (#76). Absent: Excel style. */
  formulaSyntax?: FormulaSyntax;
  /**
   * The tables (their keys) whose formulas this viewer shows in stored form,
   * chosen table by table and kept on this device: `formulaSyntax` is worked
   * out from it for the table on screen. Absent: none.
   */
  storedFormulaTables?: string[];
  /**
   * Which way the interface reads (D40), from the language it's shown
   * in (`textDirection`). Absent: left to right. Styles mirror by
   * themselves; this is for what they can't, like which way a drag
   * widens a column.
   */
  direction?: TextDirection;
  /**
   * How a selected cell's resize handles look on touch: pills with grip
   * bars, or short grabber bars on its edges. Absent: pills.
   */
  resizeHandles?: "grabbers";
}

/** Which display setting a row of the Display controls sets. */
export type DisplaySettingKind = "locale" | "dateFormat" | "formulaSyntax" | "resizeHandles";

/**
 * One row of the Display controls: what it's called, the choices, which is
 * chosen, and a note under it. table-app's `displayChoices` makes them, so
 * every app (web, macOS, Linux) offers the same choices in the same words.
 */
export interface DisplayChoiceRow {
  kind: DisplaySettingKind;
  /** Shown beside the choices: "Language". */
  name: string;
  /** For assistive technology: what the choice does. */
  label: string;
  /** The chosen option's value. */
  value: string;
  options: { value: string; label: string }[];
  /** Shown under the row, when there's more to say. */
  note?: string;
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
