import { mock, test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";

import type { AppAction } from "./appState.ts";
import { scheduleWrite, writeNow, type SaveState } from "./react.ts";

const table = (title: string): ParsedTable => ({ path: "", schema: { fields: [] }, rows: [], views: [], meta: { title } });
const state = { dirty: ["crm"], tables: { "crm/deals": table("Deals") }, bundles: { crm: { title: "CRM" } } };
const settle = () => new Promise((r) => setImmediate(r));

function run(write: (...a: unknown[]) => Promise<void | false>, delayMs = 400) {
  const seen: AppAction[] = [];
  const saving: SaveState[] = [];
  const calls: unknown[][] = [];
  const cancel = scheduleWrite(
    state,
    { write: (...a) => (calls.push(a), write(...a)), delayMs },
    (a) => seen.push(a),
    (s) => saving.push(s),
  );
  return { seen, saving, calls, cancel };
}

test("writes what's dirty after the delay, then says it's written with the tables written", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = run(async () => {});
    mock.timers.tick(399);
    assert.equal(r.calls.length, 0, "not before the delay");
    mock.timers.tick(1);
    assert.deepEqual(r.calls, [[["crm"], state.tables, state.bundles]]);
    await settle();
    assert.deepEqual(r.seen, [{ type: "written", bundles: ["crm"], tables: state.tables }]);
    assert.deepEqual(r.saving, [{ kind: "saving" }, { kind: "saved" }]);
  } finally {
    mock.timers.reset();
  }
});

test("an edit before the delay cancels it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = run(async () => {});
    r.cancel();
    mock.timers.tick(1000);
    assert.equal(r.calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a failed write is shown, and what was dirty stays dirty", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = run(async () => {
      throw new Error("disk full");
    });
    mock.timers.tick(400);
    await settle();
    assert.deepEqual(r.seen, []);
    assert.deepEqual(r.saving, [{ kind: "saving" }, { kind: "failed", message: "disk full" }]);
  } finally {
    mock.timers.reset();
  }
});

test("a write the app held back leaves it dirty", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = run(async () => false);
    mock.timers.tick(400);
    await settle();
    assert.deepEqual(r.seen, []);
    assert.deepEqual(r.saving, [{ kind: "saving" }, { kind: "saved" }]);
  } finally {
    mock.timers.reset();
  }
});

test("nothing dirty, nothing written", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let called = false;
    scheduleWrite({ ...state, dirty: [] }, { write: async () => void (called = true) }, () => {}, () => {});
    mock.timers.tick(1000);
    assert.equal(called, false);
  } finally {
    mock.timers.reset();
  }
});

test("no delay writes on the next turn", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = run(async () => {}, 0);
    assert.equal(r.calls.length, 0, "not during the render");
    mock.timers.tick(0);
    assert.equal(r.calls.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("writing now: at once, true once written; false and still to write when held back or failing; true with nothing dirty", async () => {
  const seen: AppAction[] = [];
  const saving: SaveState[] = [];
  assert.equal(await writeNow(state, { write: async () => {} }, (a) => seen.push(a), (s) => saving.push(s)), true);
  assert.deepEqual(seen, [{ type: "written", bundles: ["crm"], tables: state.tables }]);
  assert.deepEqual(saving, [{ kind: "saving" }, { kind: "saved" }]);
  seen.length = 0;
  assert.equal(await writeNow(state, { write: async () => false }, (a) => seen.push(a), () => {}), false);
  assert.equal(seen.length, 0, "held back: not marked written");
  const failed: SaveState[] = [];
  assert.equal(await writeNow(state, { write: async () => { throw new Error("read-only"); } }, (a) => seen.push(a), (s) => failed.push(s)), false);
  assert.deepEqual(failed.at(-1), { kind: "failed", message: "read-only" });
  assert.equal(seen.length, 0);
  let called = false;
  assert.equal(await writeNow({ ...state, dirty: [] }, { write: async () => { called = true; } }, () => {}, () => {}), true);
  assert.equal(called, false);
});

