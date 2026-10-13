import { mock, test } from "node:test";
import assert from "node:assert/strict";

import type { EditChange, EditEvent, ParsedTable } from "@workspace.sh/table-core";

import { initialAppState, tableApp, type AppAction } from "./appState.ts";
import { NO_EDIT_LOG } from "./editLog.ts";
import { flushNow, scheduleWrite, writeHistoryNow, writeNow, type SaveState } from "./react.ts";

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
    assert.deepEqual(r.calls, [[["crm"], state.tables, state.bundles, []]]);
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

// History

const set = (to: string): EditChange => ({ op: "set", row: "p1", field: "owner", to });
const logged = (pending: Record<string, EditChange[]>) => ({ editLog: { ...NO_EDIT_LOG, on: true, pending } });

function history(append?: (key: string, events: EditEvent[]) => Promise<void | false>, editor?: string) {
  const seen: AppAction[] = [];
  const appended: [string, EditEvent[]][] = [];
  const sent = new Map<string, EditChange>();
  const adapter = { appendHistory: async (key: string, events: EditEvent[]) => (appended.push([key, events]), append?.(key, events)), editor };
  return { seen, appended, write: (state: ReturnType<typeof logged>) => writeHistoryNow(state, adapter, (a) => seen.push(a), sent) };
}

test("history: each table's kept edits are appended as events, in order, and said written", async () => {
  const h = history(undefined, "leslie");
  const a = set("a");
  const b = set("b");
  const c = set("c");
  assert.equal(await h.write(logged({ "crm/deals": [a, b], "crm/contacts": [c] })), true);
  assert.deepEqual(
    h.appended.map(([key, events]) => [key, events.map((e) => e.op === "set" && e.to)]),
    [
      ["crm/deals", ["a", "b"]],
      ["crm/contacts", ["c"]],
    ],
  );
  for (const [, events] of h.appended) {
    for (const e of events) {
      assert.equal(e.by, "leslie");
      assert.equal(typeof e.id, "string");
      assert.ok(!Number.isNaN(Date.parse(e.at)));
    }
  }
  assert.deepEqual(h.seen, [
    { type: "editsWritten", key: "crm/deals", count: 2 },
    { type: "editsWritten", key: "crm/contacts", count: 1 },
  ]);
});

test("history: with no name for the viewer the events have no by; with nothing kept nothing is appended", async () => {
  const h = history();
  await h.write(logged({ "crm/deals": [set("a")] }));
  assert.equal("by" in h.appended[0]![1][0]!, false);
  const none = history();
  assert.equal(await none.write(logged({})), true);
  assert.deepEqual(none.appended, []);
  assert.deepEqual(none.seen, []);
});

test("history: asked again before the state has heard, the same edits aren't written twice; a new one after them is", async () => {
  const h = history();
  const a = set("a");
  const b = set("b");
  const c = set("c");
  const before = logged({ "crm/deals": [a, b] });
  await h.write(before);
  // The state hasn't dropped a and b yet.
  await h.write(before);
  assert.equal(h.appended.length, 1);
  // It still hasn't, and c was edited meanwhile: only c goes, and only c is said.
  await h.write(logged({ "crm/deals": [a, b, c] }));
  assert.deepEqual(
    h.appended.map(([, events]) => events.map((e) => e.op === "set" && e.to)),
    [["a", "b"], ["c"]],
  );
  assert.deepEqual(
    h.seen.map((s) => s.type === "editsWritten" && s.count),
    [2, 1],
  );
  // Once the state has dropped them, what it holds is all new.
  await h.write(logged({ "crm/deals": [set("d")] }));
  assert.equal(h.appended.length, 3);
});

test("history: edits that couldn't be appended stay to write, and are tried again", async () => {
  let fail: "false" | "throw" | null = "false";
  const h = history(async () => {
    if (fail === "throw") throw new Error("disk full");
    if (fail === "false") return false;
  });
  const state = logged({ "crm/deals": [set("a")] });
  assert.equal(await h.write(state), false);
  fail = "throw";
  assert.equal(await h.write(state), false);
  assert.deepEqual(h.seen, []);
  fail = null;
  assert.equal(await h.write(state), true);
  assert.equal(h.appended.length, 3);
  assert.deepEqual(h.seen, [{ type: "editsWritten", key: "crm/deals", count: 1 }]);
});

test("history: an app that doesn't append history is asked nothing", async () => {
  const seen: AppAction[] = [];
  assert.equal(await writeHistoryNow(logged({ "crm/deals": [set("a")] }), {}, (a) => seen.push(a), new Map()), true);
  assert.deepEqual(seen, []);
});

test("history: flushing, as before the app closes, says a page still being typed in, and writes it with the bundles", async () => {
  const page: ParsedTable = { path: "", schema: { fields: [{ name: "title", type: "string" }] }, rows: [{ id: "r1", title: "A" }], views: [], meta: {}, bodies: { r1: "Before\n" } };
  const typing = [
    { type: "openPage", rowId: "r1" },
    { type: "updateBody", rowId: "r1", content: "After" },
  ].reduce((s, a) => tableApp(s, a as AppAction), initialAppState({ tables: { "x/t": page }, bundles: { x: { title: "X" } }, writesHistory: true }));
  assert.deepEqual(typing.editLog.pending, {});
  const seen: AppAction[] = [];
  const appended: [string, EditEvent[]][] = [];
  const wrote: string[][] = [];
  const done = await flushNow(
    typing,
    { write: async (bundles) => void wrote.push(bundles), appendHistory: async (key, events) => void appended.push([key, events]) },
    (a) => seen.push(a),
    () => {},
    new Map(),
  );
  assert.equal(done, true);
  assert.deepEqual(wrote, [["x"]]);
  assert.equal(appended.length, 1);
  const [key, events] = appended[0]!;
  assert.equal(key, "x/t");
  assert.deepEqual(
    events.map(({ id: _id, at: _at, ...rest }) => rest),
    [{ op: "page", row: "r1", from: "Before\n", to: "After\n" }],
  );
  assert.deepEqual(
    seen.map((a) => a.type),
    ["pagesSettled", "written", "editsWritten"],
  );
  // What couldn't be written is said, so the app can stay open.
  assert.equal(await flushNow(typing, { write: async () => {}, appendHistory: async () => false }, () => {}, () => {}, new Map()), false);
});
