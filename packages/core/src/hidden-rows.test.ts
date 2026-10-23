// Rows a view hides by hand (SPEC section 4, D58): left out of the view and
// its index query; a Sheet view keeps their numbers.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildIndex, queryIndex } from "./indexer.js";
import { applyView } from "./query.js";
import { openNodeDatabase } from "./sqlite-node.js";
import { sheetGrid } from "./workbook.js";
import type { ParsedTable } from "./types.js";

const table: ParsedTable = {
  schema: { fields: [{ name: "n", type: "integer" }] },
  rows: [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }],
  views: [{ id: "v", name: "All", layout: "table", hidden: ["b", "gone"] }, { id: "s", name: "Sheet", layout: "table", coordinates: true, hidden: ["b"] }],
  meta: {},
};

test("a view leaves its hidden rows out, and ids that match no row are ignored", () => {
  assert.deepEqual(applyView(table, table.views[0]!).map((r) => r.id), ["a", "c"]);
});

test("a Sheet view keeps a hidden row's number", () => {
  const grid = sheetGrid(table, "s")!;
  assert.equal(grid.position.get("c"), 3);
  assert.equal(grid.hidden.has("b"), true);
});

test("an index leaves them out too", async () => {
  const raw = openNodeDatabase(":memory:");
  const db = { exec: raw.exec, run: raw.run, all: raw.all };
  await buildIndex(db, { name: "t", schema: table.schema, rows: table.rows, key: "k" });
  const shown = (await queryIndex(db, { name: "t", schema: table.schema, query: { hidden: ["b"] } }))!;
  assert.equal(shown.count, 2);
  assert.deepEqual(await shown.ids(0, 2), ["a", "c"]);
});
