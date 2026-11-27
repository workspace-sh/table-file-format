import { test } from "node:test";
import assert from "node:assert/strict";

import { unreadableWords } from "./unreadableWords.ts";

test("a schema that isn't JSON is named by its place in the table, with its path to repair it", () => {
  const w = unreadableWords("“x.table” couldn’t be read: /var/mobile/Docs/x.table/tables/items/schema.json: isn't JSON (Unexpected token), so this isn't a table");
  assert.equal(w.kind, "schema-damaged");
  assert.equal(w.title, "This Table Is Damaged");
  assert.equal(w.detail, "Its tables/items/schema.json isn’t valid JSON, so the table can’t be read.");
  assert.deepEqual(w.schema, { path: "/var/mobile/Docs/x.table/tables/items/schema.json", inside: "tables/items/schema.json" });
});

test("a file that isn't a zip archive holds no tables; anything else is said without paths", () => {
  assert.equal(unreadableWords(new Error("not a zip archive (no end-of-central-directory)")).kind, "not-a-table");
  assert.equal(unreadableWords("“x.table” couldn’t be read: zip: bad entry").kind, "archive-damaged");
  assert.equal(unreadableWords("something at file:///private/var/a/b/c.table went wrong").detail, "something at c.table went wrong");
});
