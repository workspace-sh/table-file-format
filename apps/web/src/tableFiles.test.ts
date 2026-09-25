import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";

import { newTable } from "@workspace.sh/table-core";
import { archiveFileName, openArchive, tableToArchive } from "./tableFiles.ts";

function sample() {
  const t = newTable("Reading list", "reading-list.table", new Date("2026-09-25T20:00:00Z"));
  return {
    ...t,
    rows: [
      { id: "a1", title: "The Dispossessed" },
      { id: "b2", title: "Braiding Sweetgrass" },
    ],
    // Bodies end with a newline, as the writer writes them.
    bodies: { a1: "# Notes\n\nAnarres.\n" },
  };
}

test("a table downloads as <key>.table.zip and opens back as it was", async () => {
  const t = sample();
  assert.equal(archiveFileName("reading-list"), "reading-list.table.zip");
  const opened = await openArchive(await tableToArchive("reading-list", t), ["projects"]);
  assert.equal(opened.key, "reading-list");
  assert.deepEqual(opened.table.rows, t.rows);
  assert.deepEqual(opened.table.schema, t.schema);
  assert.deepEqual(opened.table.views, t.views);
  assert.deepEqual(opened.table.bodies, t.bodies);
  assert.equal(opened.table.meta.title, "Reading list");
  assert.deepEqual(opened.skipped, []);
});

test("opening one whose name is taken keeps both", async () => {
  const opened = await openArchive(await tableToArchive("reading-list", sample()), ["reading-list"]);
  assert.equal(opened.key, "reading-list-2");
});

test("what the reader skipped is said, and the rest still opens (D25)", async () => {
  const files = unzipSync(await tableToArchive("reading-list", sample()));
  const rows = "reading-list.table/rows.ndjson";
  files[rows] = strToU8(`{"id":"a1","title":"Kept"}\n<<<<<<< HEAD\n{"title":"no id"}\n`);
  const opened = await openArchive(zipSync(files), []);
  assert.deepEqual(opened.table.rows, [{ id: "a1", title: "Kept" }]);
  assert.equal(opened.skipped.length, 2);
  assert.match(opened.skipped[0]!, /^rows\.ndjson line 2: /);
  assert.match(opened.skipped[1]!, /^rows\.ndjson line 3: /);
  assert.equal(opened.table.diagnostics, undefined);
});

test("a file with no table in it is refused, not half-opened", async () => {
  await assert.rejects(openArchive(strToU8("not a zip"), []));
  const files = unzipSync(await tableToArchive("reading-list", sample()));
  delete files["reading-list.table/schema.json"];
  await assert.rejects(openArchive(zipSync(files), []));
});

test("what a file was read with is never written back", async () => {
  const withNotes = { ...sample(), diagnostics: [{ rowIndex: 0, message: "old" }] };
  const opened = await openArchive(await tableToArchive("reading-list", withNotes), []);
  assert.deepEqual(opened.skipped, []);
});
