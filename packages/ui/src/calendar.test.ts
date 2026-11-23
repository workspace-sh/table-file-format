import assert from "node:assert/strict";
import { test } from "node:test";

import { monthGrid, monthGridWeeks } from "./cards";

import type { Row, View } from "@workspace.sh/table-core";

import { choseADay,
  addDays,
  agendaDays,
  calendarEntries,
  dayTimeline,
  hiddenOnDay,
  hourWindow,
  monthAtPosition,
  monthPosition,
  monthsAround,
  MONTHS_EITHER_SIDE,
  moveEntry,
  resizeEntry,
  retimeEntry,
  stepRange,
  weekDays,
  weekSegments,
} from "./calendar";

const view: View = { id: "c", name: "Cal", layout: "calendar", calendar_field: "from", calendar_end_field: "to" };
const row = (id: string, from?: string, to?: string) => ({ id, from, to }) as unknown as Row;
const entry = (from: string, to?: string) => calendarEntries(view, [row("a", from, to)]).entries[0]!;

test("entries are ordered by day and time, and rows with no real date are undated", () => {
  const { entries, undated } = calendarEntries(view, [
    row("late", "2026-03-02T15:00:00"),
    row("early", "2026-03-02T09:30:00"),
    row("first", "2026-03-01"),
    row("none"),
    row("bad", "2026-02-30"),
  ]);
  assert.deepEqual(entries.map((e) => e.row.id), ["first", "early", "late"]);
  assert.deepEqual(entries.map((e) => e.time), [null, "09:30", "15:00"]);
  assert.deepEqual(undated.map((r) => r.id), ["none", "bad"]);
});

test("an end before the start, or an invalid end, is one day", () => {
  assert.equal(entry("2026-03-05", "2026-03-01").end, "2026-03-05");
  assert.equal(entry("2026-03-05", "nope").end, "2026-03-05");
  assert.equal(entry("2026-03-05", "2026-03-07").end, "2026-03-07");
});

