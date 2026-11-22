import { test } from "node:test";
import assert from "node:assert/strict";
import { formatValue } from "./format.js";

test("an object reads as its JSON, never [object Object]", () => {
  const value = { type: "Point", coordinates: [2.17, 41.38] };
  assert.equal(formatValue({ name: "area", type: "geojson" }, value), JSON.stringify(value));
  assert.equal(formatValue({ name: "details", type: "object", display: "unknown" }, { a: 1 }), '{"a":1}');
  assert.equal(formatValue({ name: "place", type: "geopoint" }, [2.17, 41.38]), "2.17,41.38");
});
