import { test } from "node:test";
import assert from "node:assert/strict";
import { ID_LENGTH } from "./id.js";
import { pageChange, parseEditLog, rowChanges, serializeEditEvents, stampEdits, type EditEvent } from "./edit-log.js";

// SPEC section 14's own examples, as the file would hold them.
const SPEC_LINES = [
  '{"id":"e1","at":"2026-10-01T15:00:00Z","by":"leslie","op":"set","row":"p1","field":"status","from":"todo","to":"doing"}',
  '{"id":"e2","at":"2026-10-01T15:02:00Z","by":"leslie","op":"insert","row":"p9","values":{"id":"p9","title":"New"}}',
  '{"id":"e3","at":"2026-10-01T15:03:00Z","by":"leslie","op":"delete","row":"p9","values":{"id":"p9","title":"New"}}',
  '{"id":"e4","at":"2026-10-01T15:05:00Z","by":"leslie","op":"page","row":"p1","from":"Old text","to":"New text"}',
];

test("the spec's examples are read, and written back byte for byte", () => {
  const text = SPEC_LINES.join("\n") + "\n";
  const { events, skipped } = parseEditLog(text);
  assert.equal(skipped, 0);
  assert.deepEqual(
    events.map((e) => e.op),
    ["set", "insert", "delete", "page"],
  );
  assert.equal(serializeEditEvents(events), text);
});

test("a missing or empty file is an empty history", () => {
  assert.deepEqual(parseEditLog(undefined), { events: [], skipped: 0 });
  assert.deepEqual(parseEditLog(null), { events: [], skipped: 0 });
  assert.deepEqual(parseEditLog(""), { events: [], skipped: 0 });
  assert.deepEqual(parseEditLog("\n\n"), { events: [], skipped: 0 });
});

test("a line that can't be parsed, an unknown op and a broken event are skipped and counted; the rest are read", () => {
  const text = [
    SPEC_LINES[0],
    "{not json",
    '{"id":"x1","at":"2026-10-01T15:00:00Z","op":"schema","row":"p1"}',
    '{"id":"x2","at":"2026-10-01T15:00:00Z","op":"set","row":"p1"}',
    '{"at":"2026-10-01T15:00:00Z","op":"set","row":"p1","field":"a"}',
    '{"id":"x4","at":"2026-10-01T15:00:00Z","op":"insert","row":"p1","values":[1]}',
    '{"id":"x5","at":"2026-10-01T15:00:00Z","op":"page","row":"p1","to":7}',
    '"just a string"',
    SPEC_LINES[3],
  ].join("\n");
  const { events, skipped } = parseEditLog(text);
  assert.deepEqual(
    events.map((e) => e.id),
    ["e1", "e4"],
  );
  assert.equal(skipped, 7);
});

test("an event met twice, as when two copies are merged, is kept once", () => {
  const { events, skipped } = parseEditLog([SPEC_LINES[0], SPEC_LINES[1], SPEC_LINES[0]].join("\n"));
  assert.deepEqual(
    events.map((e) => e.id),
    ["e1", "e2"],
  );
  assert.equal(skipped, 0);
});

test("a file with no newline at its end, and Windows line ends, read the same", () => {
  assert.equal(parseEditLog(SPEC_LINES.join("\n")).events.length, 4);
  assert.equal(parseEditLog(SPEC_LINES.join("\r\n") + "\r\n").events.length, 4);
});

test("a cell changed is one set, with from and to; an empty side is left out", () => {
  const before = { id: "p1", title: "A", status: "todo", owner: "sam" };
  assert.deepEqual(rowChanges(before, { ...before, status: "doing" }), [{ op: "set", row: "p1", field: "status", from: "todo", to: "doing" }]);
  // Cleared: null, "" and a missing key are all empty.
  for (const cleared of [{ ...before, owner: null }, { ...before, owner: "" }, { id: "p1", title: "A", status: "todo" }]) {
    assert.deepEqual(rowChanges(before, cleared), [{ op: "set", row: "p1", field: "owner", from: "sam" }]);
  }
  // Filled in from empty.
  assert.deepEqual(rowChanges({ id: "p1", due: null }, { id: "p1", due: "2026-10-01" }), [{ op: "set", row: "p1", field: "due", to: "2026-10-01" }]);
  // One empty for another is no change.
  assert.deepEqual(rowChanges({ id: "p1", due: null }, { id: "p1", due: "" }), []);
  assert.deepEqual(rowChanges({ id: "p1" }, { id: "p1", due: null }), []);
});

test("values are compared as they are stored: a list by what it holds, a number not as its text", () => {
  assert.deepEqual(rowChanges({ id: "p1", tags: ["a", "b"] }, { id: "p1", tags: ["a", "b"] }), []);
  assert.deepEqual(rowChanges({ id: "p1", tags: ["a", "b"] }, { id: "p1", tags: ["b", "a"] }), [
    { op: "set", row: "p1", field: "tags", from: ["a", "b"], to: ["b", "a"] },
  ]);
  assert.deepEqual(rowChanges({ id: "p1", n: 1 }, { id: "p1", n: "1" }), [{ op: "set", row: "p1", field: "n", from: 1, to: "1" }]);
  assert.deepEqual(rowChanges({ id: "p1", done: false }, { id: "p1", done: true }), [{ op: "set", row: "p1", field: "done", from: false, to: true }]);
  // 0 and false are values, not empty.
  assert.deepEqual(rowChanges({ id: "p1", n: 0 }, { id: "p1" }), [{ op: "set", row: "p1", field: "n", from: 0 }]);
});

