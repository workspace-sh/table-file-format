import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { DEFAULT_TABLE_KEY, NO_TABLE, firstTableKey, firstViews } from "./starting.ts";
import { withFileUnfolded } from "./sidebarPrefs.ts";

const t = (views: string[]): ParsedTable => ({
  path: "x",
  schema: { fields: [] },
  rows: [],
  views: views.map((id) => ({ id, name: id, layout: "table" as const })),
  meta: {},
});

test("the default table first when it's held, else the first held, else none", () => {
  assert.equal(firstTableKey({ "crm/deals": t(["a"]), [DEFAULT_TABLE_KEY]: t(["v1"]) }), DEFAULT_TABLE_KEY);
  assert.equal(firstTableKey({ "crm/deals": t(["a"]), "crm/companies": t(["b"]) }), "crm/deals");
  assert.equal(firstTableKey({}), undefined);
});

test("each table opens on its first view", () => {
  assert.deepEqual(firstViews({ "crm/deals": t(["pipe", "all"]), "crm/empty": t([]) }), { "crm/deals": "pipe", "crm/empty": "" });
});

test("the file on screen is unfolded; prefs are untouched when it isn't folded", () => {
  const prefs = { foldedFiles: ["crm", "shop"], files: true };
  assert.deepEqual(withFileUnfolded(prefs, "crm"), { foldedFiles: ["shop"], files: true });
  assert.equal(withFileUnfolded(prefs, "projects"), prefs);
  const none = {};
  assert.equal(withFileUnfolded(none, "crm"), none);
});

test("the table shown when none is held has one view", () => {
  assert.equal(NO_TABLE.views.length, 1);
  assert.deepEqual(NO_TABLE.rows, []);
});
