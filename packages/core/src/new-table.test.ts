import { test } from "node:test";
import assert from "node:assert/strict";
import { newTable } from "./new-table.js";
import { validate } from "./validator.js";
import { writeTableArchive, readTableArchive } from "./archive.js";

const NOW = new Date("2026-09-25T20:00:00Z");

test("a new table has one text field, one table view and no rows", () => {
  const t = newTable("Reading list", "reading-list.table", NOW);
  assert.deepEqual(t.schema.fields, [{ name: "title", type: "string" }]);
  assert.equal(t.rows.length, 0);
  assert.equal(t.views.length, 1);
  assert.equal(t.views[0]!.layout, "table");
  assert.match(t.views[0]!.id, /^[0-9a-z]{25}$/);
  assert.equal(t.path, "reading-list.table");
});

test("its manifest says what it is and when it was made", () => {
  const t = newTable("Reading list", "reading-list.table", NOW);
  assert.deepEqual(t.meta, {
    format: "table",
    formatVersion: 1,
    title: "Reading list",
    created_at: "2026-09-25T20:00:00.000Z",
    modified_at: "2026-09-25T20:00:00.000Z",
  });
});

test("it is valid as made, and each table gets its own view id", () => {
  const a = newTable("A", "a.table", NOW);
  assert.deepEqual(validate(a.schema, a.rows), []);
  assert.notEqual(a.views[0]!.id, newTable("B", "b.table", NOW).views[0]!.id);
});

test("it round-trips through a .table archive", async () => {
  const t = newTable("Reading list", "reading-list.table", NOW);
  const back = await readTableArchive(await writeTableArchive("reading-list", t));
  assert.equal(back.path, "reading-list.table");
  assert.deepEqual(back.schema, t.schema);
  assert.deepEqual(back.rows, []);
  assert.deepEqual(back.views, t.views);
  assert.equal(back.meta.title, "Reading list");
  assert.deepEqual(back.diagnostics ?? [], []);
});
