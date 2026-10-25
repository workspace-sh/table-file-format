import { test } from "node:test";
import assert from "node:assert/strict";

import { FormulaError, type Field, type ParsedTable } from "@workspace.sh/table-core";
import { ROW_NUMBER_WIDTH, SQUEEZED_CELL_WIDTH, columnWidths, squeezedWidthOf, roomiestWidthOf, columnsFill, describeCell, relationLabel, rowNumberWidth, totalFor } from "./display.ts";

const plain = {};
const status: Field = {
  name: "status",
  type: "string",
  constraints: { enum: [{ value: "done", label: "Done", color: "green" }, "todo"] },
};
const tags: Field = { name: "tags", type: "array", constraints: { enum: [{ value: "a", label: "Alpha", color: "red" }] } };
const owner: Field = { name: "owner", type: "string", relation: { table: "people", field: "id" } };
const people = {
  schema: { fields: [{ name: "name", type: "string" }] },
  rows: [{ id: "p1", name: "Ada" }],
  views: [],
} as unknown as ParsedTable;

test("a relation shows the related row's title, and a missing row is broken", () => {
  assert.deepEqual(describeCell(owner, "p1", plain, { people }), {
    kind: "relations",
    links: [{ id: "p1", label: "Ada", address: "people#row=p1" }],
  });
  assert.equal(relationLabel(owner.relation!, "gone", { people }), null);
  assert.equal(relationLabel(owner.relation!, "p1", undefined), null);
});

test("a choice is a pill with its label and colour, a list is one pill each", () => {
  assert.deepEqual(describeCell(status, "done", plain), { kind: "pills", pills: [{ value: "done", label: "Done", color: "green" }] });
  assert.deepEqual(describeCell(status, "todo", plain), { kind: "pills", pills: [{ value: "todo", label: "todo" }] });
  assert.deepEqual(describeCell(tags, ["a", "b"], plain), {
    kind: "pills",
    pills: [{ value: "a", label: "Alpha", color: "red" }, { value: "b", label: "b" }],
  });
  assert.deepEqual(describeCell(tags, [], plain), { kind: "text", text: "—", oneToken: false });
});

test("a failed formula shows its code", () => {
  assert.deepEqual(describeCell(undefined, new FormulaError("#DIV/0!", "divided by zero"), plain), { kind: "error", code: "#DIV/0!" });
});

test("links, attachments, formats and plain values", () => {
  const email: Field = { name: "e", type: "string", format: "email" };
  const phone: Field = { name: "p", type: "string", format: "phone" };
  const site: Field = { name: "u", type: "string", format: "url" };
  assert.deepEqual(describeCell(email, "a@b.c", plain), { kind: "link", text: "a@b.c", href: "mailto:a@b.c", external: false });
  assert.deepEqual(describeCell(phone, "+44 (20) 7946", plain), { kind: "link", text: "+44 (20) 7946", href: "tel:+44207946", external: false });
  assert.equal((describeCell(site, "https://x.y", plain) as { external: boolean }).external, true);
  const file: Field = { name: "f", type: "string", attachment: true } as Field;
  assert.deepEqual(describeCell(file, "a.png", plain), { kind: "attachment", fileName: "a.png" });
  const price: Field = { name: "n", type: "number", format: "currency:USD" };
  assert.deepEqual(describeCell(price, 18, { locale: "en-US" }), { kind: "text", text: "$18.00", oneToken: true });
  assert.deepEqual(describeCell({ name: "t", type: "string" }, "", plain), { kind: "text", text: "—", oneToken: false });
  assert.deepEqual(describeCell({ name: "b", type: "boolean" }, true, plain), { kind: "text", text: "true", oneToken: false });
});

test("an average total is rounded to cents; counts are not numeric", () => {
  const rows = [{ id: "1", n: 1 }, { id: "2", n: 2 }, { id: "3", n: 2 }];
  assert.deepEqual(totalFor(rows, "n", "average"), { value: 1.67, numeric: true });
  assert.deepEqual(totalFor(rows, "n", "count"), { value: 3, numeric: false });
});

