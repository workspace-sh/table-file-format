import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { addressTarget, applyTarget, bundleTables, fromBundle, keyForAddress, otherFileTable, otherFilesNamed, relatedTables, tableKeysIn, toBundle } from "./bundles.ts";

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

test("following an address: its table, its view, and the named row's page if it has one", () => {
  const withDoc = { ...tables, "crm/deals": { ...t("Deals"), rows: [{ id: "d1" }, { id: "d2" }], bodies: { d1: "# Notes" } } };
  assert.deepEqual(addressTarget("crm.table#table=deals&view=v&row=d1", withDoc, bundles, "notes"), { key: "crm/deals", viewId: "v", openBody: "d1" });
  // A row without a page opens none, so one left open from elsewhere closes.
  assert.deepEqual(addressTarget("crm.table#table=deals&row=d2", withDoc, bundles, "notes"), { key: "crm/deals", openBody: null });
  assert.deepEqual(addressTarget({ tablePath: "deals" }, withDoc, bundles, "copy"), { key: "copy/deals", openBody: null });
  assert.equal(addressTarget("nowhere.table", withDoc, bundles, "crm"), null);
  assert.equal(addressTarget("", withDoc, bundles, "crm"), null);
});

test("applying a target: its table, its view over the others, its page, the view not a file", () => {
  const current = { viewIds: { "crm/deals": "all", "crm/companies": "all" } };
  const applied = applyTarget({ key: "crm/deals", viewId: "pipe", openBody: "d1" }, current);
  assert.deepEqual(applied, {
    activeKey: "crm/deals",
    viewIds: { "crm/deals": "pipe", "crm/companies": "all" },
    openBody: "d1",
    mode: "tables",
  });
  assert.equal(current.viewIds["crm/deals"], "all", "the current views aren't changed");
  const noView = applyTarget({ key: "crm/companies", openBody: null }, current);
  assert.equal(noView.viewIds, current.viewIds, "no view named: the views as they were");
  assert.equal(noView.openBody, null);
});

// Relations to another .table, beside the file (SPEC section 2, D47).
{
  const table = (fields: { name: string; type: "string"; relation?: { table: string; field: "id" } }[], rows: Record<string, unknown>[] = []) =>
    ({ path: "", schema: { fields }, rows: rows.map((r) => ({ id: String(r.id), ...r })), views: [], meta: {} }) as never;
  const held = {
    "orders/orders": table([{ name: "title", type: "string" }, { name: "supplier", type: "string", relation: { table: "suppliers", field: "id" } }]),
    "orders/lines": table([{ name: "order", type: "string", relation: { table: "orders", field: "id" } }]),
    "suppliers/suppliers": table([{ name: "name", type: "string" }], [{ id: "s1", name: "Acme" }]),
    "suppliers/contacts": table([{ name: "name", type: "string" }]),
    "parts/catalogue": table([{ name: "name", type: "string" }]),
  };

  test("a relation's table the file doesn't hold is the .table of that name beside it: its table of that name", () => {
    assert.equal(otherFileTable(held, "suppliers"), "suppliers/suppliers");
    // Or its only table.
    assert.equal(otherFileTable(held, "parts"), "parts/catalogue");
    // Not one held, not a path.
    assert.equal(otherFileTable(held, "nowhere"), undefined);
    assert.equal(otherFileTable(held, "suppliers/contacts"), undefined);
  });

  test("the tables a file's relations reach: its own by name, and another file's under the name the relation uses", () => {
    assert.deepEqual(Object.keys(relatedTables(held, "orders")).sort(), ["lines", "orders", "suppliers"]);
    assert.equal(relatedTables(held, "orders")["suppliers"], held["suppliers/suppliers"]);
    // A file's own table of a name comes first.
    assert.deepEqual(Object.keys(relatedTables(held, "suppliers")).sort(), ["contacts", "suppliers"]);
  });

  test("the files a bundle's relations name and it doesn't hold", () => {
    assert.deepEqual(otherFilesNamed(held, "orders"), ["suppliers"]);
    assert.deepEqual(otherFilesNamed(held, "suppliers"), []);
  });

  test("an address naming another file's table by the relation's name leads there", () => {
    assert.equal(keyForAddress({ tablePath: "suppliers", rowId: "s1" }, held, {}, "orders"), "suppliers/suppliers");
    assert.equal(keyForAddress({ tablePath: "lines" }, held, {}, "orders"), "orders/lines");
    assert.equal(keyForAddress({ tablePath: "nowhere" }, held, {}, "orders"), null);
  });
}
