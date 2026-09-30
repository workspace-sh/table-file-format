import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable, View } from "@workspace.sh/table-core";
import { flattenSidebar, sidebarTree } from "./sidebar.ts";

const table = (title: string, views: View[], rows = 0): ParsedTable => ({
  path: "x",
  schema: { fields: [{ name: "title", type: "string" }] },
  rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })),
  views,
  meta: { title },
});
const tables: Record<string, ParsedTable> = {
  "crm/deals": table("Deals", [{ id: "pipe", name: "Pipeline", layout: "board" }, { id: "all", name: "All", layout: "table" }], 8),
  "crm/companies": table("Companies", [{ id: "all", name: "All", layout: "table" }], 6),
  "projects/projects": table("Projects", [{ id: "v1", name: "All projects", layout: "table" }], 17),
};
const bundles: Record<string, BundleMeta> = {
  crm: { title: "CRM", tables: ["deals", "companies"] },
  projects: { title: "Projects" },
};

test("bundles in order, each with its tables in the manifest's order", () => {
  const tree = sidebarTree(tables, bundles);
  assert.deepEqual(tree.map((b) => [b.bundle, b.title, b.file]), [["crm", "CRM", "crm.table"], ["projects", "Projects", "projects.table"]]);
  assert.deepEqual(tree[0]!.tables.map((t) => [t.key, t.title, t.folder, t.rowCount]), [
    ["crm/deals", "Deals", "deals/", 8],
    ["crm/companies", "Companies", "companies/", 6],
  ]);
});

test("only expanded tables list their views, and the one on screen is active", () => {
  const tree = sidebarTree(tables, bundles, { expanded: ["crm/deals"], active: { key: "crm/deals", viewId: "all" } });
  const deals = tree[0]!.tables[0]!;
  assert.equal(deals.expanded, true);
  assert.deepEqual(deals.views.map((v) => [v.id, v.name, v.layout, v.layoutLabel, v.active]), [
    ["pipe", "Pipeline", "board", "Board", false],
    ["all", "All", "table", "Table", true],
  ]);
  assert.deepEqual(tree[0]!.tables[1]!.views, []);
  // Several may expand: that's the caller's to say.
  const both = sidebarTree(tables, bundles, { expanded: ["crm/deals", "crm/companies"] });
  assert.equal(both[0]!.tables[1]!.views.length, 1);
});

test("a folded bundle keeps its heading, without its tables", () => {
  const tree = sidebarTree(tables, bundles, { folded: ["crm"] });
  assert.equal(tree[0]!.folded, true);
  assert.deepEqual(tree[0]!.tables, []);
  assert.equal(tree[1]!.tables.length, 1);
});

test("+ New table: in the active bundle, every bundle, or none", () => {
  const active = { key: "projects/projects", viewId: "v1" };
  assert.deepEqual(sidebarTree(tables, bundles, { active }).map((b) => b.offersNewTable), [false, true]);
  assert.deepEqual(sidebarTree(tables, bundles, { active, newTableIn: "every" }).map((b) => b.offersNewTable), [true, true]);
  assert.deepEqual(sidebarTree(tables, bundles, { active, newTableIn: "none" }).map((b) => b.offersNewTable), [false, false]);
  // Not in a folded bundle.
  assert.deepEqual(sidebarTree(tables, bundles, { active, folded: ["projects"] }).map((b) => b.offersNewTable), [false, false]);
});

test("flattenSidebar: heading, tables, then an expanded table's views", () => {
  const flat = flattenSidebar(sidebarTree(tables, bundles, { expanded: ["crm/companies"] }));
  assert.deepEqual(
    flat.map((e) => (e.kind === "bundle" ? `b:${e.bundle.bundle}` : e.kind === "table" ? `t:${e.table.key}` : `v:${e.key}:${e.view.id}`)),
    ["b:crm", "t:crm/deals", "t:crm/companies", "v:crm/companies:all", "b:projects", "t:projects/projects"],
  );
});
