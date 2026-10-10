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
  bodyPath,
  bundleNameOf,
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
    rows: "rows.ndjson",
    views: "views.json",
    meta: "meta.json",
    history: "history.ndjson",
    attachments: "attachments",
    bodies: "bodies",
  });
  assert.deepEqual(REQUIRED_TABLE_FILES, ["schema.json", "rows.ndjson"]);
});

test("paths within a bundle", () => {
  assert.equal(tablePath("companies"), "tables/companies");
  assert.equal(tableEntryPath("companies", TableEntry.rows), "tables/companies/rows.ndjson");
  assert.equal(bodyPath("companies", "c1"), "tables/companies/bodies/c1.md");
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
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/rows.ndjson"), true);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/schema.json"), false);
  assert.equal(isArchivedRowsFile("crm.table/tables/companies/bodies/rows.ndjson"), false);
  assert.equal(isArchivedRowsFile("tables/companies/rows.ndjson"), false);
});
