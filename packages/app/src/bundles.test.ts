import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { addressTarget, bundleTables, fromBundle, keyForAddress, tableKeysIn, toBundle } from "./bundles.ts";

const t = (title: string): ParsedTable => ({
  path: title,
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: [],
  views: [{ id: "v", name: "All", layout: "table" }],
  meta: { title },
});

const tables = {
  "crm/companies": t("Companies"),
  "crm/deals": t("Deals"),
  "notes/notes": t("Notes"),
  "copy/deals": t("Deals, a copy"),
};
const bundles = {
  crm: { title: "CRM", tables: ["deals", "companies"] },
  notes: { title: "Notes" },
  copy: { title: "Copy" },
};

test("a bundle's tables are its own, by name", () => {
  assert.deepEqual(Object.keys(bundleTables(tables, "crm")).sort(), ["companies", "deals"]);
  assert.equal(bundleTables(tables, "copy").deals!.meta.title, "Deals, a copy");
});

test("keys come in the manifest's order", () => {
  assert.deepEqual(tableKeysIn(tables, bundles, "crm"), ["crm/deals", "crm/companies"]);
});

test("a bundle round-trips between the demo and core", () => {
  const b = toBundle(tables, bundles, "crm");
  assert.equal(b.path, "crm.table");
  assert.deepEqual(Object.keys(fromBundle("crm", b)), ["crm/deals", "crm/companies"]);
});

test("addresses resolve: spec form, demo key, and a relation's bare name within its bundle", () => {
  const at = (tablePath: string, tableName?: string, from = "crm") =>
    keyForAddress({ tablePath, ...(tableName ? { tableName } : {}) }, tables, bundles, from);
  assert.equal(at("crm.table", "deals"), "crm/deals");
  assert.equal(at("notes.table"), "notes/notes", "a one-table bundle needs no table=");
  assert.equal(at("crm.table"), null, "a bundle of several needs table=");
  assert.equal(at("crm/companies"), "crm/companies");
  assert.equal(at("deals", undefined, "copy"), "copy/deals", "a bare name stays in its bundle");
  assert.equal(at("deals", undefined, "crm"), "crm/deals");
  assert.equal(at("missing"), null);
  assert.equal(at("nowhere.table"), null);
});

test("following an address: its table, its view, and the named row's document if it has one", () => {
  const withDoc = { ...tables, "crm/deals": { ...t("Deals"), rows: [{ id: "d1" }, { id: "d2" }], bodies: { d1: "# Notes" } } };
  assert.deepEqual(addressTarget("crm.table#table=deals&view=v&row=d1", withDoc, bundles, "notes"), { key: "crm/deals", viewId: "v", openBody: "d1" });
  // A row without a document opens none, so one left open from elsewhere closes.
  assert.deepEqual(addressTarget("crm.table#table=deals&row=d2", withDoc, bundles, "notes"), { key: "crm/deals", openBody: null });
  assert.deepEqual(addressTarget({ tablePath: "deals" }, withDoc, bundles, "copy"), { key: "copy/deals", openBody: null });
  assert.equal(addressTarget("nowhere.table", withDoc, bundles, "crm"), null);
  assert.equal(addressTarget("", withDoc, bundles, "crm"), null);
});
