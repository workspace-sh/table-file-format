// The table grid's look, for a host that draws a table of its own the way
// the grid draws one: a Markdown table in a document, say. The values are
// views.tsx's (tableCell, tableHeaderCell, tableHeaderRow, tableRow, table),
// restated because StyleX compiles css.create from that file's literals
// only; gridLook.test.ts holds the two together.

import { DEFAULT_ROW_HEIGHT } from "./display";
import { SYSTEM_COLOR_ROLES } from "./systemColorRoles";
import { systemColorName } from "./internal/systemColors";

/**
 * One of the grid's colours: its light and dark pair, and, where this
 * platform draws the grid in the system's colour for that role, the
 * platform colour's name as React Native's PlatformColor takes it.
 */
export interface GridColor {
  light: string;
  dark: string;
  platform?: string;
}

export interface GridLook {
  cellPaddingInline: number;
  cellPaddingBlock: number;
  /** A body row's least height, padding included (the header row is as tall as its text). */
  minRowHeight: number;
  cornerRadius: number;
  fontSize: number;
  headerFontSize: number;
  /** As in CSS. */
  headerFontWeight: number;
  /** The header's text in capitals. */
  headerCapitals: boolean;
  headerLetterSpacing: number;
  text: GridColor;
  headerText: GridColor;
  headerBackground: GridColor;
  /** The lines between rows and cells, and round the table. */
  line: GridColor;
}

function color(light: string, dark: string): GridColor {
  const role = SYSTEM_COLOR_ROLES[`${light}/${dark}`];
  const platform = role === undefined ? undefined : systemColorName(role);
  return platform === undefined ? { light, dark } : { light, dark, platform };
}

/** The grid's look, on this platform. */
export const gridLook: GridLook = {
  cellPaddingInline: 16,
  cellPaddingBlock: 10,
  minRowHeight: DEFAULT_ROW_HEIGHT,
  cornerRadius: 8,
  fontSize: 13,
  headerFontSize: 11,
  headerFontWeight: 600,
  headerCapitals: true,
  headerLetterSpacing: 0.5,
  text: color("#1c1c1e", "#f5f5f7"),
  headerText: color("#6e6e73", "#8a8a93"),
  headerBackground: color("#f5f5f7", "#17171a"),
  line: color("#e5e5ea", "#26262b"),
};