test("columns fill the table exactly, resized ones keep their width, and narrow tables scroll", () => {
  const w = columnWidths(["a", "b", "c"], { c: 100 }, 503, 2);
  assert.deepEqual([w("a"), w("b"), w("c")], [201, 200, 100]);
  assert.equal(w("a") + w("b") + w("c") + 2, 503);
  const narrow = columnWidths(["a", "b"], { b: 10 }, 200, 2);
  assert.deepEqual([narrow("a"), narrow("b")], [180, 60]);
  assert.equal(columnWidths(["a"], {}, 0, 2)("a"), 180);
  // A little under the comfortable width, the table is kept whole: four columns in 642 are 160 each.
  const squeezed = columnWidths(["a", "b", "c", "d"], {}, 642, 2, SQUEEZED_CELL_WIDTH);
  assert.deepEqual(["a", "b", "c", "d"].map(squeezed), [160, 160, 160, 160]);
  // Too narrow even squeezed (139 each): the comfortable width, and the table scrolls.
  const scrolls = columnWidths(["a", "b", "c", "d"], {}, 558, 2, SQUEEZED_CELL_WIDTH);
  // Not asked to squeeze, columns keep the comfortable width: the same four in 642 scroll.
  assert.equal(columnWidths(["a", "b", "c", "d"], {}, 642, 2)("a"), 180);
  assert.equal(scrolls("a"), 180);
  // Asked to hold the squeezed width past it (a framed table), they stay 140 and the table scrolls.
  assert.equal(columnWidths(["a", "b", "c", "d"], {}, 558, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH)("a"), 140);
  assert.equal(columnWidths(["a", "b", "c", "d"], {}, 642, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH)("a"), 160);
});

test("widening a column makes the table wider, and leaves the others as they were", () => {
  // Four columns in 1002: 250 each.
  const none = columnWidths(["a", "b", "c", "d"], {}, 1002, 2);
  assert.deepEqual(["a", "b", "c", "d"].map(none), [250, 250, 250, 250]);
  // "a" dragged to 400: the rest stay 250, and the table is 1150 wide (it scrolls).
  const wider = columnWidths(["a", "b", "c", "d"], { a: 400 }, 1002, 2);
  assert.deepEqual(["a", "b", "c", "d"].map(wider), [400, 250, 250, 250]);
  // "a" dragged to 100: the rest share its room and the table still fills its width.
  const narrower = columnWidths(["a", "b", "c", "d"], { a: 100 }, 1002, 2);
  assert.deepEqual(["a", "b", "c", "d"].map(narrower), [100, 300, 300, 300]);
});

