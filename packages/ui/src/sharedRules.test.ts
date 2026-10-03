import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field, View } from "@workspace.sh/table-core";
import { columnLabel } from "./cards";
import {
  DEFAULT_ROW_HEIGHT,
  EMPTY_GROUP,
  EMPTY_TEXT,
  MAX_ROW_HEIGHT,
  MAX_ROW_LINES,
  describeCell,
  fittedRowHeight,
  heightForLines,
  linesFor,
  linesNeeded,
  resizedColumnWidth,
  resizedRowHeight,
  rowHeightOf,
  snappedRowHeight,
} from "./display";
import { DECIMAL_PLACES, deprecatedPatch } from "./fieldEdit";
import { formulaPlaceholder } from "./formulaCell";
import { rowNumber } from "./sheets";
import { orderNote, sheetPatch } from "./viewEdit";

// The small rules each view library used to write out for itself.

const stage: Field = { name: "stage", type: "string", constraints: { enum: [{ value: "won", label: "Won" }, "lost"] } };

test("a board column is headed by its choice's label, and rows with no value by Empty", () => {
  assert.equal(columnLabel(stage, "won"), "Won");
  assert.equal(columnLabel(stage, "lost"), "lost");
  assert.equal(columnLabel(stage, "(empty)"), EMPTY_GROUP);
  assert.equal(EMPTY_GROUP, "Empty");
});

test("an empty cell shows the empty text", () => {
  assert.equal(EMPTY_TEXT, "—");
  const shown = describeCell({ name: "x", type: "string" }, "", {});
  assert.equal(shown.kind === "text" ? shown.text : null, EMPTY_TEXT);
});

test("switches set true, and clear to nothing rather than false", () => {
  assert.deepEqual(sheetPatch(true), { coordinates: true });
  assert.deepEqual(sheetPatch(false), { coordinates: undefined });
  assert.deepEqual(deprecatedPatch(true), { deprecated: true });
  assert.deepEqual(deprecatedPatch(false), { deprecated: undefined });
});

test("the dragged-order note shows only for a dragged order with no sort", () => {
  const view: View = { id: "v", name: "V", layout: "table", order: ["a", "b"] };
  assert.match(orderNote(view, [])!, /A?dding a sort replaces it\.$/);
  assert.equal(orderNote(view, [{ field: "x", direction: "asc" }]), undefined);
  assert.equal(orderNote({ ...view, order: [] }, []), undefined);
});

test("a row's number is its saved place in a sheet, else where it's shown", () => {
  assert.equal(rowNumber(new Map([["r", 7]]), "r", 0), 7);
  assert.equal(rowNumber(new Map(), "r", 2), 3);
  assert.equal(rowNumber(undefined, "r", 0), 1);
});

test("decimal places run 0 to 6; the formula example is in the reader's syntax", () => {
  assert.deepEqual([...DECIMAL_PLACES], [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(formulaPlaceholder("stored"), "(round (/ budget 12) 0)");
  assert.equal(formulaPlaceholder("excel"), "=round(budget / 12, 0)");
  assert.equal(formulaPlaceholder(undefined), "=round(budget / 12, 0)");
});

test("a dragged column keeps whole pixels, never under 60; rows stay between 36 and 240", () => {
  assert.equal(resizedColumnWidth(180, 20.4), 200);
  assert.equal(resizedColumnWidth(180, -500), 60);
  assert.equal(resizedRowHeight(44, 30), 74);
  assert.equal(resizedRowHeight(44, -100), 36);
  assert.equal(resizedRowHeight(44, 1000), 240);
});

test("a row's height is in whole lines, and linesFor reads it back", () => {
  assert.equal(heightForLines(1), DEFAULT_ROW_HEIGHT);
  for (let n = 1; n <= MAX_ROW_LINES; n++) assert.equal(linesFor(heightForLines(n)), n);
  assert.ok(heightForLines(MAX_ROW_LINES) <= MAX_ROW_HEIGHT);
  assert.equal(heightForLines(0), DEFAULT_ROW_HEIGHT);
  assert.equal(heightForLines(99), heightForLines(MAX_ROW_LINES));
});

test("a row uses its own height, else the view's, else one line", () => {
  assert.equal(rowHeightOf({}, "r1"), DEFAULT_ROW_HEIGHT);
  assert.equal(rowHeightOf({ rowHeight: 84 }, "r1"), 84);
  assert.equal(rowHeightOf({ rowHeight: 84, rowHeights: { r1: 64 } }, "r1"), 64);
  assert.equal(rowHeightOf({ rowHeight: 84, rowHeights: { r1: 64 } }, "r2"), 84);
});

test("a dragged row snaps to the nearest whole line, within one line and the most", () => {
  assert.equal(snappedRowHeight(44, 9), 44);
  assert.equal(snappedRowHeight(44, 11), 64);
  assert.equal(snappedRowHeight(44, 45), 84);
  assert.equal(snappedRowHeight(84, -200), DEFAULT_ROW_HEIGHT);
  assert.equal(snappedRowHeight(44, 5000), heightForLines(MAX_ROW_LINES));
});

test("fitting a row: short text is one line, long text wraps, newlines count, the most caps it", () => {
  const text = (t: string) => ({ kind: "text" as const, text: t, oneToken: false });
  assert.equal(linesNeeded(text("Docs site"), 200), 1);
  // 168px of room at 6.5px a character: 26 characters a line.
  assert.equal(linesNeeded(text("x".repeat(60)), 200), 3);
  assert.equal(linesNeeded(text("one\ntwo\nthree"), 200), 3);
  assert.equal(linesNeeded({ kind: "text", text: "US$1,234,567.89", oneToken: true }, 60), 1);
  const pills = { kind: "pills" as const, pills: ["alpha", "beta", "gamma", "delta"].map((l) => ({ value: l, label: l })) };
  assert.equal(linesNeeded(pills, 1000), 1);
  assert.equal(linesNeeded(pills, 120), 4);
  assert.equal(
    fittedRowHeight([
      { show: text("Docs site"), width: 200 },
      { show: text("x".repeat(60)), width: 200 },
    ]),
    heightForLines(3),
  );
  assert.equal(fittedRowHeight([{ show: text("x".repeat(5000)), width: 200 }]), heightForLines(MAX_ROW_LINES));
});

