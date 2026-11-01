import { test } from "node:test";
import assert from "node:assert/strict";

import { isRowsFileName, layoutRows, nameAfter, nameBetween, rowsFileOrder, utf8Length } from "./rowFiles.js";
import type { Row } from "./types.js";

/** How a file browser orders names: numbers by their value, then the rest as text. */
function naturalOrder(names: string[]): string[] {
  const parts = (s: string) => s.split(/(\d+)/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  return [...names].sort((a, b) => {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      if (typeof x[i] === "number" && typeof y[i] === "number") return (x[i] as number) - (y[i] as number);
      return String(x[i]) < String(y[i]) ? -1 : 1;
    }
    return 0;
  });
}

test("names: the next at the end is a number, a split in between is letters, and they sort the same as bytes and as file browsers (D51)", () => {
  assert.equal(nameAfter("0001.ndjson"), "0002.ndjson");
  assert.equal(nameAfter("0002m.ndjson"), "0003.ndjson");
  assert.equal(nameAfter("9999.ndjson"), "10000.ndjson");
  assert.equal(nameBetween("0002.ndjson", "0003.ndjson"), "0002m.ndjson");
  // Splits keep finding room, before and after, at any depth.
  const names = ["0001.ndjson", "0002.ndjson", "0003.ndjson"];
  for (let i = 0; i < 40; i++) {
    const at = (i * 7) % (names.length - 1);
    names.splice(at + 1, 0, nameBetween(names[at]!, names[at + 1]!));
    const sorted = rowsFileOrder(names);
    assert.deepEqual(sorted, names, `bytes, after ${i} splits`);
    assert.deepEqual(naturalOrder(names), names, `a file browser, after ${i} splits`);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every(isRowsFileName));
  }
  // A split of the last file of a number sorts before the next number, in both orders.
  assert.deepEqual(naturalOrder(["0003.ndjson", "0002.ndjson", "0002m.ndjson"]), ["0002.ndjson", "0002m.ndjson", "0003.ndjson"]);
  assert.equal(isRowsFileName("rows.ndjson"), false);
  assert.equal(isRowsFileName("0001.ndjson.tmp"), false);
});

test("utf8Length counts bytes as UTF-8 would", () => {
  for (const s of ["abc", "é", "日本", "😀 smile", ""]) assert.equal(utf8Length(s), new TextEncoder().encode(s).length, s);
});

const line = (r: Row) => JSON.stringify(r);
const rows = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ id: `r${from + i}`, t: "x".repeat(20) }));

test("rows are laid out from 0001, a new file once one passes the limit", () => {
  const out = layoutRows(rows(0, 10), line, { limit: 100 });
  assert.deepEqual(out.map((f) => f.name), ["0001.ndjson", "0002.ndjson", "0003.ndjson", "0004.ndjson"]);
  assert.equal(out.map((f) => f.text).join(""), rows(0, 10).map((r) => `${line(r)}\n`).join(""));
});

test("each row stays in its file; new rows join the file before them; an overfull middle file splits by letters, the last by number", () => {
  const files = [
    { name: "0001.ndjson", ids: ["r0", "r1"] },
    { name: "0002.ndjson", ids: ["r2", "r3"] },
    { name: "0003.ndjson", ids: ["r4"] },
  ];
  // r1 edited, new rows after r2 (the middle) and after r4 (the end).
  const now = [rows(0, 1)[0]!, { id: "r1", t: "edited" }, rows(2, 3)[0]!, ...rows(10, 14), rows(3, 5)[0]!, rows(3, 5)[1]!, ...rows(20, 26)];
  const out = layoutRows(now, line, { files, limit: 150 });
  // 0002 (in the middle) split by letters; 0003 (the end) by number.
  assert.deepEqual(out.map((f) => f.name), ["0001.ndjson", "0002.ndjson", "0002m.ndjson", "0003.ndjson", "0004.ndjson"]);
  // File order is the rows' order.
  assert.equal(out.map((f) => f.text).join(""), now.map((r) => `${line(r)}\n`).join(""));
  // The first file holds what it held.
  assert.equal(out[0]!.text, `${line(now[0]!)}\n${line(now[1]!)}\n`);
});

test("a file whose rows are all gone is gone, and the next rows go on from the file before it", () => {
  const files = [{ name: "0001.ndjson", ids: ["a"] }, { name: "0002.ndjson", ids: ["b"] }];
  assert.deepEqual(layoutRows([{ id: "a" }, { id: "c" }], line, { files }).map((f) => f.name), ["0001.ndjson"]);
  // No rows at all: one empty file, so the folder is kept (git keeps no empty folder).
  assert.deepEqual(layoutRows([], line, { files }), [{ name: "0001.ndjson", text: "" }]);
});

test("a file left with no rows is gone; lines that couldn't be read stay where they were", () => {
  const files = [{ name: "0001.ndjson", ids: ["a"] }, { name: "0002.ndjson", ids: ["b"] }];
  const out = layoutRows([{ id: "a" }], line, { files, unread: [{ after: "a", text: "{broken" }, { after: null, text: "<<<<<<< HEAD" }, { after: "gone", text: "=======" }] });
  assert.deepEqual(out, [{ name: "0001.ndjson", text: '<<<<<<< HEAD\n{"id":"a"}\n{broken\n=======\n' }]);
});
