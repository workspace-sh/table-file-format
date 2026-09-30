// The views that show rows as cards (board, gallery, list, calendar):
// which cards go where, and where one lands when it's moved. What every
// renderer of them needs, with no renderer in it.

import { applyGroup, enumOptions, enumValues, type Field, type Row, type TableSchema, type View } from "@workspace.sh/table-core";

import { EMPTY_GROUP, formatValue, visibleFields } from "./display";

/** A board's columns: the group field, its column keys in order, and each column's rows. */
export interface BoardColumns {
  field: string;
  /** Column keys, as stored values; `(empty)` for rows with none. */
  keys: string[];
  groups: Record<string, Row[]>;
}

/**
 * A board groups by `view.board_field` (`status` when unset). A choice
 * field shows every choice as a column, even an empty one, so a card can
 * be dropped into it; values outside the choices follow them.
 */
export function boardColumns(view: View, rows: Row[], schema: TableSchema): BoardColumns {
  const field = view.board_field ?? "status";
  const choices = enumValues(schema.fields.find((f) => f.name === field));
  const groups = applyGroup(rows, field, schema);
  const keys = choices.length > 0 ? [...choices, ...Object.keys(groups).filter((k) => !choices.includes(k))] : Object.keys(groups);
  return { field, keys, groups };
}

/** The fields a card shows: the view's, less the one its column (or hero image) already says. */
export function cardFields(view: View, schema: TableSchema, without?: string): string[] {
  return visibleFields(view, schema).filter((f) => f !== without);
}

/** The value a board column stores: `(empty)` is no value at all. */
export function columnValue(key: string): string | null {
  return key === "(empty)" ? null : key;
}

/** Which board column a row sits in. */
export function columnOf(row: Row, field: string): string {
  const v = row[field];
  return v === undefined || v === null || v === "" ? "(empty)" : String(v);
}

/**
 * The whole view's row order with `dragged` moved into `column`: before
 * or after the card `slot` names, or after the column's last card when
 * it was dropped on the column itself.
 */
export function orderAfterDrop(
  rows: Row[],
  columns: BoardColumns,
  dragged: string,
  column: string,
  slot: { id: string; after: boolean } | null,
): string[] {
  const ids = rows.map((r) => r.id).filter((id) => id !== dragged);
  let at: number;
  if (slot) {
    at = ids.indexOf(slot.id) + (slot.after ? 1 : 0);
  } else {
    const inColumn = (columns.groups[column] ?? []).map((r) => r.id).filter((id) => id !== dragged);
    const last = inColumn[inColumn.length - 1];
    at = last !== undefined ? ids.indexOf(last) + 1 : ids.length;
  }
  ids.splice(at, 0, dragged);
  return ids;
}

/** The order with `dragged` moved to where `target` is: a list's drag and drop. */
export function orderMovedTo(rows: Row[], dragged: string, target: string): string[] {
  const ids = rows.map((r) => r.id);
  const from = ids.indexOf(dragged);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1) return ids;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved!);
  return ids;
}

/** The order with two rows swapped: a card moved up or down its column from the keyboard. */
export function orderSwapped(rows: Row[], a: string, b: string): string[] {
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i === -1 || j === -1) return ids;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  return ids;
}

/** Gap between board columns. The web views' `styles.board.gap` restates it for StyleX. */
export const BOARD_GAP = 12;
/** Narrowest a gallery card gets before the row wraps. */
export const MIN_GALLERY_CARD_WIDTH = 240;
/** Gap between gallery cards. The web views' `styles.gallery.gap` restates it for StyleX. */
export const GALLERY_GAP = 12;

/** As many cards as fit a row at MIN_GALLERY_CARD_WIDTH, sharing the width. */
export function galleryLayout(containerWidth: number): { perRow: number; cardWidth: number } {
  if (containerWidth <= 0) return { perRow: 1, cardWidth: MIN_GALLERY_CARD_WIDTH };
  const perRow = Math.max(1, Math.floor((containerWidth + GALLERY_GAP) / (MIN_GALLERY_CARD_WIDTH + GALLERY_GAP)));
  return { perRow, cardWidth: Math.floor((containerWidth - (perRow - 1) * GALLERY_GAP) / perRow) };
}

