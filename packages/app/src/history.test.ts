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
const walk = (...addresses: string[]) => addresses.reduce<History>((h, a) => visited(h, a), NO_HISTORY);
/** History as its addresses alone, to compare. */
const shape = (h: History) => ({ back: h.back.map((e) => e.address), at: h.at?.address ?? null, forward: h.forward.map((e) => e.address) });

test("a view's address, and whether it still leads anywhere", () => {
  assert.equal(viewAddress("crm/deals", "pipe"), "crm.table#table=deals&view=pipe");
  assert.equal(addressLive(viewAddress("crm/deals", "pipe"), tables, bundles), true);
  assert.equal(addressLive(viewAddress("crm/deals", "gone"), tables, bundles), false, "a deleted view");
  assert.equal(addressLive(viewAddress("crm/leads", "all"), tables, bundles), false, "a deleted table");
  assert.equal(addressLive("", tables, bundles), false);
});

test("visiting pushes, clears forward, and ignores the view already on screen", () => {
  const h = walk("a", "b", "b", "c");
  assert.deepEqual(shape(h), { back: ["a", "b"], at: "c", forward: [] });
  const back = goBack(h)!.history;
  assert.deepEqual(shape(visited(back, "d")), { back: ["a", "b"], at: "d", forward: [] });
  assert.equal(visited(h, "c"), h);
});

test("back and forward walk the stack, and stop at its ends", () => {
  let h = walk("a", "b", "c");
  const b1 = goBack(h)!;
  assert.deepEqual([b1.address, shape(b1.history)], ["b", { back: ["a"], at: "b", forward: ["c"] }]);
  h = goBack(b1.history)!.history;
  assert.deepEqual(shape(h), { back: [], at: "a", forward: ["b", "c"] });
  assert.equal(goBack(h), null);
  assert.equal(canGoBack(h), false);
  const f = goForward(h)!;
  assert.deepEqual([f.address, shape(f.history)], ["b", { back: ["a"], at: "b", forward: ["c"] }]);
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
  assert.deepEqual(shape(back.history), { back: [], at: all, forward: [pipe] });
  // Only stale entries behind: nowhere to go.
  assert.equal(goBack(walk(gone, pipe), live), null);
  assert.equal(canGoBack(walk(gone, pipe), live), false);
  // An entry that is where you are, once a stale one between is dropped, isn't a step.
  assert.equal(goBack(walk(pipe, gone, pipe), live), null);
  const fwd = goForward({ back: [], at: { address: all }, forward: [{ address: gone }, { address: pipe }] }, live)!;
  assert.deepEqual([fwd.address, shape(fwd.history)], [pipe, { back: [all], at: pipe, forward: [] }]);
});

test("each way keeps at most the limit", () => {
  const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => `v${i}`);
  const h = walk(...many);
  assert.equal(h.back.length, HISTORY_LIMIT);
  assert.equal(h.back[0]!.address, "v19");
});

test("a view left keeps its place, and going back or forward hands it back", () => {
  const here = { rowId: "r7", field: "status", page: "r7", search: "site", top: { rowId: "r5", offset: 12 } };
  // Left "a" at `here` for "b".
  const h = visited(visited(NO_HISTORY, "a"), "b", here);
  assert.deepEqual(h.back, [{ address: "a", place: here }]);
  // Back to "a": its place comes with it; "b" is kept forward with where it was left.
  const atB = { rowId: "r2", field: "title" };
  const back = goBack(h, undefined, atB)!;
  assert.deepEqual(back.place, here);
  assert.deepEqual(back.history.forward, [{ address: "b", place: atB }]);
  // And forward again to "b" hands back its place.
  const fwd = goForward(back.history)!;
  assert.deepEqual([fwd.address, fwd.place], ["b", atB]);
  // An empty place isn't kept.
  assert.deepEqual(visited(visited(NO_HISTORY, "a"), "b", {}).back, [{ address: "a" }]);
});
