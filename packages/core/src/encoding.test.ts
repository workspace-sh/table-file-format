// Value encodings, one per type (SPEC section 2 "Value encodings", D30).

import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validator.js";
import { applySort } from "./query.js";
import { completeSeconds } from "./encoding.js";
import type { Field, Row, TableSchema } from "./types.js";

function errorsFor(field: Field, value: unknown): string[] {
  const schema: TableSchema = { fields: [field] };
  return validate(schema, [{ id: "r1", [field.name]: value } as Row]).map((e) => e.message);
}

test("every type's example from the spec validates", () => {
  const examples: Array<[Field["type"], unknown]> = [
    ["string", "Workspace v1"],
    ["number", 4200.5],
    ["integer", 42],
    ["boolean", true],
    ["date", "2026-04-01"],
    ["datetime", "2026-04-01T09:30:00Z"],
    ["datetime", "2026-04-01T11:30:00+02:00"],
    ["datetime", "2026-04-01T09:30:00"],
    ["time", "09:30:00"],
    ["time", "09:30:00.250"],
    ["year", 2026],
    ["duration", "PT1H30M"],
    ["duration", "P3D"],
    ["array", ["a", 1]],
    ["object", { k: "v" }],
    ["geopoint", [-0.1276, 51.5072]],
    ["geojson", { type: "Point", coordinates: [-0.1276, 51.5072] }],
  ];
  for (const [type, value] of examples) {
    assert.deepEqual(errorsFor({ name: "v", type }, value), [], `${type} ${JSON.stringify(value)}`);
  }
});

test("a value in the wrong spelling for its type is refused", () => {
  const wrong: Array<[Field["type"], unknown]> = [
    ["date", "01/04/2026"],
    ["date", "2026-02-30"],
    ["date", "2026-04-01T09:30:00Z"],
    ["datetime", "2026-04-01 09:30:00"],
    ["datetime", "2026-04-01"],
    ["time", "9:30"],
    ["time", "09:30:00Z"],
    ["duration", "90 minutes"],
    ["duration", "P"],
    ["duration", "PT"],
    ["geopoint", [51.5072, 200]],
    ["geopoint", [-0.1276]],
    ["geojson", { coordinates: [0, 0] }],
  ];
  for (const [type, value] of wrong) {
    assert.notDeepEqual(errorsFor({ name: "v", type }, value), [], `${type} ${JSON.stringify(value)}`);
  }
});

test("an integer beyond 2^53 - 1 is refused, because parsers round it silently", () => {
  assert.deepEqual(errorsFor({ name: "v", type: "integer" }, Number.MAX_SAFE_INTEGER), []);
  assert.notDeepEqual(errorsFor({ name: "v", type: "integer" }, 2 ** 53), []);
  assert.notDeepEqual(errorsFor({ name: "v", type: "year" }, -(2 ** 53)), []);
});

test("geojson written as a string by earlier readers is still read", () => {
  assert.deepEqual(errorsFor({ name: "v", type: "geojson" }, '{"type":"Point","coordinates":[0,0]}'), []);
  assert.notDeepEqual(errorsFor({ name: "v", type: "geojson" }, "not json"), []);
});

test("datetimes sort by instant, not by their spelling", () => {
  const schema: TableSchema = { fields: [{ name: "at", type: "datetime" }] };
  const rows: Row[] = [
    { id: "nine-utc", at: "2026-04-01T09:00:00Z" },
    { id: "ten-paris", at: "2026-04-01T10:00:00+02:00" }, // 08:00 UTC
    { id: "floating-half-eight", at: "2026-04-01T08:30:00" }, // as if UTC
  ];
  const sorted = applySort(rows, [{ field: "at", direction: "asc" }], schema);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["ten-paris", "floating-half-eight", "nine-utc"],
  );
});

test("an empty string sorts last, like any other empty value", () => {
  const schema: TableSchema = { fields: [{ name: "name", type: "string" }] };
  const rows: Row[] = [
    { id: "blank", name: "" },
    { id: "b", name: "b" },
    { id: "a", name: "a" },
  ];
  for (const direction of ["asc", "desc"] as const) {
    const sorted = applySort(rows, [{ field: "name", direction }], schema);
    assert.equal(sorted[sorted.length - 1].id, "blank", direction);
  }
});

test("what a browser's time and datetime-local inputs give back is completed to one spelling", () => {
  // Those inputs omit seconds ("09:30", "2026-04-01T09:30"); both would
  // otherwise be refused, and "09:30" beside "09:30:00" would be two
  // spellings of one value.
  assert.equal(completeSeconds("time", "09:30"), "09:30:00");
  assert.equal(completeSeconds("datetime", "2026-04-01T09:30"), "2026-04-01T09:30:00");
  assert.deepEqual(errorsFor({ name: "v", type: "time" }, completeSeconds("time", "09:30")), []);
  // Already complete, another type, or not a time at all: left alone.
  assert.equal(completeSeconds("time", "09:30:15"), "09:30:15");
  assert.equal(completeSeconds("datetime", "2026-04-01T09:30:00Z"), "2026-04-01T09:30:00Z");
  assert.equal(completeSeconds("string", "09:30"), "09:30");
  assert.equal(completeSeconds("time", "half nine"), "half nine");
});
