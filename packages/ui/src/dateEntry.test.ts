import { test } from "node:test";
import assert from "node:assert/strict";

import { dateOfStored, localDate, storedOfDate } from "./dateEntry.ts";

test("a date round-trips through the viewer's local midnight", () => {
  const d = dateOfStored("date", "2026-04-01")!;
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 3, 1, 0]);
  assert.equal(storedOfDate("date", d), "2026-04-01");
});

test("a date picked as a UTC midnight (Material's picker) stores that day", () => {
  assert.equal(storedOfDate("date", new Date(Date.UTC(2026, 11, 31)), "utc"), "2026-12-31");
});

test("a time sits on today and stores with seconds", () => {
  const today = new Date(2026, 9, 1);
  const t = dateOfStored("time", "09:30", today)!;
  assert.deepEqual([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()], [2026, 9, 1, 9, 30]);
  assert.equal(storedOfDate("time", t), "09:30:00");
  assert.equal(storedOfDate("time", dateOfStored("time", "23:05:07", today)!), "23:05:07");
});

test("a date and time is the instant, stored in UTC without milliseconds", () => {
  const d = dateOfStored("datetime", "2026-09-22T14:30:00Z")!;
  assert.equal(d.getTime(), Date.UTC(2026, 8, 22, 14, 30));
  assert.equal(storedOfDate("datetime", d), "2026-09-22T14:30:00Z");
  assert.equal(storedOfDate("datetime", dateOfStored("datetime", "2026-09-22T16:30:00+02:00")!), "2026-09-22T14:30:00Z");
});

test("empty or unreadable values start the picker from now", () => {
  assert.equal(dateOfStored("date", ""), null);
  assert.equal(dateOfStored("date", null), null);
  assert.equal(dateOfStored("date", "1 April"), null);
  assert.equal(dateOfStored("time", "half nine"), null);
  assert.equal(dateOfStored("datetime", "soon"), null);
});

test("an early year stays itself: 0026 is not 1926", () => {
  const d = dateOfStored("date", "0026-01-02")!;
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [26, 0, 2]);
  assert.equal(storedOfDate("date", d), "0026-01-02");
  assert.equal(storedOfDate("date", localDate(26, 0, 2)), "0026-01-02");
  const t = dateOfStored("time", "09:30", localDate(26, 0, 2))!;
  assert.equal(t.getFullYear(), 26);
  const u = new Date(Date.UTC(2000, 0, 2));
  u.setUTCFullYear(26);
  assert.equal(storedOfDate("date", u, "utc"), "0026-01-02");
});
