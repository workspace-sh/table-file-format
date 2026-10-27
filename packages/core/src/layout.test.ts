// The format's names, held to what SPEC section 1 says. These are typed
// out here on purpose: a constant changed by mistake fails this, and a
// name the spec really changes is changed here and in the spec together.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHIVE_EXTENSION,
  BODY_EXTENSION,
  BUNDLE_EXTENSION,
  BundleEntry,
  REQUIRED_TABLE_FILES,
  TableEntry,
  bodyFileName,
  bodyPath,
  bodyTitleSlug,
  bundleNameOf,
  rowIdOfBodyFile,
  rowTitleIn,
  isArchivedRowsFile,
  tableEntryPath,
  tableNameIn,
  tablePath,
} from "./layout.ts";

test("the names are SPEC section 1's", () => {
  assert.equal(BUNDLE_EXTENSION, ".table");
  assert.equal(ARCHIVE_EXTENSION, ".table.zip");
  assert.equal(BODY_EXTENSION, ".md");
  assert.deepEqual(BundleEntry, { meta: "meta.json", tables: "tables", index: "index.sqlite" });
  assert.deepEqual(TableEntry, {
    schema: "schema.json",
    rowsDir: "rows",
    rows: "rows.ndjson",
    views: "views.json",
    meta: "meta.json",
    history: "history.ndjson",
    attachments: "attachments",
    bodies: "bodies",
  });
  assert.deepEqual(REQUIRED_TABLE_FILES, ["schema.json", "rows"]);
});

test("paths within a bundle", () => {
  assert.equal(tablePath("companies"), "tables/companies");
  assert.equal(tableEntryPath("companies", TableEntry.rows), "tables/companies/rows.ndjson");
  assert.equal(bodyPath("companies", "c1"), "tables/companies/bodies/c1.md");
  assert.equal(bodyPath("companies", "c1", "Atlas Freight"), "tables/companies/bodies/atlas-freight--c1.md");
});

// D64: a page's file name says which row it is, to a person and to a reader.
test("a page's file name carries its row's title, and the reader takes only the id from it", () => {
  assert.equal(bodyFileName("wexwuo344aoowkqiieeb8fk56z", "Atlas Freight"), "atlas-freight--wexwuo344aoowkqiieeb8fk56z.md");
  assert.equal(bodyFileName("r1"), "r1.md");
  assert.equal(bodyFileName("r1", "  !!  "), "r1.md");
  // Letters in any script, lowercase, accents gone; everything else one dash.
  assert.equal(bodyTitleSlug("Chloé's Café: Q4/Q1 — plan"), "chloe-s-cafe-q4-q1-plan");
  assert.equal(bodyTitleSlug("Ünïcödé 東京 Plan"), "unicode-東京-plan");
  assert.equal(bodyTitleSlug("a".repeat(30) + " " + "b".repeat(30)).length <= 40, true);
  assert.ok(!bodyTitleSlug("a".repeat(39) + " b").endsWith("-"));
  // The reader trusts the id, never the title: renamed by hand, it's the same row's page.
  assert.equal(rowIdOfBodyFile("atlas-freight--c1.md"), "c1");
  assert.equal(rowIdOfBodyFile("whatever-someone-typed--c1.md"), "c1");
  assert.equal(rowIdOfBodyFile("c1.md"), "c1");
  assert.equal(rowIdOfBodyFile("notes.txt"), null);
  assert.equal(rowIdOfBodyFile("--.md"), null);
  // An id with the separator in it (one imported from a CSV, say) is written after one, so it reads back whole.
  for (const [id, title] of [["a--b", undefined], ["a--b", "Title"], ["c1", "x--y"]] as const) {
    assert.equal(rowIdOfBodyFile(bodyFileName(id, title)), id, `${id} ${title}`);
  }
});

test("a row's title is its first text field with a value", () => {
  const fields = [{ name: "n", type: "number" }, { name: "a", type: "string" }, { name: "b", type: "string" }];
  assert.equal(rowTitleIn(fields, { id: "r", n: 1, a: "", b: "Bee" }), "Bee");
  assert.equal(rowTitleIn(fields, { id: "r", n: 1 }), undefined);
});

test("a bundle's name, from its folder or its archive", () => {
  assert.equal(bundleNameOf("crm.table"), "crm");
  assert.equal(bundleNameOf("crm.table.zip"), "crm");
  assert.equal(bundleNameOf("crm"), "crm");
});

test("whose a path is", () => {
  assert.equal(tableNameIn("tables/companies/rows.ndjson"), "companies");
  assert.equal(tableNameIn("tables/companies/bodies/c1.md"), "companies");
  assert.equal(tableNameIn("meta.json"), null);
  assert.equal(tableNameIn("tables/companies"), null);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/rows/0001.ndjson"), true);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/rows/0002m.ndjson"), true);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/rows/notes.txt"), false);
  // formatVersion 1's, still read.
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/rows.ndjson"), true);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/schema.json"), false);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/bodies/rows.ndjson"), false);
  assert.equal(isArchivedRowsFile("tables/companies/rows.ndjson"), false);
});
