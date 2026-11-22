// What a calendar shows, with no renderer in it: its entries, the days a
// range covers, how spans stack across a week, and the edit a move or a
// resize makes. Days are `YYYY-MM-DD` keys and are counted in UTC, so a
// daylight-saving day is one day like any other. A datetime's day and time
// are read as written: its wall clock, floating or with an offset.

import type { Row, View } from "@workspace.sh/table-core";

export type CalendarRange = "month" | "week" | "agenda";

export interface CalendarEntry {
  row: Row;
  start: string;
  /** Inclusive; the same as `start` for a single day. */
  end: string;
  /** `HH:MM` as written, for a datetime; null for an all-day entry. */
  time: string | null;
  /** The end's `HH:MM`, for a datetime end. */
  endTime: string | null;
}

/** A timed entry placed in a day's grid: minutes from midnight, and its share of the day's width. */
export interface TimedEntry {
  entry: CalendarEntry;
  from: number;
  to: number;
  column: number;
  columns: number;
}

export interface WeekSegment {
  entry: CalendarEntry;
  /** Which stacked line of the week it's on, from 0. */
  lane: number;
  /** Its first column, 0 to 6, and how many it covers. */
  column: number;
  span: number;
  /** It carries on from the week before, or into the next. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

function dayNumber(key: string): number {
  const m = DAY.exec(key);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : Number.NaN;
}

function keyOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The day `n` days after `key`. */
export function addDays(key: string, n: number): string {
  return keyOf(dayNumber(key) + n);
}

/** Days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function realDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.slice(0, 10);
  const day = dayNumber(key);
  return Number.isFinite(day) && keyOf(day) === key ? key : null;
}

function timeOf(value: string): string | null {
  const m = DAY.exec(value);
  return m?.[4] !== undefined ? `${m[4]}:${m[5]}` : null;
}

/** The rows with a date, in date and time order, and those without one. */
export function calendarEntries(view: View, rows: Row[]): { entries: CalendarEntry[]; undated: Row[] } {
  const field = view.calendar_field;
  const endField = view.calendar_end_field;
  const entries: CalendarEntry[] = [];
  const undated: Row[] = [];
  for (const row of rows) {
    const value = field ? row[field] : undefined;
    const start = realDay(value);
    if (start === null) {
      undated.push(row);
      continue;
    }
    const end = endField ? realDay(row[endField]) : null;
    entries.push({
      row,
      start,
      end: end !== null && end >= start ? end : start,
      time: timeOf(value as string),
      endTime: end !== null && end >= start ? timeOf(row[endField!] as string) : null,
    });
  }
  // Stable: rows at the same moment keep the view's order.
  entries.sort((a, b) => a.start.localeCompare(b.start) || (a.time ?? "").localeCompare(b.time ?? ""));
  return { entries, undated };
}

/** The seven days of the week holding `key`, from the locale's first day (0 = Sunday). */
export function weekDays(key: string, weekStart: number): string[] {
  const day = dayNumber(key);
  // 1 January 1970 (day 0) was a Thursday.
  const weekday = (((day + 4) % 7) + 7) % 7;
  const first = day - ((weekday - weekStart + 7) % 7);
  return Array.from({ length: 7 }, (_, i) => keyOf(first + i));
}

/** The entries on `day`, spans included. */
export function entriesOn(entries: CalendarEntry[], day: string): CalendarEntry[] {
  return entries.filter((e) => e.start <= day && day <= e.end);
}

/**
 * A week's entries as bars: longer spans first, each on the first line it
 * fits, so a span keeps one line across the week.
 */
export function weekSegments(entries: CalendarEntry[], days: string[]): WeekSegment[] {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const inWeek = entries
    .filter((e) => e.start <= last && e.end >= first)
    .map((entry) => {
      const from = entry.start < first ? first : entry.start;
      const to = entry.end > last ? last : entry.end;
      return { entry, column: daysBetween(first, from), span: daysBetween(from, to) + 1 };
    })
    .sort((a, b) => a.column - b.column || b.span - a.span);
  const lanes: number[] = [];
  return inWeek.map(({ entry, column, span }) => {
    let lane = lanes.findIndex((free) => free <= column);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = column + span;
    return {
      entry,
      lane,
      column,
      span,
      continuesBefore: entry.start < first,
      continuesAfter: entry.end > last,
    };
  });
}

/** A day's bars within `maxLanes`, and how many entries that leaves out. */
export function hiddenOnDay(segments: WeekSegment[], column: number, maxLanes: number): number {
  return segments.filter((s) => s.lane >= maxLanes && s.column <= column && column < s.column + s.span).length;
}

/** The entries from `from` onwards by day, a span under each day it covers, for an agenda. */
export function agendaDays(
  entries: CalendarEntry[],
  from: string,
  to: string,
): { day: string; entries: CalendarEntry[] }[] {
  const days = new Set<string>();
  for (const e of entries) {
    if (e.end < from || e.start > to) continue;
    const first = e.start < from ? from : e.start;
    const last = e.end > to ? to : e.end;
    for (let d = first; d <= last; d = addDays(d, 1)) days.add(d);
  }
  return [...days].sort().map((day) => ({ day, entries: entriesOn(entries, day) }));
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Whether an entry belongs in a day's time grid, rather than the all-day line. */
export function isTimed(entry: CalendarEntry): boolean {
  return entry.time !== null && entry.start === entry.end;
}

/**
 * A day's timed entries, an hour long when no end says otherwise. Those that
 * overlap share the width side by side.
 */
export function dayTimeline(entries: CalendarEntry[], day: string): TimedEntry[] {
  const timed = entries
    .filter((e) => isTimed(e) && e.start === day)
    .map((entry) => {
      const from = minutesOf(entry.time!);
      const end = entry.endTime ? minutesOf(entry.endTime) : from + 60;
      return { entry, from, to: Math.min(1440, end > from ? Math.max(end, from + 15) : from + 60), column: 0, columns: 1 };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);
  let cluster: TimedEntry[] = [];
  let clusterEnd = -1;
  const close = () => {
    const columns = Math.max(1, ...cluster.map((t) => t.column + 1));
    for (const t of cluster) t.columns = columns;
    cluster = [];
  };
  for (const t of timed) {
    if (t.from >= clusterEnd) close();
    const taken = new Set(cluster.filter((o) => o.to > t.from).map((o) => o.column));
    while (taken.has(t.column)) t.column++;
    cluster.push(t);
    clusterEnd = Math.max(clusterEnd, t.to);
  }
  close();
  return timed;
}

/** The hours a week's grid shows: the working day, widened to hold what's in it. */
export function hourWindow(entries: CalendarEntry[], days: string[]): { first: number; last: number } {
  let first = 8;
  let last = 18;
  for (const day of days) {
    for (const t of dayTimeline(entries, day)) {
      first = Math.min(first, Math.floor(t.from / 60));
      last = Math.max(last, Math.ceil(t.to / 60));
    }
  }
  return { first, last };
}

/** The cells a drop at `minutes` on `day` changes: the start, and a datetime end by as much. */
export function retimeEntry(view: View, entry: CalendarEntry, day: string, minutes: number): Record<string, string> {
  const field = view.calendar_field;
  if (!field) return {};
  const value = String(entry.row[field]);
  const tail = value.length > 16 ? value.slice(16) : ":00";
  const patch: Record<string, string> = { [field]: `${day}T${clock(minutes)}${tail}` };
  const endField = view.calendar_end_field;
  const end = endField ? entry.row[endField] : undefined;
  if (endField && typeof end === "string" && realDay(end) !== null) {
    const days = daysBetween(entry.start, day);
    if (entry.endTime === null || entry.time === null) {
      patch[endField] = onDay(end, addDays(entry.end, days));
    } else {
      const moved = dayNumber(entry.end) * 1440 + minutesOf(entry.endTime) + days * 1440 + minutes - minutesOf(entry.time);
      const endDay = Math.floor(moved / 1440);
      patch[endField] = `${keyOf(endDay)}T${clock(moved - endDay * 1440)}${end.slice(16)}`;
    }
  }
  return patch;
}

/** The date `value` falls on moved to `day`, its time and offset kept. */
function onDay(value: string, day: string): string {
  return day + value.slice(10);
}

/** The cells a move to `day` changes: the start, and an end by as much, so its length is kept. */
export function moveEntry(view: View, entry: CalendarEntry, day: string): Record<string, string> {
  const field = view.calendar_field;
  if (!field) return {};
  const patch: Record<string, string> = { [field]: onDay(String(entry.row[field]), day) };
  const endField = view.calendar_end_field;
  const end = endField ? entry.row[endField] : undefined;
  if (endField && typeof end === "string" && realDay(end) !== null) {
    patch[endField] = onDay(end, addDays(entry.end, daysBetween(entry.start, day)));
  }
  return patch;
}

/** The cell a drag of an entry's end to `day` changes; never before its start. Null without an end field. */
export function resizeEntry(view: View, entry: CalendarEntry, day: string): Record<string, string> | null {
  const endField = view.calendar_end_field;
  if (!endField) return null;
  const to = day < entry.start ? entry.start : day;
  const current = entry.row[endField];
  return { [endField]: typeof current === "string" && realDay(current) !== null ? onDay(current, to) : to };
}

/** The first of the month or the day a step of `by` reaches from `key`. */
export function stepRange(range: CalendarRange, key: string, by: number): string {
  if (range === "week") return addDays(key, 7 * by);
  const m = DAY.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1)).toISOString().slice(0, 10);
}
