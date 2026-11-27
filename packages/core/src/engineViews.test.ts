// Views of a table the engine holds (#867, step 2) run the same cases, over the same seeded rows,
// as the SQLite index does (viewCases.ts): what they answer is what memory gives.
import { test } from "node:test";
import assert from "node:assert/strict";

import { heldViewRows, holdRows } from "./engineViews.js";
import { schema, viewCases } from "./viewCases.js";

// Without its formula field: the engine doesn't work formulas out until step 4, and a table with
// them isn't answered (below).
const held = { fields: schema.fields.filter((f) => !f.computed) };

viewCases(
  test,
  assert,
  "a table the engine holds",
  async (rows, bodies, schema) => {
    const h = holdRows(schema.fields.map((f) => f.name), rows);
    return (query) => heldViewRows(h, { schema, ...(bodies ? { bodies } : {}) }, query);
  },
  { schema: held },
);

test("a table with formulas isn't answered by the engine: their results aren't held", () => {
  const h = holdRows(schema.fields.map((f) => f.name), [{ id: "a", n: 1 }]);
  assert.equal(heldViewRows(h, { schema }, {}), null);
  assert.notEqual(heldViewRows(h, { schema: held }, {}), null);
  assert.equal(heldViewRows(h, { schema: held, cells: [{ id: "a", field: "n", expr: "(+ 1 1)", dialect: "table-expr-v1" }] }, {}), null);
});