test("a squeezed table's columns stay squeezed when one is widened: they don't jump to the comfortable width", () => {
  // Five columns in 762, allowed down to 140: 152 each, narrower than the comfortable 180.
  const none = columnWidths(["a", "b", "c", "d", "e"], {}, 762, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(none), [152, 152, 152, 152, 152]);
  // "a" dragged to 300: the rest stay 152, and the table is wider than its window.
  const wider = columnWidths(["a", "b", "c", "d", "e"], { a: 300 }, 762, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(wider), [300, 152, 152, 152, 152]);
  // "a" dragged to 100: the rest share its room.
  const narrower = columnWidths(["a", "b", "c", "d", "e"], { a: 100 }, 762, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(narrower), [100, 165, 165, 165, 165]);
  // The odd pixels that made them fill the window stay where they were, to the pixel.
  const odd = columnWidths(["a", "b", "c", "d", "e"], {}, 764, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(odd), [153, 153, 152, 152, 152]);
  const oddWider = columnWidths(["a", "b", "c", "d", "e"], { c: 300 }, 764, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e"].map(oddWider), [153, 153, 300, 152, 152]);
  // Too many to squeeze in: comfortable and scrolling, resized or not.
  const many = columnWidths(["a", "b", "c", "d", "e", "f", "g"], { a: 300 }, 762, 2, 140);
  assert.deepEqual(["a", "b", "c", "d", "e", "f", "g"].map(many), [300, 180, 180, 180, 180, 180, 180]);
});

test("a sheet's row numbers fit on one line: the gutter is as wide as the largest, and no narrower than it was", () => {
  // Up to three digits: the gutter as it always was.
  for (const n of [1, 9, 99, 999]) assert.equal(rowNumberWidth(n), ROW_NUMBER_WIDTH, String(n));
  // Wider with each digit, and never narrower for a larger number.
  const widths = [1_000, 10_000, 100_000, 1_000_000, 10_000_000].map(rowNumberWidth);
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
  assert.ok(widths[0]! > ROW_NUMBER_WIDTH);
  // 1,000,001 has seven digits: room for seven tabular figures at 11 points, with the padding.
  assert.ok(rowNumberWidth(1_000_001) >= 7 * 6.6 + 12);
  assert.equal(rowNumberWidth(1_000_001), rowNumberWidth(9_999_999));
});

test("columns fill the table when none overflows it, so the layout can share its width", () => {
  // Shared exactly, squeezed or not, and with a column narrowed.
  assert.equal(columnsFill(["a", "b", "c", "d"], {}, 1002, 2), true);
  assert.equal(columnsFill(["a", "b", "c", "d"], {}, 642, 2, SQUEEZED_CELL_WIDTH), true);
  assert.equal(columnsFill(["a", "b", "c", "d"], { a: 100 }, 1002, 2), true);
  // Wider than the table (it scrolls): comfortable columns, or one widened.
  assert.equal(columnsFill(["a", "b", "c", "d"], {}, 558, 2, SQUEEZED_CELL_WIDTH), false);
  assert.equal(columnsFill(["a", "b", "c", "d"], { a: 400 }, 1002, 2), false);
  // Not measured yet, or nothing left to share.
  assert.equal(columnsFill(["a", "b"], {}, 0, 2), false);
  assert.equal(columnsFill(["a", "b"], { a: 300, b: 300 }, 602, 2), false);
});

test("each column squeezes as far as what it holds allows, the narrow ones first", () => {
  const schema = {
    fields: [
      { name: "title", type: "string" as const },
      { name: "done", type: "boolean" as const },
      { name: "stage", type: "string" as const, constraints: { enum: ["Lead", "Won"] } },
      { name: "value", type: "number" as const, format: "currency:USD" },
      { name: "notes", type: "string" as const, format: "markdown" },
      { name: "due", type: "date" as const },
    ],
  };
  const f = (name: string) => schema.fields.find((x) => x.name === name);
  assert.deepEqual(
    ["title", "done", "stage", "value", "notes", "due"].map((n) => squeezedWidthOf(f(n), schema, n === "title")),
    [180, 100, 110, 150, 180, 110],
  );
  const least = (n: string) => squeezedWidthOf(f(n), schema, n === "title");
  const names = ["title", "done", "stage", "value"];
  // Room for 200 each: an even share.
  const roomy = columnWidths(names, {}, 802, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least);
  assert.deepEqual(names.map(roomy), [200, 200, 200, 200]);
  // 560: the title holds 180, the amount 150, and the checkbox and choice share the rest.
  const tight = columnWidths(names, {}, 562, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least);
  assert.deepEqual(names.map(tight), [180, 115, 115, 150]);
  assert.equal(names.map(tight).reduce((a, b) => a + b, 0), 560);
  // Past their sum (540), each holds its own and the table scrolls.
  const scrolls = columnWidths(names, {}, 500, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least);
  assert.deepEqual(names.map(scrolls), [180, 100, 110, 150]);
  // A column dragged wider widens the table; the others keep what they had.
  const wider = columnWidths(names, { title: 400 }, 802, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least);
  assert.deepEqual(names.map(wider), [400, 200, 200, 200]);
});

test("a table's columns stop at their natural widths, and share less by them", () => {
  const schema = {
    fields: [
      { name: "title", type: "string" as const },
      { name: "done", type: "boolean" as const },
      { name: "stage", type: "string" as const, constraints: { enum: ["Lead", "Won"] } },
      { name: "value", type: "number" as const, format: "currency:USD" },
    ],
  };
  const f = (name: string) => schema.fields.find((x) => x.name === name);
  const names = ["title", "done", "stage", "value"];
  const least = (n: string) => squeezedWidthOf(f(n), schema, n === "title");
  const most = (n: string) => roomiestWidthOf(f(n), schema, n === "title");
  assert.deepEqual(names.map(most), [240, 100, 180, 180]);
  // A wide window: each at its natural width, and the table (700) ends there.
  const wide = columnWidths(names, {}, 1602, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least, most);
  assert.deepEqual(names.map(wide), [240, 100, 180, 180]);
  // Less room than that: shared by those widths, none under its least, filling it.
  const tight = columnWidths(names, {}, 602, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least, most);
  assert.equal(names.map(tight).reduce((a, b) => a + b, 0), 600);
  for (const n of names) assert.ok(tight(n) >= least(n) && tight(n) <= most(n), n);
  // A resized column keeps its width; the others still stop at theirs.
  const resized = columnWidths(names, { stage: 300 }, 1602, 2, SQUEEZED_CELL_WIDTH, SQUEEZED_CELL_WIDTH, least, most);
  assert.deepEqual(names.map(resized), [240, 100, 300, 180]);
  // Without the squeezed widths (a phone), never past the comfortable width or a title's.
  const phone = columnWidths(names, {}, 1602, 2, SQUEEZED_CELL_WIDTH, undefined, undefined, most);
  assert.deepEqual(names.map(phone), [240, 180, 180, 180]);
});
