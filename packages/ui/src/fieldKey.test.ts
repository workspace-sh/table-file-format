import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldKey } from "./fieldKey.ts";

const none = new Set<string>();

test("a typed name becomes a plain key", () => {
  assert.equal(fieldKey("Close date", none), "close_date");
  assert.equal(fieldKey("  Deal value (USD) ", none), "deal_value_usd");
  assert.equal(fieldKey("priority", none), "priority");
});

test("letters of any script are kept", () => {
  assert.equal(fieldKey("価格", none), "価格");
  assert.equal(fieldKey("Café crème", none), "café_crème");
});

test("nothing usable still gives a key", () => {
  assert.equal(fieldKey("", none), "field");
  assert.equal(fieldKey("!!!", none), "field");
});

test("a key in use is never repeated", () => {
  assert.equal(fieldKey("Status", new Set(["status"])), "status_2");
  assert.equal(fieldKey("Status", new Set(["status", "status_2"])), "status_3");
});
