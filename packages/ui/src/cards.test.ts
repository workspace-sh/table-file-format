import { test } from "node:test";
import assert from "node:assert/strict";

import type { Row, TableSchema, View } from "@workspace.sh/table-core";
import {
  boardColumns,
  canStep,
  dateKey,
  galleryLayout,
  initialMonth,
  monthGrid,
  orderAfterDrop,
  orderMovedTo,
  orderSwapped,
  rowsByDay,
} from "./cards.ts";

const schema: TableSchema = {
  fields: [
    { name: "title", type: "string" },
    { name: "stage", type: "string", constraints: { enum: ["lead", "won", "lost"] } },
    { name: "due", type: "date" },
  ],
};
const rows: Row[] = [
  { id: "a", title: "A", stage: "won", due: "2026-03-10" },
  { id: "b", title: "B", stage: "lead", due: "2026-02-03" },
  { id: "c", title: "C", stage: "odd" },
  { id: "d", title: "D", stage: "lead", due: "2026-02-03T09:00:00Z" },
];
const board: View = { id: "v", name: "Board", layout: "board", board_field: "stage" };

test("every choice is a board column, empty ones too, and stray values follow", () => {
  const cols = boardColumns(board, rows, schema);
  assert.deepEqual(cols.keys, ["lead", "won", "lost", "odd"]);
  assert.deepEqual((cols.groups["lead"] ?? []).map((r) => r.id), ["b", "d"]);
});

test("a card dropped on a card lands beside it; on the column, after its last card", () => {
  const cols = boardColumns(board, rows, schema);
  assert.deepEqual(orderAfterDrop(rows, cols, "a", "lead", { id: "b", after: false }), ["a", "b", "c", "d"]);
  assert.deepEqual(orderAfterDrop(rows, cols, "a", "lead", { id: "b", after: true }), ["b", "a", "c", "d"]);
  assert.deepEqual(orderAfterDrop(rows, cols, "c", "lead", null), ["a", "b", "d", "c"]);
  assert.deepEqual(orderAfterDrop(rows, cols, "b", "lost", null), ["a", "c", "d", "b"]);
});

test("a list moves a row to where it's dropped; the keyboard swaps neighbours", () => {
  assert.deepEqual(orderMovedTo(rows, "d", "a"), ["d", "a", "b", "c"]);
  assert.deepEqual(orderMovedTo(rows, "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(orderSwapped(rows, "a", "b"), ["b", "a", "c", "d"]);
});

test("a gallery fits as many 240-wide cards as it can and shares the width", () => {
  assert.deepEqual(galleryLayout(0), { perRow: 1, cardWidth: 240 });
  assert.deepEqual(galleryLayout(500), { perRow: 2, cardWidth: 244 });
  assert.deepEqual(galleryLayout(200), { perRow: 1, cardWidth: 200 });
});

test("a month is six weeks from the locale's first day, padded with its neighbours", () => {
  // February 2026 starts on a Sunday.
  const sunday = monthGrid(new Date(2026, 1, 1), 0);
  assert.equal(sunday.length, 42);
  assert.equal(dateKey(sunday[0]!.date), "2026-02-01");
  const monday = monthGrid(new Date(2026, 1, 1), 1);
  assert.equal(dateKey(monday[0]!.date), "2026-01-26");
  assert.equal(monday[0]!.inMonth, false);
  assert.equal(dateKey(monday[6]!.date), "2026-02-01");
  assert.equal(monday.filter((c) => c.inMonth).length, 28);
});

test("rows are bucketed by day, datetimes by their date, undated left out", () => {
  const byDay = rowsByDay(rows, "due");
  assert.deepEqual((byDay.get("2026-02-03") ?? []).map((r) => r.id), ["b", "d"]);
  assert.equal([...byDay.values()].flat().length, 3);
});

test("a calendar opens on its earliest row's month, inside its range", () => {
  const cal: View = { id: "c", name: "Cal", layout: "calendar", calendar_field: "due" };
  assert.equal(dateKey(initialMonth(cal, rows)), "2026-02-01");
  const ranged = { ...cal, calendar_range: { start: "2026-03-01", end: "2026-04-30" } };
  assert.equal(dateKey(initialMonth(ranged, rows)), "2026-03-01");
  assert.deepEqual(canStep(ranged, new Date(2026, 2, 1)), { prev: false, next: true });
  assert.deepEqual(canStep(ranged, new Date(2026, 3, 1)), { prev: true, next: false });
  assert.equal(dateKey(initialMonth({ ...cal, calendar_field: undefined }, rows, new Date(2026, 6, 9))), "2026-07-01");
});
