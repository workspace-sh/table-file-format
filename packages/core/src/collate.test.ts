import { test } from "node:test";
import assert from "node:assert/strict";

import { compareText } from "./collate.js";
import { applySort } from "./query.js";
import type { Row, TableSchema } from "./types.js";

const sorted = (xs: string[]) => xs.slice().sort(compareText);

test("ignores case, then capitals first", () => {
  assert.deepEqual(sorted(["b", "A", "a", "B"]), ["A", "a", "B", "b"]);
  assert.deepEqual(sorted(["apple", "Banana", "cherry"]), ["apple", "Banana", "cherry"]);
});

test("code point order, not UTF-16 order", () => {
  // U+FFFD comes before U+1F600 by code point; compared as UTF-16 units
  // the emoji's high surrogate (0xD83D) would put it first.
  assert.equal("😀" < "�", true, "UTF-16 order, which this must not follow");
  assert.deepEqual(sorted(["😀", "�"]), ["�", "😀"]);
  assert.deepEqual(sorted(["😀", "a", "中"]), ["a", "中", "😀"]);
});

test("the same order whatever the runtime's language", () => {
  // A language's order would put é next to e; the saved order doesn't
  // depend on one, so é follows z on every device.
  assert.deepEqual(sorted(["é", "z", "e"]), ["e", "z", "é"]);
  assert.equal(compareText("Zoë", "zoe") > 0, true);
});

const schema: TableSchema = { fields: [{ name: "name", type: "string" }] };
const rows = (names: (string | undefined)[]): Row[] => names.map((name, i) => ({ id: `r${i}`, ...(name === undefined ? {} : { name }) }));
const names = (rs: Row[]) => rs.map((r) => r.name ?? "∅");

test("a saved sort uses it; empties go last both ways", () => {
  const input = rows(["b", undefined, "A", "é", "a"]);
  assert.deepEqual(names(applySort(input, [{ field: "name", direction: "asc" }], schema)), ["A", "a", "b", "é", "∅"]);
  assert.deepEqual(names(applySort(input, [{ field: "name", direction: "desc" }], schema)), ["é", "b", "a", "A", "∅"]);
});

test("rows that tie keep file order", () => {
  const input = rows(["x", "y", "x", "x"]);
  const out = applySort(input, [{ field: "name", direction: "asc" }], schema);
  assert.deepEqual(out.map((r) => r.id), ["r0", "r2", "r3", "r1"]);
});

test("a personal sort may use the viewer's language instead", () => {
  const french = new Intl.Collator("fr").compare;
  const out = applySort(rows(["z", "é", "e"]), [{ field: "name", direction: "asc" }], schema, { text: french });
  assert.deepEqual(names(out), ["e", "é", "z"]);
});

test("different kinds in one field: numbers, then text, then true/false", () => {
  const mixed: Row[] = [{ id: "a", v: true }, { id: "b", v: "x" }, { id: "c", v: 3 }];
  const s: TableSchema = { fields: [{ name: "v", type: "any" as never }] };
  assert.deepEqual(applySort(mixed, [{ field: "v", direction: "asc" }], s).map((r) => r.id), ["c", "b", "a"]);
});
