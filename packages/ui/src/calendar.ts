// What a calendar shows, with no renderer in it: its entries, the days a
// range covers, how spans stack across a week, and the edit a move or a
// resize makes. Days are `YYYY-MM-DD` keys and are counted in UTC, so a
// daylight-saving day is one day like any other. A datetime with an offset
// names an instant, shown in the reader's clock as a table's cell shows it; a
// floating one is its wall clock wherever it's read (SPEC section 2).

import type { Row, View } from "@workspace.sh/table-core";

export type CalendarRange = "month" | "week" | "agenda";

export interface CalendarEntry {
  row: Row;
  start: string;
  /** Inclusive; the same as `start` for a single day. */
  end: string;
  /** `HH:MM` as written, for a datetime; null for an all-day entry. */
  time: string | null;
  /** The end's `HH:MM`, for a datetime end; `24:00` when it ends at the midnight after `end`. */
  endTime: string | null;
  /** The day the stored end names, which is the day after `end` when it's that midnight. */
  storedEnd: string | null;
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

const OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

function utcDay(year: number, month: number, day: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  return d;
}

function dayNumber(key: string): number {
  const m = DAY.exec(key);
  return m ? utcDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / DAY_MS : Number.NaN;
}

function keyOf(day: number): string {
  const d = new Date(day * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** The day `n` days after `key`. */
export function addDays(key: string, n: number): string {
  return keyOf(dayNumber(key) + n);
}

/** Days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

function localKey(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, "0")}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Whether a stored value names an instant: it has a time and an offset. */
function isInstant(value: string): boolean {
  return value.length > 10 && OFFSET.test(value);
}

/** A stored date or datetime as the reader's day and `HH:MM`; null when it isn't a real one. */
function moment(value: unknown): { day: string; time: string | null } | null {
  if (typeof value !== "string") return null;
  const written = value.slice(0, 10);
  const number = dayNumber(written);
  if (!Number.isFinite(number) || keyOf(number) !== written) return null;
  if (isInstant(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return { day: localKey(d), time: `${two(d.getHours())}:${two(d.getMinutes())}` };
  }
  const m = DAY.exec(value);
  return { day: written, time: m?.[4] !== undefined ? `${m[4]}:${m[5]}` : null };
}

function realDay(value: unknown): string | null {
  return moment(value)?.day ?? null;
}

/** `value` at `day` and `HH:MM` on the reader's clock: an instant in UTC, floating as written. */
function storedAt(value: string, day: string, time: string | null): string {
  if (value.length <= 10) return day;
  const clockTime = time ?? value.slice(11, 16);
  if (!isInstant(value)) return `${day}T${clockTime}${value.slice(16)}`;
  const seconds = Number(value.slice(17, 19)) || 0;
  const m = DAY.exec(day)!;
  const d = new Date(2000, 0, 1);
  d.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(Number(clockTime.slice(0, 2)), Number(clockTime.slice(3, 5)), seconds, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
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
    const stored = endField ? moment(row[endField]) : null;
    const startAt = moment(value)!;
    // A datetime end is a moment, so one at midnight has ended the day before.
    const atMidnight = stored?.time === "00:00" && stored.day > start;
    const end = stored === null ? null : atMidnight ? addDays(stored.day, -1) : stored.day;
    const valid = end !== null && end >= start;
    entries.push({
      row,
      start,
      end: valid ? end : start,
      time: startAt.time,
      endTime: valid ? (atMidnight ? "24:00" : stored!.time) : null,
      storedEnd: valid ? stored!.day : null,
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
  const patch: Record<string, string> = { [field]: value.length > 10 ? storedAt(value, day, clock(minutes)) : `${day}T${clock(minutes)}:00` };
  const endField = view.calendar_end_field;
  const end = endField ? entry.row[endField] : undefined;
  if (endField && typeof end === "string" && entry.storedEnd !== null) {
    const days = daysBetween(entry.start, day);
    if (entry.endTime === null || entry.time === null) {
      patch[endField] = storedAt(end, addDays(entry.storedEnd, days), null);
    } else {
      const moved = dayNumber(entry.end) * 1440 + minutesOf(entry.endTime) + days * 1440 + minutes - minutesOf(entry.time);
      const endDay = Math.floor(moved / 1440);
      patch[endField] = storedAt(end, keyOf(endDay), clock(moved - endDay * 1440));
    }
  }
  return patch;
}

/** The cells a move to `day` changes: the start, and an end by as much, so its length is kept. */
export function moveEntry(view: View, entry: CalendarEntry, day: string): Record<string, string> {
  const field = view.calendar_field;
  if (!field) return {};
  const patch: Record<string, string> = { [field]: storedAt(String(entry.row[field]), day, entry.time) };
  const endField = view.calendar_end_field;
  const end = endField ? entry.row[endField] : undefined;
  if (endField && typeof end === "string" && entry.storedEnd !== null) {
    const time = entry.endTime === "24:00" ? "00:00" : entry.endTime;
    patch[endField] = storedAt(end, addDays(entry.storedEnd, daysBetween(entry.start, day)), time);
  }
  return patch;
}

/** The cell a drag of an entry's end to `day` changes; never before its start. Null without an end field. */
export function resizeEntry(view: View, entry: CalendarEntry, day: string): Record<string, string> | null {
  const endField = view.calendar_end_field;
  if (!endField) return null;
  const to = day < entry.start ? entry.start : day;
  const current = entry.row[endField];
  if (typeof current !== "string" || entry.storedEnd === null) return { [endField]: to };
  if (entry.endTime === "24:00") return { [endField]: storedAt(current, addDays(to, 1), "00:00") };
  return { [endField]: storedAt(current, to, entry.endTime) };
}

/** The first of the month or the day a step of `by` reaches from `key`; `key` itself past year 0000 or 9999. */
export function stepRange(range: CalendarRange, key: string, by: number): string {
  const m = DAY.exec(key);
  if (!m) return key;
  const next = range === "week" ? new Date((dayNumber(key) + 7 * by) * DAY_MS) : utcDay(Number(m[1]), Number(m[2]) - 1 + by, 1);
  const year = next.getUTCFullYear();
  return year < 0 || year > 9999 ? key : next.toISOString().slice(0, 10);
}

/** A month as a count of months, so months next to each other are one apart. Takes a `YYYY-MM…` key. */
export function monthPosition(key: string): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
}

/** The first day of the month at a `monthPosition`, as a key. */
export function monthAtPosition(position: number): string {
  const year = Math.floor(position / 12);
  return `${String(year).padStart(4, "0")}-${String(position - year * 12 + 1).padStart(2, "0")}-01`;
}

/** How many months a swipe can reach either side before its range is moved. */
export const MONTHS_EITHER_SIDE = 600;

/** The months a swipe can reach around `centre`, inside the calendar's own bounds. */
export function monthsAround(centre: number, min?: number, max?: number): { first: number; last: number } {
  const first = Math.max(centre - MONTHS_EITHER_SIDE, min ?? -Infinity);
  const last = Math.min(centre + MONTHS_EITHER_SIDE, max ?? Infinity);
  return { first, last: Math.max(first, last) };
}
