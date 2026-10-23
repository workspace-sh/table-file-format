import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { checkEntry } from "./cellCheck.ts";
import { draftOf } from "./cellEdit.ts";

const date: Field = { name: "launched", type: "date" };
const count: Field = { name: "count", type: "integer", constraints: { minimum: 0 } };
const price: Field = { name: "price", type: "number", constraints: { required: true } };

test("a value the column can't hold is refused, with the reason", () => {
  assert.deepEqual(checkEntry(price, "twelve"), { ok: false, message: "“twelve” isn't a number." });
  assert.deepEqual(checkEntry(count, "2.5"), { ok: false, message: "“2.5” isn't a whole number." });
  assert.deepEqual(checkEntry(date, "2026-02-30"), { ok: false, message: "“2026-02-30” isn't a date, like 2026-04-01." });
  assert.deepEqual(checkEntry(count, "-1"), { ok: false, message: "Below minimum 0." });
});

test("what fits is saved as the column stores it", () => {
  assert.deepEqual(checkEntry(price, "12.5"), { ok: true, value: 12.5 });
  assert.deepEqual(checkEntry(date, "2026-04-01"), { ok: true, value: "2026-04-01" });
});

test("clearing a cell is always allowed, even a required one", () => {
  assert.deepEqual(checkEntry(price, ""), { ok: true, value: null });
  assert.deepEqual(checkEntry(date, ""), { ok: true, value: "" });
});

test("an early year is asked about once, then kept", () => {
  const asked = checkEntry(date, "0025-12-10");
  assert.equal(asked.ok, false);
  assert.ok(!asked.ok && asked.confirmable);
  assert.ok(!asked.ok && asked.message.includes("Did you mean 2025?"));
  assert.ok(!asked.ok && asked.suggestion === "2025-12-10");
  assert.deepEqual(checkEntry(date, "0025-12-10", true), { ok: true, value: "0025-12-10" });
  // A three-digit year has no obvious meaning to suggest; it's still asked.
  const old = checkEntry(date, "0800-12-25");
  assert.ok(!old.ok && old.confirmable && old.suggestion === undefined);
  // Historical dates from 1000 on are taken as typed.
  assert.deepEqual(checkEntry(date, "1066-10-14"), { ok: true, value: "1066-10-14" });
});

test("a year, a non-finite number and GeoJSON are taken as their types are stored (#568)", () => {
  const f = (type: string) => ({ name: "x", type }) as Field;
  assert.deepEqual(checkEntry(f("year"), "2026"), { ok: true, value: 2026 });
  assert.equal(checkEntry(f("year"), "20.5").ok, false);
  // Not saved as null: refused.
  assert.equal(checkEntry(f("number"), "1e400").ok, false);
  assert.equal(checkEntry(f("number"), "Infinity").ok, false);
  // GeoJSON is written as an object, never its text.
  assert.deepEqual(checkEntry(f("geojson"), '{"type":"Point","coordinates":[-0.13,51.51]}'), { ok: true, value: { type: "Point", coordinates: [-0.13, 51.51] } });
  assert.equal(checkEntry(f("geojson"), "not json").ok, false);
  // And edited from its JSON, not "[object Object]".
  assert.equal(draftOf({ type: "Point", coordinates: [1, 2] }), '{"type":"Point","coordinates":[1,2]}');
});

test("an `any` cell keeps what's typed as what it is: a number, a list, or text (D56)", async () => {
  const { coerceValue } = await import("./cellCheck");
  const any = { name: "v", type: "any" as const };
  assert.equal(coerceValue(any, "42"), 42);
  assert.equal(coerceValue(any, "n/a"), "n/a");
  assert.deepEqual(coerceValue(any, "[1, 2]"), [1, 2]);
  // Digits that aren't an amount stay as written.
  assert.equal(coerceValue(any, "007"), "007");
  assert.equal(coerceValue(any, ""), null);
});
