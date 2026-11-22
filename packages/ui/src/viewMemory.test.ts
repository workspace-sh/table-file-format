import assert from "node:assert/strict";
import { test } from "node:test";

import { calendarRangeKey, remember, remembered, setViewMemory, tableViewKey } from "./viewMemory";

test("what's remembered goes to the app's store, by table and by view", () => {
  const kept = new Map<string, string>();
  setViewMemory({ get: (k) => kept.get(k), set: (k, v) => void kept.set(k, v) });
  remember(tableViewKey("/a.table"), "x");
  remember(calendarRangeKey("v1"), "week");
  assert.equal(remembered(tableViewKey("/a.table")), "x");
  assert.equal(remembered(tableViewKey("/b.table")), undefined);
  assert.equal(remembered(calendarRangeKey("v1")), "week");
});
