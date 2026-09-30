import { test } from "node:test";
import assert from "node:assert/strict";

import type { ParsedTable } from "@workspace.sh/table-core";
import { tableBreadcrumb } from "./breadcrumb.ts";

const t = (title?: string): ParsedTable => ({
  path: "x",
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: [],
  views: [],
  meta: title ? { title } : {},
});
const tables = { "shop/orders": t("Orders"), "notes/notes": t("Notes"), "raw/things": t() };
const bundles = { shop: { title: "Shop" }, notes: { title: "Notes" }, raw: {} };

test("the file, then the table", () => {
  assert.deepEqual(tableBreadcrumb("shop/orders", tables, bundles), {
    file: "Shop (shop.table)",
    table: "Orders",
    text: "Shop (shop.table) › Orders",
  });
});

test("a file whose table shares its title names it once", () => {
  assert.deepEqual(tableBreadcrumb("notes/notes", tables, bundles), { file: "Notes (notes.table)", text: "Notes (notes.table)" });
});

test("untitled files and tables go by name; an opened folder by its own", () => {
  assert.equal(tableBreadcrumb("raw/things", tables, bundles).text, "raw (raw.table) › things");
  assert.equal(tableBreadcrumb("shop/orders", tables, bundles, "My Shop.table").text, "Shop (My Shop.table) › Orders");
});
