import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import {
  HISTORY_LIMIT,
  NO_HISTORY,
  addressLive,
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  viewAddress,
  visited,
  type History,
} from "./history.ts";

const t = (views: string[]): ParsedTable => ({
  path: "x",
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: [],
  views: views.map((id) => ({ id, name: id, layout: "table" as const })),
  meta: {},
});
const tables = { "crm/deals": t(["all", "pipe"]), "crm/companies": t(["all"]) };
const bundles = { crm: { title: "CRM", tables: ["deals", "companies"] } };
const walk = (...addresses: string[]) => addresses.reduce<History>(visited, NO_HISTORY);

test("a view's address, and whether it still leads anywhere", () => {
  assert.equal(viewAddress("crm/deals", "pipe"), "crm.table#table=deals&view=pipe");
  assert.equal(addressLive(viewAddress("crm/deals", "pipe"), tables, bundles), true);
  assert.equal(addressLive(viewAddress("crm/deals", "gone"), tables, bundles), false, "a deleted view");
  assert.equal(addressLive(viewAddress("crm/leads", "all"), tables, bundles), false, "a deleted table");
  assert.equal(addressLive("", tables, bundles), false);
});

test("visiting pushes, clears forward, and ignores the view already on screen", () => {
  const h = walk("a", "b", "b", "c");
  assert.deepEqual(h, { back: ["a", "b"], at: "c", forward: [] });
  const back = goBack(h)!.history;
  assert.deepEqual(visited(back, "d"), { back: ["a", "b"], at: "d", forward: [] });
  assert.equal(visited(h, "c"), h);
});

test("back and forward walk the stack, and stop at its ends", () => {
  let h = walk("a", "b", "c");
  const b1 = goBack(h)!;
  assert.deepEqual([b1.address, b1.history], ["b", { back: ["a"], at: "b", forward: ["c"] }]);
  h = goBack(b1.history)!.history;
  assert.deepEqual(h, { back: [], at: "a", forward: ["b", "c"] });
  assert.equal(goBack(h), null);
  assert.equal(canGoBack(h), false);
  const f = goForward(h)!;
  assert.deepEqual([f.address, f.history], ["b", { back: ["a"], at: "b", forward: ["c"] }]);
  assert.equal(canGoForward(goForward(f.history)!.history), false);
  assert.equal(goBack(NO_HISTORY), null);
});

test("stale entries are skipped and dropped, never landed on", () => {
  const gone = viewAddress("crm/deals", "gone");
  const all = viewAddress("crm/deals", "all");
  const pipe = viewAddress("crm/deals", "pipe");
  const live = (a: string) => addressLive(a, tables, bundles);
  const h = walk(all, gone, pipe);
  const back = goBack(h, live)!;
  assert.equal(back.address, all);
  assert.deepEqual(back.history, { back: [], at: all, forward: [pipe] });
  // Only stale entries behind: nowhere to go.
  assert.equal(goBack(walk(gone, pipe), live), null);
  assert.equal(canGoBack(walk(gone, pipe), live), false);
  // An entry that is where you are, once a stale one between is dropped, isn't a step.
  assert.equal(goBack(walk(pipe, gone, pipe), live), null);
  const fwd = goForward({ back: [], at: all, forward: [gone, pipe] }, live)!;
  assert.deepEqual([fwd.address, fwd.history], [pipe, { back: [all], at: pipe, forward: [] }]);
});

test("each way keeps at most the limit", () => {
  const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => `v${i}`);
  const h = walk(...many);
  assert.equal(h.back.length, HISTORY_LIMIT);
  assert.equal(h.back[0], "v19");
});
