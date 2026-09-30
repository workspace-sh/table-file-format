import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { creating, namePrompt, newView, withNewFile, withNewTable } from "./creating.ts";

const now = new Date("2026-09-30T12:00:00Z");
const table = (title: string): ParsedTable => ({
  path: "x",
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: [],
  views: [{ id: "v", name: "All", layout: "table" }],
  meta: { title },
});

test("newView: a plain table view with a fresh id", () => {
  const a = newView();
  const b = newView();
  assert.equal(a.layout, "table");
  assert.equal(a.name, "New view");
  assert.notEqual(a.id, b.id);
});

test("withNewTable: named from its title, unique in its bundle, last in the order", () => {
  const tables = { "crm/deals": table("Deals"), "crm/notes": table("Notes") };
  const bundles: Record<string, BundleMeta> = { crm: { title: "CRM", tables: ["deals", "notes"] } };
  const made = withNewTable(tables, bundles, "crm", "Notes", now);
  assert.equal(made.key, "crm/notes-2");
  assert.deepEqual(made.bundles.crm!.tables, ["deals", "notes", "notes-2"]);
  assert.equal(made.tables["crm/notes-2"]!.meta.title, "Notes");
  assert.equal(made.tables["crm/notes-2"]!.path, "crm.table/tables/notes-2");
  assert.equal(made.viewId, made.tables["crm/notes-2"]!.views[0]!.id);
  // What was there is kept, untouched.
  assert.equal(made.tables["crm/deals"], tables["crm/deals"]);
  assert.equal(made.bundles.crm!.title, "CRM");
});

test("withNewTable: a bundle without an order starts one from its tables", () => {
  const made = withNewTable({ "b/one": table("One") }, { b: {} }, "b", "Two", now);
  assert.deepEqual(made.bundles.b!.tables, ["one", "two"]);
});

test("withNewFile: a new bundle, keyed apart from those held, holding one table", () => {
  const bundles: Record<string, BundleMeta> = { budget: { title: "Budget" } };
  const made = withNewFile({}, bundles, "Budget", now);
  assert.equal(made.key, "budget-2/budget");
  assert.equal(made.bundles["budget-2"]!.title, "Budget");
  assert.deepEqual(made.bundles["budget-2"]!.tables, ["budget"]);
  assert.equal(made.tables["budget-2/budget"]!.meta.title, "Budget");
  assert.equal(made.viewId, made.tables["budget-2/budget"]!.views[0]!.id);
  assert.equal(made.bundles.budget, bundles.budget);
});

test("the name prompt names the file a table goes into", () => {
  const bundles: Record<string, BundleMeta> = { crm: { title: "CRM" }, bare: {} };
  assert.deepEqual(namePrompt({ kind: "table", bundle: "crm" }, bundles), { heading: "New table in CRM", action: "Create", placeholder: "Name" });
  assert.equal(namePrompt({ kind: "table", bundle: "bare" }, bundles).heading, "New table in bare");
  assert.equal(namePrompt({ kind: "file" }, bundles).heading, "New .table file");
});

test("making with a name trims it, makes nothing without one, and shows what's made", () => {
  const tables = { "crm/deals": table("Deals") };
  const bundles: Record<string, BundleMeta> = { crm: { title: "CRM", tables: ["deals"] } };
  for (const empty of [null, undefined, "", "   "]) assert.equal(creating(tables, bundles, { kind: "file" }, empty, now), null);
  const t = creating(tables, bundles, { kind: "table", bundle: "crm" }, "  Leads ", now)!;
  const direct = withNewTable(tables, bundles, "crm", "Leads", now);
  assert.deepEqual([t.key, t.bundles, t.search, t.openBody], [direct.key, direct.bundles, "", null]);
  assert.equal(t.viewId, t.tables[t.key]!.views[0]!.id);
  assert.equal(t.tables[t.key]!.meta.title, "Leads");
  const f = creating(tables, bundles, { kind: "file" }, "Notes", now)!;
  assert.equal(f.key, withNewFile(tables, bundles, "Notes", now).key);
});
