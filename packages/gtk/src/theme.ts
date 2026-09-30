// How the views look on GTK: libadwaita's own colours wherever it has one,
// so a table sits in the window like the rest of it, and the table's own
// palette only where the format names a colour (a choice's pill).

import { css } from "@gtkx/css";
import * as Adw from "@gtkx/gi/adw";
import { useProperty } from "@gtkx/react";
import { PILL_PALETTE } from "@workspace.sh/table-ui/shared";

/** Whether libadwaita is drawing dark, followed live as the system switches. */
export function useDark(): boolean {
  return useProperty(Adw.StyleManager.getDefault(), "dark") === true;
}

const RULE = "alpha(currentColor, 0.1)";

export const styles = {
  cell: css({ padding: "0 10px" }),
  headerCell: css({ padding: "0 10px", fontWeight: "600", opacity: 0.75 }),
  headerRow: css({ borderBottom: `1px solid ${RULE}`, minHeight: "36px" }),
  bodyRow: css({ borderBottom: `1px solid ${RULE}` }),
  /** A column's end edge, as the web grid rules its cells. */
  columnRule: css({ borderRight: `1px solid ${RULE}` }),
  groupRow: css({ backgroundColor: "alpha(currentColor, 0.04)", borderBottom: `1px solid ${RULE}`, padding: "6px 10px", fontWeight: "600" }),
  totalsRow: css({ borderTop: `1px solid ${RULE}`, minHeight: "36px" }),
  totalLabel: css({ fontSize: "smaller", opacity: 0.6, marginRight: "6px" }),
  rowNumber: css({ opacity: 0.55, fontFeatureSettings: '"tnum"', fontSize: "smaller" }),
  /** Numbers and dates line up by digit. */
  tabular: css({ fontFeatureSettings: '"tnum"' }),
  empty: css({ opacity: 0.4 }),
  formulaError: css({ color: "@error_color", fontWeight: "600" }),
  relationBroken: css({ color: "@error_color", textDecoration: "line-through" }),
  relationLink: css({ padding: "0 4px", minHeight: "0", color: "@accent_color" }),
  pill: css({ borderRadius: "999px", padding: "2px 10px", fontSize: "smaller", fontWeight: "500" }),
  table: css({ backgroundColor: "@view_bg_color" }),
  /** The open formula's column, tinted; the cells it read, outlined (as on the web). */
  formulaColumn: css({ backgroundColor: "alpha(@accent_bg_color, 0.08)" }),
  formulaInput: css({ boxShadow: "inset 0 0 0 2px alpha(@accent_bg_color, 0.7)" }),
  /** The cell the keyboard is on. */
  selectedCell: css({ boxShadow: "inset 0 0 0 2px @accent_bg_color", outline: "none" }),
  card: css({ padding: "10px 12px", borderRadius: "10px" }),
  cardTitle: css({ fontWeight: "600" }),
  cardFieldLabel: css({ fontSize: "x-small", fontWeight: "600", opacity: 0.55, letterSpacing: "0.04em" }),
  bodyBadge: css({ fontSize: "x-small", fontWeight: "700", padding: "1px 5px", borderRadius: "4px", backgroundColor: "alpha(@accent_bg_color, 0.15)", color: "@accent_color" }),
  boardColumn: css({ backgroundColor: "alpha(currentColor, 0.04)", borderRadius: "12px", padding: "10px" }),
  galleryHero: css({ fontWeight: "500", opacity: 0.85 }),
  galleryImage: css({ backgroundColor: "alpha(currentColor, 0.04)", borderRadius: "8px", padding: "8px" }),
  excerpt: css({ fontSize: "smaller", opacity: 0.7, borderTop: `1px solid ${RULE}`, paddingTop: "6px" }),
  calendar: css({ padding: "0" }),
  calendarWeekdays: css({ borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }),
  calendarDay: css({ borderRadius: "0", padding: "6px", borderRight: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }),
  calendarOther: css({ opacity: 0.45 }),
  calendarToday: css({ color: "@accent_color", fontWeight: "700" }),
  calendarChip: css({ fontSize: "smaller", padding: "1px 6px", borderRadius: "4px", backgroundColor: "alpha(@accent_bg_color, 0.15)", color: "@accent_color" }),
} as const;

const pillClasses = new Map<string, string>();

/** The class that draws a choice's pill in its colour, light or dark. */
export function pillClass(color: string | undefined, dark: boolean): string {
  const palette = PILL_PALETTE[color ?? "gray"] ?? PILL_PALETTE["gray"]!;
  const { bg, fg } = dark ? palette.dark : palette.light;
  const key = `${bg}${fg}`;
  let name = pillClasses.get(key);
  if (name === undefined) {
    name = css({ backgroundColor: bg, color: fg });
    pillClasses.set(key, name);
  }
  return name;
}
