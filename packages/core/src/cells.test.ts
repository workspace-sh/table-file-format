// rows.ndjson, one cell per line (SPEC section 3, DECISIONS D31). The
// conflict texts below are git's own output, captured from real merges
// of this layout — not hand-written approximations of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRowsText, serializeRows } from "./index.js";
import type { Row, TableSchema } from "./types.js";

const schema: TableSchema = {
  fields: [
    { name: "a", type: "integer" },
    { name: "b", type: "string" },
    { name: "c", type: "integer" },
  ],
};

test("a writer puts one cell on each line, rows in id order, fields in schema order, a blank line after each", () => {
  const rows: Row[] = [
    { id: "k25", c: 250, a: 25 },
    { id: "k18", b: "s18", a: 18, extra: true },
    { id: "k31" },
  ];
  assert.equal(
    serializeRows(rows, schema),
    [
      '{"id":"k18","a":18}',
      '{"id":"k18","b":"s18"}',
      '{"id":"k18","extra":true}',
      '{"id":"k25","a":25}',
      '{"id":"k25","c":250}',
      '{"id":"k31"}',
    ]
      .map((line) => `${line}\n\n`)
      .join(""),
  );
});

test("empty cells are left out, and a row with none keeps a line of its own", () => {
  const text = serializeRows([{ id: "r1", a: null, b: "", c: undefined }], schema);
  assert.equal(text, '{"id":"r1"}\n\n');
  assert.deepEqual(parseRowsText(text).rows, [{ id: "r1" }]);
});

test("ids sort by code point, so every writer in every language agrees", () => {
  // UTF-16 order would put U+FF21 (FULLWIDTH A) after U+1F600 (a surrogate
  // pair); code point order puts it before.
  const rows: Row[] = [{ id: "\u{1F600}" }, { id: "Ａ" }, { id: "B" }, { id: "a" }];
  const order = serializeRows(rows, schema)
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as Row).id);
  assert.deepEqual(order, ["B", "a", "Ａ", "\u{1F600}"]);
});

test("what a writer writes, a reader reads back", () => {
  const rows: Row[] = [
    { id: "k18", a: 18, b: "s18" },
    { id: "k25", a: 25, b: "line one\nline two", c: 250 },
  ];
  const { rows: back, diagnostics } = parseRowsText(serializeRows(rows, schema));
  assert.deepEqual(back, rows);
  assert.deepEqual(diagnostics, []);
});

test("a line carrying a whole row still reads — the formatVersion 1 layout is the same rule", () => {
  const { rows, diagnostics } = parseRowsText('{"id":"t1","a":1,"b":"x"}\n{"id":"t2","a":2}\n');
  assert.deepEqual(rows, [
    { id: "t1", a: 1, b: "x" },
    { id: "t2", a: 2 },
  ]);
  assert.deepEqual(diagnostics, []);
});

const CONFLICT_SAME_CELL = `{"id":"k18","a":18}

<<<<<<< HEAD
{"id":"k25","a":1}
=======
{"id":"k25","a":2}
>>>>>>> B

{"id":"k25","b":"s25"}

`;

test("the same cell changed on both sides: the row stays whole, the incoming value wins, and it is reported", () => {
  const { rows, diagnostics } = parseRowsText(CONFLICT_SAME_CELL);
  assert.deepEqual(rows, [
    { id: "k18", a: 18 },
    { id: "k25", a: 2, b: "s25" },
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.rowId, "k25");
  assert.equal(diagnostics[0]!.field, "a");
  assert.match(diagnostics[0]!.message, /merge conflict/);
});

const CONFLICT_DELETE_VS_EDIT = `{"id":"k18","a":18}

<<<<<<< HEAD
=======
{"id":"k25","a":99}

{"id":"k25","b":"s25"}

>>>>>>> B
{"id":"k31","a":31}

`;

test("a row deleted on one side and edited on the other survives, and is reported", () => {
  const { rows, diagnostics } = parseRowsText(CONFLICT_DELETE_VS_EDIT);
  assert.deepEqual(rows, [
    { id: "k18", a: 18 },
    { id: "k25", a: 99, b: "s25" },
    { id: "k31", a: 31 },
  ]);
  assert.ok(diagnostics.some((d) => d.rowId === "k25" && /merge conflict/.test(d.message)));
});

const CONFLICT_DIFF3_EDIT_VS_CLEAR = `{"id":"k25","a":25}

<<<<<<< HEAD
{"id":"k25","b":"mine"}

||||||| 01571f1
{"id":"k25","b":"s25"}

=======
>>>>>>> B
{"id":"k25","c":250}

`;

test("git's diff3 base section is ignored, so a value nobody chose now cannot come back", () => {
  // Ours set b to "mine", theirs cleared it. Reading the base section
  // would put back "s25" — the value both sides moved away from.
  const { rows } = parseRowsText(CONFLICT_DIFF3_EDIT_VS_CLEAR);
  assert.deepEqual(rows, [{ id: "k25", a: 25, b: "mine", c: 250 }]);
});

test("conflict markers are recognised, not reported as malformed lines", () => {
  const { diagnostics } = parseRowsText(CONFLICT_SAME_CELL);
  assert.ok(diagnostics.every((d) => !/malformed/.test(d.message)));
});

test("a cell given two different values outside any conflict keeps the later one, and says so", () => {
  const { rows, diagnostics } = parseRowsText('{"id":"r1","a":1}\n\n{"id":"r1","a":2}\n\n');
  assert.deepEqual(rows, [{ id: "r1", a: 2 }]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.field, "a");
});
