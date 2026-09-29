import { test } from "node:test";
import assert from "node:assert/strict";

import { tableKeyFor } from "./tableKey.ts";

test("a table's key is its name, lowercased and hyphenated", () => {
  assert.equal(tableKeyFor("Reading list", []), "reading-list");
  assert.equal(tableKeyFor("  Q3 / Budget!! ", []), "q3-budget");
});

test("a name that clashes gets a number, not the other table", () => {
  assert.equal(tableKeyFor("Projects", ["projects", "tasks"]), "projects-2");
  assert.equal(tableKeyFor("Projects", ["projects", "projects-2"]), "projects-3");
});

test("a name with nothing usable still gets a key", () => {
  assert.equal(tableKeyFor("🚀", []), "table");
  assert.equal(tableKeyFor("🚀", ["table"]), "table-2");
});