test("days count across daylight saving, months and leap years", () => {
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("a week starts on the locale's first day", () => {
  // 4 March 2026 is a Wednesday.
  assert.equal(weekDays("2026-03-04", 1)[0], "2026-03-02");
  assert.equal(weekDays("2026-03-04", 0)[0], "2026-03-01");
  assert.equal(weekDays("2026-03-04", 6)[0], "2026-02-28");
});

test("spans keep one line and are clipped to the week", () => {
  const days = weekDays("2026-03-04", 1);
  const { entries } = calendarEntries(view, [
    row("long", "2026-02-27", "2026-03-10"),
    row("mon", "2026-03-02"),
    row("wed", "2026-03-04", "2026-03-05"),
    row("thu", "2026-03-05"),
  ]);
  const segments = weekSegments(entries, days);
  const of = (id: string) => segments.find((s) => s.entry.row.id === id)!;
  assert.deepEqual([of("long").lane, of("long").column, of("long").span], [0, 0, 7]);
  assert.ok(of("long").continuesBefore && of("long").continuesAfter);
  assert.equal(of("mon").lane, 1);
  assert.equal(of("wed").lane, 1);
  assert.equal(of("thu").lane, 2);
  assert.equal(hiddenOnDay(segments, 3, 2), 1);
  assert.equal(hiddenOnDay(segments, 0, 2), 0);
});

test("an agenda lists a span under each day it covers, inside its range", () => {
  const { entries } = calendarEntries(view, [row("a", "2026-03-01", "2026-03-03")]);
  assert.deepEqual(agendaDays(entries, "2026-03-02", "2026-03-31").map((d) => d.day), ["2026-03-02", "2026-03-03"]);
});

test("a move keeps a floating time and the length", () => {
  const e = entry("2026-03-30T09:30:00", "2026-04-01T17:00:00");
  assert.deepEqual(moveEntry(view, e, "2026-04-02"), {
    from: "2026-04-02T09:30:00",
    to: "2026-04-04T17:00:00",
  });
  assert.deepEqual(moveEntry(view, entry("2026-03-01"), "2026-03-02"), { from: "2026-03-02" });
});

test("a resize never ends before the start, and needs an end field", () => {
  assert.deepEqual(resizeEntry(view, entry("2026-03-05", "2026-03-06"), "2026-03-01"), { to: "2026-03-05" });
  assert.deepEqual(resizeEntry(view, entry("2026-03-05"), "2026-03-08"), { to: "2026-03-08" });
  assert.equal(resizeEntry({ ...view, calendar_end_field: undefined }, entry("2026-03-05"), "2026-03-08"), null);
});

test("a step goes by week or by month, past a short month", () => {
  assert.equal(stepRange("week", "2026-03-04", -1), "2026-02-25");
  assert.equal(stepRange("month", "2026-01-31", 1), "2026-02-01");
  assert.equal(stepRange("agenda", "2026-12-15", 1), "2027-01-01");
});

test("overlapping timed entries share the width; the next free time doesn't", () => {
  const { entries } = calendarEntries(view, [
    row("a", "2026-03-02T09:00:00", "2026-03-02T10:30:00"),
    row("b", "2026-03-02T10:00:00"),
    row("c", "2026-03-02T11:00:00"),
  ]);
  const of = (id: string) => dayTimeline(entries, "2026-03-02").find((t) => t.entry.row.id === id)!;
  assert.deepEqual([of("a").column, of("a").columns], [0, 2]);
  assert.deepEqual([of("b").column, of("b").columns], [1, 2]);
  assert.deepEqual([of("c").column, of("c").columns], [0, 1]);
  assert.equal(of("b").to, 660);
});

test("the hours widen to hold what's in the week", () => {
  const { entries } = calendarEntries(view, [row("a", "2026-03-02T06:30:00", "2026-03-02T20:15:00")]);
  assert.deepEqual(hourWindow(entries, weekDays("2026-03-02", 1)), { first: 6, last: 21 });
  assert.deepEqual(hourWindow([], weekDays("2026-03-02", 1)), { first: 8, last: 18 });
});

test("a drop at a time keeps the length, across midnight too", () => {
  const e = entry("2026-03-02T22:00:00", "2026-03-02T23:30:00");
  assert.deepEqual(retimeEntry(view, e, "2026-03-03", 23 * 60), {
    from: "2026-03-03T23:00:00",
    to: "2026-03-04T00:30:00",
  });
});

const local = (iso: string) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` };
};

test("an instant is on the reader's clock, and sorted as an instant", () => {
  const e = entry("2026-11-27T23:30:00Z");
  assert.deepEqual({ day: e.start, time: e.time }, local("2026-11-27T23:30:00Z"));
  const { entries } = calendarEntries(view, [row("later", "2026-03-02T09:00:00Z"), row("earlier", "2026-03-02T10:00:00+02:00")]);
  assert.deepEqual(entries.map((x) => x.row.id), ["earlier", "later"]);
});

test("moving an instant keeps its clock time and writes UTC, across daylight saving", () => {
  const e = entry("2026-03-27T09:00:00Z");
  const moved = moveEntry(view, e, "2026-03-30").from!;
  assert.match(moved, /Z$/);
  assert.deepEqual(local(moved), { day: "2026-03-30", time: e.time });
});

test("an end at midnight has ended the day before, and keeps doing so when moved", () => {
  const e = entry("2026-03-02T22:00:00", "2026-03-03T00:00:00");
  assert.equal(e.end, "2026-03-02");
  assert.equal(e.endTime, "24:00");
  assert.equal(dayTimeline([e], "2026-03-02")[0]!.to, 1440);
  assert.deepEqual(moveEntry(view, e, "2026-03-05"), { from: "2026-03-05T22:00:00", to: "2026-03-06T00:00:00" });
  assert.deepEqual(resizeEntry(view, e, "2026-03-04"), { to: "2026-03-05T00:00:00" });
});

test("every year a date can hold works, and a step stops at the ends", () => {
  assert.equal(entry("0099-01-01").start, "0099-01-01");
  assert.equal(addDays("0099-12-31", 1), "0100-01-01");
  assert.equal(weekDays("0099-01-07", 1).length, 7);
  assert.equal(stepRange("month", "9999-12-01", 1), "9999-12-01");
  assert.equal(stepRange("week", "9999-12-30", 1), "9999-12-30");
  assert.equal(stepRange("month", "0000-01-01", -1), "0000-01-01");
});

test("months are one apart across a year's end, and come back as the same key", () => {
  assert.equal(monthPosition("2027-01-15") - monthPosition("2026-12-01"), 1);
  for (const key of ["0001-01-01", "2026-11-01", "2026-12-01", "9999-12-01"]) assert.equal(monthAtPosition(monthPosition(key)), key);
});

test("a swipe's range stays inside the calendar's bounds", () => {
  const centre = monthPosition("2026-11-01");
  assert.deepEqual(monthsAround(centre), { first: centre - MONTHS_EITHER_SIDE, last: centre + MONTHS_EITHER_SIDE });
  assert.deepEqual(monthsAround(centre, centre - 2, centre + 3), { first: centre - 2, last: centre + 3 });
  assert.deepEqual(monthsAround(centre, centre, centre), { first: centre, last: centre });
});

test("a month's week count is the one its grid shows, for any first day of the week", () => {
  for (let weekStart = 0; weekStart < 7; weekStart++) {
    for (let position = monthPosition("2000-01-01"); position < monthPosition("2040-01-01"); position++) {
      const month = new Date(Math.floor(position / 12), position % 12, 1);
      assert.equal(monthGridWeeks(month, weekStart), monthGrid(month, weekStart)[35]!.inMonth ? 6 : 5);
    }
  }
});

test("a picker's wheel turning is not a day being chosen", () => {
  assert.equal(choseADay("2026-11-23", "2940-11-23"), false);
  assert.equal(choseADay("2026-11-23", "2026-06-23"), false);
  assert.equal(choseADay("2026-01-31", "2026-02-28"), false);
  assert.equal(choseADay("2028-01-31", "2028-02-29"), false);
  assert.equal(choseADay("2026-11-23", "2026-11-24"), true);
  assert.equal(choseADay("2026-11-23", "2026-12-05"), true);
  assert.equal(choseADay("2026-01-31", "2026-02-27"), true);
});
