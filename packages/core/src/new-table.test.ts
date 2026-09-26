import { test } from "node:test";
import assert from "node:assert/strict";
import { newBundle, newTable } from "./new-table.js";
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

test("its meta has its title and when it was made; the bundle carries the format", () => {
  const t = newTable("Reading list", "reading-list.table/tables/reading-list", NOW);
  assert.deepEqual(t.meta, {
    title: "Reading list",
    created_at: "2026-09-25T20:00:00.000Z",
    modified_at: "2026-09-25T20:00:00.000Z",
  });
});

test("a new bundle holds one new table, named, and says what it is (D37)", () => {
  const b = newBundle("Reading list", "reading-list.table", "reading-list", NOW);
  assert.deepEqual(b.meta, {
    format: "table",
    formatVersion: 1,
    title: "Reading list",
    tables: ["reading-list"],
    created_at: "2026-09-25T20:00:00.000Z",
    modified_at: "2026-09-25T20:00:00.000Z",
  });
  assert.deepEqual(Object.keys(b.tables), ["reading-list"]);
  assert.equal(b.tables["reading-list"]!.path, "reading-list.table/tables/reading-list");
});

test("it is valid as made, and each table gets its own view id", () => {
  const a = newTable("A", "a.table", NOW);
  assert.deepEqual(validate(a.schema, a.rows), []);
  assert.notEqual(a.views[0]!.id, newTable("B", "b.table", NOW).views[0]!.id);
});

test("a new bundle round-trips through a .table archive", async () => {
  const b = newBundle("Reading list", "reading-list.table", "reading-list", NOW);
  const back = await readTableArchive(await writeTableArchive("reading-list", b));
  const t = b.tables["reading-list"]!;
  const r = back.tables["reading-list"]!;
  assert.equal(back.path, "reading-list.table");
  assert.deepEqual(r.schema, t.schema);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.views, t.views);
  assert.equal(back.meta.title, "Reading list");
  assert.deepEqual(back.diagnostics ?? [], []);
});
