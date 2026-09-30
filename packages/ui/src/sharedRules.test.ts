import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field, View } from "@workspace.sh/table-core";
import { columnLabel } from "./cards";
import { EMPTY_GROUP, EMPTY_TEXT, describeCell } from "./display";
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
  assert.equal(describeCell({ name: "x", type: "string" }, "").text, EMPTY_TEXT);
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