/** A card's or chip's title: its first field's value, or its id. */
export function rowTitle(row: Row, titleField: string | undefined): string {
  return titleField ? formatValue(row[titleField]) : row.id;
}

// ─── Calendar ──────────────────────────────────────────────────────────

/** How many entries a day shows by title before "+N more". */
export const CALENDAR_CHIPS_PER_DAY = 3;

/** A `YYYY-MM-DD` (or ISO datetime) as that local day; null when it isn't one. */
export function localDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A day's key, `YYYY-MM-DD`, as rows are bucketed by it. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The months a calendar may show (`calendar_range`), each bound as the
 * first of its month. An invalid date is no bound.
 */
export function calendarBounds(view: View): { start: Date | null; end: Date | null } {
  const range = view.calendar_range;
  const bound = (v: string | undefined) => {
    const d = v ? localDay(v) : null;
    return d ? firstOfMonth(d) : null;
  };
  return { start: bound(range?.start), end: bound(range?.end) };
}

/**
 * The month a calendar opens on: the earliest dated row's, so past data
 * doesn't open on an empty month; else this month. Kept inside the range.
 */
export function initialMonth(view: View, rows: Row[], now = new Date()): Date {
  const field = view.calendar_field;
  const earliest = field
    ? rows
        .map((r) => r[field])
        .filter((v): v is string => typeof v === "string")
        .map(localDay)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0]
    : undefined;
  let month = firstOfMonth(earliest ?? now);
  const { start, end } = calendarBounds(view);
  if (start && month < start) month = start;
  if (end && month > end) month = end;
  return month;
}

/**
 * A month as six weeks of seven days, starting on the locale's first day
 * of the week (`weekStart`, 0 = Sunday), padded with the neighbouring
 * months so the grid is always 42 days.
 */
export function monthGrid(month: Date, weekStart: number): { date: Date; inMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const leading = (new Date(year, m, 1).getDay() - weekStart + 7) % 7;
  const days = new Date(year, m + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = leading; i > 0; i--) cells.push({ date: new Date(year, m, 1 - i), inMonth: false });
  for (let d = 1; d <= days; d++) cells.push({ date: new Date(year, m, d), inMonth: true });
  for (let d = 1; cells.length < 42; d++) cells.push({ date: new Date(year, m + 1, d), inMonth: false });
  return cells;
}

/** Rows by the day in `field` (`YYYY-MM-DD`), in the order given. Undated rows are left out. */
export function rowsByDay(rows: Row[], field: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "string" || value.length < 10) continue;
    const key = value.slice(0, 10);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/** Whether the months before and after `month` are inside the calendar's range. */
export function canStep(view: View, month: Date): { prev: boolean; next: boolean } {
  const { start, end } = calendarBounds(view);
  return { prev: !start || month > start, next: !end || month < end };
}

/** A board column's heading: the choice's label when it has one, and "Empty" for rows with no value. */
export function columnLabel(field: Field | undefined, key: string): string {
  if (key === "(empty)") return EMPTY_GROUP;
  return enumOptions(field).find((o) => o.value === key)?.label ?? key;
}

/**
 * Option/Alt+arrow on a board card: what dragging it does, from the
 * keyboard. ← → move it to the next column (`column`, a board key as
 * `columnValue` reads it), ↑ ↓ swap it with its neighbour in the column.
 * Null at an edge, or for another key.
 */
export function boardCardMove(
  columns: readonly (readonly string[])[],
  columnKeys: readonly string[],
  id: string,
  key: string,
): { kind: "column"; column: string } | { kind: "swap"; with: string } | null {
  const c = columns.findIndex((col) => col.includes(id));
  if (c < 0) return null;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const column = columnKeys[c + (key === "ArrowLeft" ? -1 : 1)];
    return column === undefined ? null : { kind: "column", column };
  }
  if (key === "ArrowUp" || key === "ArrowDown") {
    const col = columns[c]!;
    const neighbour = col[col.indexOf(id) + (key === "ArrowUp" ? -1 : 1)];
    return neighbour === undefined ? null : { kind: "swap", with: neighbour };
  }
  return null;
}