test("several cells changed are a set each, and nothing changed is nothing", () => {
  const before = { id: "p1", a: 1, b: 2, c: 3 };
  assert.deepEqual(rowChanges(before, { ...before }), []);
  assert.deepEqual(rowChanges(before, { id: "p1", a: 1, b: 20, d: 4 }), [
    { op: "set", row: "p1", field: "b", from: 2, to: 20 },
    { op: "set", row: "p1", field: "d", to: 4 },
    { op: "set", row: "p1", field: "c", from: 3 },
  ]);
});

test("a row added is an insert and one removed a delete, each with the whole row", () => {
  const row = { id: "p9", title: "New", n: 2 };
  assert.deepEqual(rowChanges(undefined, row), [{ op: "insert", row: "p9", values: row }]);
  assert.deepEqual(rowChanges(row, undefined), [{ op: "delete", row: "p9", values: row }]);
  assert.deepEqual(rowChanges(undefined, undefined), []);
});

test("fields worked out from others aren't recorded: not as a set, nor in an insert's or delete's row", () => {
  const computed = new Set(["total"]);
  assert.deepEqual(rowChanges({ id: "p1", n: 1, total: 10 }, { id: "p1", n: 2, total: 20 }, computed), [{ op: "set", row: "p1", field: "n", from: 1, to: 2 }]);
  assert.deepEqual(rowChanges({ id: "p1", n: 1, total: 10 }, { id: "p1", n: 1, total: 20 }, computed), []);
  assert.deepEqual(rowChanges(undefined, { id: "p1", n: 1, total: 10 }, computed), [{ op: "insert", row: "p1", values: { id: "p1", n: 1 } }]);
  assert.deepEqual(rowChanges({ id: "p1", n: 1, total: 10 }, undefined, computed), [{ op: "delete", row: "p1", values: { id: "p1", n: 1 } }]);
});

test("a page's change carries the whole text before and after, as its file holds it; a new page has no from, a cleared one no to", () => {
  assert.deepEqual(pageChange("p1", "Old text\n", "New text\n"), { op: "page", row: "p1", from: "Old text\n", to: "New text\n" });
  // Typed without its last newline, it is said with it: what the file holds.
  assert.deepEqual(pageChange("p1", "Old text\n", "New text"), { op: "page", row: "p1", from: "Old text\n", to: "New text\n" });
  assert.equal(pageChange("p1", "Same\n", "Same"), null);
  assert.deepEqual(pageChange("p1", undefined, "New text"), { op: "page", row: "p1", to: "New text\n" });
  assert.deepEqual(pageChange("p1", "Old text", undefined), { op: "page", row: "p1", from: "Old text\n" });
  assert.deepEqual(pageChange("p1", "Old text", ""), { op: "page", row: "p1", from: "Old text\n" });
  assert.equal(pageChange("p1", "Same", "Same"), null);
  assert.equal(pageChange("p1", undefined, ""), null);
});

test("stamping gives each change an id, the time and who, with the keys in the spec's order", () => {
  let n = 0;
  const events = stampEdits(
    [
      { op: "set", row: "p1", field: "status", from: "todo", to: "doing" },
      { op: "insert", row: "p9", values: { id: "p9", title: "New" } },
    ],
    { at: new Date("2026-10-01T15:00:00Z"), by: "leslie", id: () => `e${++n}` },
  );
  assert.equal(
    serializeEditEvents(events),
    '{"id":"e1","at":"2026-10-01T15:00:00.000Z","by":"leslie","op":"set","row":"p1","field":"status","from":"todo","to":"doing"}\n' +
      '{"id":"e2","at":"2026-10-01T15:00:00.000Z","by":"leslie","op":"insert","row":"p9","values":{"id":"p9","title":"New"}}\n',
  );
});

test("with no name for the viewer there is no by; ids are new and unique; the time is now, in UTC", () => {
  const before = Date.now();
  const events = stampEdits([
    { op: "page", row: "p1", to: "Text" },
    { op: "page", row: "p2", to: "Text" },
  ]);
  const after = Date.now();
  for (const event of events) {
    assert.equal("by" in event, false);
    assert.equal(event.id.length, ID_LENGTH);
    assert.match(event.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Date.parse(event.at) >= before && Date.parse(event.at) <= after);
  }
  assert.notEqual(events[0]!.id, events[1]!.id);
  // One burst of changes is one moment.
  assert.equal(events[0]!.at, events[1]!.at);
});

test("what is written is read back the same", () => {
  const events: EditEvent[] = stampEdits(
    [
      ...rowChanges({ id: "p1", title: "A" }, { id: "p1", title: 'B "quoted"\nline' }),
      ...rowChanges(undefined, { id: "p2", tags: ["x"], n: 1.5 }),
      ...rowChanges({ id: "p3", note: "été" }, undefined),
      pageChange("p1", "one\ntwo\n", "three\n")!,
    ],
    { by: "did:key:z6Mk" },
  );
  const text = serializeEditEvents(events);
  assert.equal(text.split("\n").length, events.length + 1);
  assert.deepEqual(parseEditLog(text), { events, skipped: 0 });
});
