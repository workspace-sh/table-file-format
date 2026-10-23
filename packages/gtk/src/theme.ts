// How the views look on GTK: libadwaita's own colours wherever it has one,
// so a table sits in the window like the rest of it, and the table's own
// palette only where the format names a colour (a choice's pill).

import { css } from "@gtkx/css";
import * as Adw from "@gtkx/gi/adw";
import { useProperty } from "@gtkx/react";
import { pillColors } from "@workspace.sh/table-ui/shared";

/** Whether libadwaita is drawing dark, followed live as the system switches. */
export function useDark(): boolean {
  return useProperty(Adw.StyleManager.getDefault(), "dark") === true;
}

const RULE = "alpha(currentColor, 0.1)";
/** A resize line while it is only pointed at: the accent, faint. Dragged, it is the accent itself. */
const HOVER_LINE = "alpha(@accent_bg_color, 0.35)";

/** "Calculate" in a footer cell with no total: where one could go, seen when its cell is pointed at or has the keyboard. */
const TOTAL_PLACEHOLDER = css({ fontSize: "11px", opacity: 0 });

export const styles = {
  /** The table: a framed card, its rules and sizes the web's and the Mac's (table-ui's views.tsx). */
  tableFrame: css({ border: `1px solid ${RULE}`, borderRadius: "8px" }),
  /** Where an embedded table would be, when it can't be drawn: the frame's outline, dashed, around why. */
  embedProblem: css({ border: `1px dashed alpha(currentColor, 0.25)`, borderRadius: "8px", padding: "10px 12px", fontSize: "13px" }),
  cell: css({ padding: "0 16px", fontSize: "13px" }),
  /** A column's title: small capitals, as every platform's table has them. */
  headerCell: css({ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.65 }),
  headerRow: css({ borderBottom: `1px solid ${RULE}`, minHeight: "36px", backgroundColor: "alpha(currentColor, 0.04)" }),
  bodyRow: css({ borderBottom: `1px solid ${RULE}` }),
  /**
   * The first column where it stays put while the others scroll under it: the
   * table's own ground behind it, so nothing shows through.
   */
  frozen: css({ backgroundColor: "@view_bg_color" }),
  /**
   * Beside a first column that stays put on a page's margin (an embedded table): the page's own ground
   * out to the window's edge, so the cells that scroll under the column don't show again in the margin.
   * A line taller than the cells, to cover the row's rule there too.
   */
  pinnedSkirt: css({ backgroundColor: "@view_bg_color", marginBottom: "-1px", minHeight: "1px" }),
  frozenHeader: css({ backgroundColor: "mix(@view_bg_color, currentColor, 0.04)" }),
  /** A place where something could be added (a field): faint at rest, full strength when pointed at or focused. */
  addPlace: css({ opacity: 0.5, "&:hover, &:focus-visible": { opacity: 1 } }),
  /**
   * "+ New row": open space under the last row, not a row. Its words are
   * faint until it's pointed at, when the band fills.
   */
  addRowBand: css({
    borderRadius: "0",
    minHeight: "36px",
    padding: "0 16px",
    fontSize: "13px",
    fontWeight: "400",
    "& > label": { opacity: 0.45 },
    "&:hover > label, &:focus-visible > label": { opacity: 0.8 },
  }),
  /** A row's page, marked beside its title: the same small badge everywhere. */
  pageBadge: css({
    minHeight: "0",
    minWidth: "0",
    padding: "1px 6px",
    borderRadius: "4px",
    fontSize: "9px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    backgroundColor: "alpha(@accent_bg_color, 0.2)",
    color: "@accent_color",
  }),
  /** A header's end edge, where its column is dragged wider or narrower: a line when pointed at. */
  /**
   * A column's edge, to drag: a line on its end edge, faint while pointed at (so it doesn't flash across
   * the header as the pointer passes) and full while it is dragged, as every platform's table has it.
   */
  columnHandle: css({
    "&:hover": { boxShadow: `inset -2px 0 ${HOVER_LINE}` },
    "&:dir(rtl):hover": { boxShadow: `inset 2px 0 ${HOVER_LINE}` },
  }),
  /**
   * A column's line down the table, to drag: two pixels on the column's end, inside a strip wide enough
   * to take. Faint when pointed at and full while dragged, as its header's edge.
   */
  columnLine: css({
    "&:hover": { backgroundImage: `linear-gradient(to right, transparent 2px, ${HOVER_LINE} 2px, ${HOVER_LINE} 4px, transparent 4px)` },
    "&:dir(rtl):hover": { backgroundImage: `linear-gradient(to left, transparent 2px, ${HOVER_LINE} 2px, ${HOVER_LINE} 4px, transparent 4px)` },
  }),
  columnLineLit: css({
    backgroundImage: "linear-gradient(to right, transparent 2px, @accent_bg_color 2px, @accent_bg_color 4px, transparent 4px)",
    "&:hover": { backgroundImage: "linear-gradient(to right, transparent 2px, @accent_bg_color 2px, @accent_bg_color 4px, transparent 4px)" },
    "&:dir(rtl)": { backgroundImage: "linear-gradient(to left, transparent 2px, @accent_bg_color 2px, @accent_bg_color 4px, transparent 4px)" },
    "&:dir(rtl):hover": { backgroundImage: "linear-gradient(to left, transparent 2px, @accent_bg_color 2px, @accent_bg_color 4px, transparent 4px)" },
  }),
  columnHandleLit: css({
    boxShadow: "inset -2px 0 @accent_bg_color",
    "&:hover": { boxShadow: "inset -2px 0 @accent_bg_color" },
    "&:dir(rtl)": { boxShadow: "inset 2px 0 @accent_bg_color" },
    "&:dir(rtl):hover": { boxShadow: "inset 2px 0 @accent_bg_color" },
  }),
  /** A column's end edge, as the web grid rules its cells. */
  columnRule: css({ borderRight: `1px solid ${RULE}` }),
  /** A group's band: "CITY · MANCHESTER" in small capitals, and how many rows it has. */
  groupRow: css({ backgroundColor: "alpha(currentColor, 0.04)", borderBottom: `1px solid ${RULE}`, padding: "0 16px" }),
  groupLabel: css({ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.65 }),
  groupCount: css({ fontSize: "11px", opacity: 0.5 }),
  totalsRow: css({ borderTop: `1px solid ${RULE}`, minHeight: "36px" }),
  /** With no total chosen the footer is quiet: no rule above it or between its cells. */
  totalsRowQuiet: css({ minHeight: "32px" }),
  /** A footer cell, which is the menu of its column's totals: the cell's own shape, not a button's. */
  totalCell: css({
    "& > button": { borderRadius: "0", padding: "0 16px", fontSize: "13px", fontWeight: "400", minHeight: "0" },
    [`&:hover .${TOTAL_PLACEHOLDER}, &:focus-within .${TOTAL_PLACEHOLDER}`]: { opacity: 0.6 },
  }),
  totalPlaceholder: TOTAL_PLACEHOLDER,
  totalLabel: css({ fontSize: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px", opacity: 0.6, marginRight: "6px" }),
  /** A selected row's resize grip, and the line count shown while it is dragged. */
  /** The line under a row, to drag: faint when pointed at, full while it is dragged. */
  rowLine: css({ borderBottom: "2px solid transparent", "&:hover": { borderBottomColor: HOVER_LINE } }),
  rowLineLit: css({ borderBottomColor: "@accent_bg_color", "&:hover": { borderBottomColor: "@accent_bg_color" } }),
  rowGrip: css({ backgroundColor: "@accent_bg_color", color: "@accent_fg_color", borderRadius: "4px", padding: "0" }),
  /** The grip as a grabber: a short bar in the accent, ringed in the page's colour so it reads over what is under it. */
  rowGrabber: css({ backgroundColor: "@accent_bg_color", border: "2px solid @view_bg_color", borderRadius: "4.5px", padding: "0", minHeight: "0", minWidth: "0" }),
  rowGripLabel: css({ backgroundColor: "@accent_bg_color", color: "@accent_fg_color", borderRadius: "6px", padding: "2px 6px", fontSize: "smaller", fontWeight: "600" }),
  /** A sheet's row numbers: a ruled gutter of their own. */
  rowNumber: css({
    color: "alpha(currentColor, 0.55)",
    fontFeatureSettings: '"tnum"',
    fontSize: "11px",
    borderRight: `1px solid ${RULE}`,
    backgroundColor: "alpha(currentColor, 0.02)",
  }),
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
  /** A cell's text being edited: the words in place, in the cell's own ring, with no box of the entry's. */
  cellEntry: css({
    background: "none",
    border: "none",
    boxShadow: "none",
    outline: "none",
    padding: "0",
    minHeight: "0",
    fontSize: "13px",
    "&:focus-within": { boxShadow: "none", outline: "none" },
  }),
  /** The cell the keyboard is on. */
  // A cell with a note (D57): a small triangle in its top end corner, as spreadsheets mark one.
  noted: css({ backgroundImage: "linear-gradient(225deg, #e8a33d 9px, transparent 9px)" }),
  selectedCell: css({ boxShadow: "inset 0 0 0 2px @accent_bg_color", outline: "none" }),
  /** Cards (board, gallery): the sizes the table's cells have, as on every platform. */
  card: css({ padding: "10px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "400" }),
  cardTitle: css({ fontSize: "13px", fontWeight: "600" }),
  cardFieldLabel: css({ fontSize: "10px", fontWeight: "600", opacity: 0.55, letterSpacing: "0.5px" }),
  /** A row's page, marked on its card or list row: the table's PAGE badge. */
  bodyBadge: css({
    fontSize: "9px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    padding: "1px 6px",
    borderRadius: "4px",
    backgroundColor: "alpha(@accent_bg_color, 0.2)",
    color: "@accent_color",
  }),
  /** A list's row: a line with a rule under it; its title, and what else it shows at the end, quieter. */
  listRow: css({ borderRadius: "0", borderBottom: `1px solid ${RULE}`, padding: "9px 8px", minHeight: "0", fontSize: "13px", fontWeight: "400" }),
  listTitle: css({ fontSize: "13px", fontWeight: "500" }),
  listSecondary: css({ fontSize: "12px", opacity: 0.6 }),
  boardColumn: css({ backgroundColor: "alpha(currentColor, 0.04)", borderRadius: "12px", padding: "10px" }),
  galleryHero: css({ fontWeight: "500", opacity: 0.85 }),
  galleryImage: css({ backgroundColor: "alpha(currentColor, 0.04)", borderRadius: "8px", padding: "8px" }),
  excerpt: css({ fontSize: "smaller", opacity: 0.7, borderTop: `1px solid ${RULE}`, paddingTop: "6px" }),
  calendar: css({ padding: "0" }),
  calendarWeekdays: css({ borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }),
  calendarDay: css({ borderRadius: "0", padding: "6px", borderRight: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}` }),
  calendarOther: css({ opacity: 0.45 }),
  /** A day's number: small and plain, in the corner of its square. */
  calendarNumber: css({ fontSize: "11px", fontWeight: "400", fontFeatureSettings: '"tnum"' }),
  calendarToday: css({ color: "@accent_color", fontWeight: "700" }),
  calendarChip: css({ fontSize: "smaller", padding: "1px 6px", borderRadius: "4px", backgroundColor: "alpha(@accent_bg_color, 0.15)", color: "@accent_color" }),
} as const;

const pillClasses = new Map<string, string>();

/** The class that draws a choice's pill in its colour, light or dark. */
export function pillClass(color: string | undefined, dark: boolean): string {
  const palette = pillColors(color);
  const { bg, fg } = dark ? palette.dark : palette.light;
  const key = `${bg}${fg}`;
  let name = pillClasses.get(key);
  if (name === undefined) {
    name = css({ backgroundColor: bg, color: fg });
    pillClasses.set(key, name);
  }
  return name;
}

const tintClasses = new Map<string, string>();

/**
 * The class that colours a row or cell behind its values, from a view's
 * colour rules (D53): the choice's own background, light or dark. None for
 * no colour.
 */
export function tintClass(color: string | undefined, dark: boolean): string[] {
  if (color === undefined) return [];
  const palette = pillColors(color);
  const bg = dark ? palette.dark.bg : palette.light.bg;
  let name = tintClasses.get(bg);
  if (name === undefined) {
    name = css({ backgroundColor: bg });
    tintClasses.set(bg, name);
  }
  return [name];
}

