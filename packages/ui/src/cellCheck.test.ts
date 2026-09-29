import { test } from "node:test";
import assert from "node:assert/strict";

import type { Field } from "@workspace.sh/table-core";
import { checkEntry } from "./cellCheck.ts";

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
