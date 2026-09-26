import { test } from "node:test";
import assert from "node:assert/strict";

import { DISPLAY_KEY, loadDisplay, saveDisplay } from "./displaySettings.ts";
import type { KeyValueStore } from "./savedTables.ts";

function memory(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  };
}

test("display settings come back as saved", () => {
  const store = memory();
  saveDisplay(store, { locale: "en-GB", dateFormat: "long" });
  assert.deepEqual(loadDisplay(store), { locale: "en-GB", dateFormat: "long" });
});

test("nothing saved means the browser's locale and the table's own formats", () => {
  assert.deepEqual(loadDisplay(memory()), {});
  assert.deepEqual(loadDisplay(null), {});
});

test("anything unknown is dropped, not trusted", () => {
  for (const raw of ["nope", "null", '{"locale":"xx-XX","dateFormat":"dd/mm"}', '{"locale":5}']) {
    assert.deepEqual(loadDisplay(memory({ [DISPLAY_KEY]: raw })), {}, raw);
  }
  assert.deepEqual(loadDisplay(memory({ [DISPLAY_KEY]: '{"locale":"de-DE","dateFormat":"bogus"}' })), { locale: "de-DE" });
});
