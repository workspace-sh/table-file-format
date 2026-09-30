import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";

import { newBundle, newTable } from "@workspace.sh/table-core";
import type { ParsedBundle } from "@workspace.sh/table-core";
import { archiveFileName, bundleToArchive, importSkippedText, openArchive, openFailedText, type OpenedBundle, exportFailedText } from "./tableFiles.ts";

const NOW = new Date("2026-09-25T20:00:00Z");

function sample(): ParsedBundle {
  const b = newBundle("Reading list", "reading-list.table", "books", NOW);
  const books = b.tables.books!;
  const authors = newTable("Authors", "reading-list.table/tables/authors", NOW);
  return {
    ...b,
    meta: { ...b.meta, tables: ["books", "authors"] },
    tables: {
      books: {
        ...books,
        rows: [
          { id: "a1", title: "The Dispossessed" },
          { id: "b2", title: "Braiding Sweetgrass" },
        ],
        // Bodies end with a newline, as the writer writes them.
        bodies: { a1: "# Notes\n\nAnarres.\n" },
      },
      authors: { ...authors, rows: [{ id: "u1", title: "Ursula K. Le Guin" }] },
    },
  };
}

test("a bundle downloads as <key>.table.zip and opens back as it was, every table (D37)", async () => {
  const b = sample();
  assert.equal(archiveFileName("reading-list"), "reading-list.table.zip");
  const opened = await openArchive(await bundleToArchive("reading-list", b), ["projects"]);
  assert.equal(opened.key, "reading-list");
  assert.deepEqual(opened.bundle.meta.tables, ["books", "authors"]);
  for (const name of ["books", "authors"]) {
    assert.deepEqual(opened.bundle.tables[name]!.rows, b.tables[name]!.rows, name);
    assert.deepEqual(opened.bundle.tables[name]!.schema, b.tables[name]!.schema, name);
    assert.deepEqual(opened.bundle.tables[name]!.views, b.tables[name]!.views, name);
  }
  assert.deepEqual(opened.bundle.tables.books!.bodies, b.tables.books!.bodies);
  assert.equal(opened.bundle.meta.title, "Reading list");
  assert.deepEqual(opened.skipped, []);
});

test("opening one whose name is taken keeps both", async () => {
  const opened = await openArchive(await bundleToArchive("reading-list", sample()), ["reading-list"]);
  assert.equal(opened.key, "reading-list-2");
});

test("what the reader skipped is said, per table, and the rest still opens (D25)", async () => {
  const files = unzipSync(await bundleToArchive("reading-list", sample()));
  const rows = "reading-list.table/tables/books/rows.ndjson";
  files[rows] = strToU8(`{"id":"a1","title":"Kept"}\n<<<<<<< HEAD\n{"title":"no id"}\n`);
  const opened = await openArchive(zipSync(files), []);
  assert.deepEqual(opened.bundle.tables.books!.rows, [{ id: "a1", title: "Kept" }]);
  assert.equal(opened.skipped.length, 2);
  assert.match(opened.skipped[0]!, /^books: rows\.ndjson line 2: /);
  assert.match(opened.skipped[1]!, /^books: rows\.ndjson line 3: /);
  assert.equal(opened.bundle.tables.books!.diagnostics, undefined);
});

test("a file with no table in it is refused, not half-opened", async () => {
  await assert.rejects(openArchive(strToU8("not a zip"), []));
  const files = unzipSync(await bundleToArchive("reading-list", sample()));
  for (const name of Object.keys(files)) if (name.includes("/schema.json")) delete files[name];
  await assert.rejects(openArchive(zipSync(files), []), /isn't a table/);
});

test("what a file was read with is never written back", async () => {
  const b = sample();
  const withNotes = { ...b, tables: { ...b.tables, books: { ...b.tables.books!, diagnostics: [{ rowIndex: 0, message: "old" }] } } };
  const opened = await openArchive(await bundleToArchive("reading-list", withNotes), []);
  assert.deepEqual(opened.skipped, []);
});

test("what opening says: the skipped lines under a count, nothing when it read cleanly", () => {
  const opened = (skipped: string[]): OpenedBundle => ({ key: "crm", bundle: { path: "crm", meta: { title: "CRM" }, tables: {} }, skipped });
  assert.equal(importSkippedText(opened([])), null);
  assert.deepEqual(importSkippedText(opened(["deals: rows.ndjson line 3: bad"])), {
    heading: `Opened "CRM", but skipped 1 thing it couldn't read:`,
    body: "deals: rows.ndjson line 3: bad",
  });
  assert.match(importSkippedText(opened(["a", "b"]))!.heading, /skipped 2 things/);
  assert.equal(openFailedText("x.zip", new Error("not a zip")), "Couldn't open x.zip: not a zip");
});


test("an export that fails says which file and why", () => {
  assert.equal(exportFailedText("crm.table.zip", new Error("disk full")), "Couldn't export crm.table.zip: disk full");
  assert.equal(exportFailedText("crm.table.zip", "no"), "Couldn't export crm.table.zip: no");
});
