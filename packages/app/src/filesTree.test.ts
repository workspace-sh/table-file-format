import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { attachmentAt, attachmentShown, fileKind, fileOfNode, fileText, filesNodes, filesTree, flattenFilesTree, historyAt, type FilesNode, type FilesTreeDir } from "./filesTree.ts";

const table = (title: string, rows: number, bodies: Record<string, string> = {}): ParsedTable => ({
  path: "x",
  schema: { fields: [{ name: "title", type: "string" }, { name: "logo", type: "string" }] },
  rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` })),
  views: [{ id: "all", name: "All", layout: "table" }],
  meta: { title },
  bodies,
});
const tables: Record<string, ParsedTable> = {
  "crm/deals": table("Deals", 1, { r0: "# Notes\n" }),
  "crm/companies": table("Companies", 6),
  "projects/projects": table("Projects", 17),
};
const bundles: Record<string, BundleMeta> = {
  crm: { title: "CRM", tables: ["deals", "companies"] },
  projects: { title: "Projects" },
};
const attachmentsOf = (key: string) => (key === "crm/companies" ? ["co-atlas.svg", "co-beacon.svg"] : []);

const dir = (d: FilesTreeDir, path: string): FilesTreeDir => {
  const found = path.split("/").reduce<FilesTreeDir | undefined>((at, name) => at?.dirs.find((x) => x.name === name), d);
  assert.ok(found, `no folder ${path}`);
  return found;
};

test("each bundle's files as the writer writes them, plus attachments", () => {
  const [crm, projects] = filesTree(tables, bundles, { attachmentsOf });
  assert.deepEqual([crm!.bundle, crm!.name, projects!.name], ["crm", "crm.table/", "projects.table/"]);
  assert.deepEqual(crm!.root.files.map((f) => [f.name, f.kind]), [["meta.json", "manifest"]]);
  assert.deepEqual(dir(crm!.root, "tables").dirs.map((d) => d.name), ["deals", "companies"]);
  const deals = dir(crm!.root, "tables/deals");
  assert.deepEqual(deals.files.map((f) => [f.name, f.kind, f.opens, f.note]), [
    ["schema.json", "schema", "text", "2 fields"],
    ["views.json", "views", "text", "1 view"],
    ["meta.json", "meta", "text", undefined],
  ]);
  // Its rows in rows/ (D51).
  assert.deepEqual(dir(deals, "rows").files.map((f) => [f.path, f.kind, f.opens, f.note]), [["tables/deals/rows/0001.ndjson", "rows", "text", "1 row"]]);
  assert.deepEqual(dir(deals, "bodies").files.map((f) => [f.path, f.kind]), [["tables/deals/bodies/r0.md", "body"]]);
  const attachments = dir(crm!.root, "tables/companies/attachments");
  assert.deepEqual(attachments.files.map((f) => [f.path, f.kind, f.opens]), [
    ["tables/companies/attachments/co-atlas.svg", "attachment", "attachment"],
    ["tables/companies/attachments/co-beacon.svg", "attachment", "attachment"],
  ]);
  assert.equal(attachments.count, 2);
  assert.equal(attachments.tableKey, "crm/companies");
  assert.equal(dir(crm!.root, "tables").tableKey, undefined);
});

test("only the table on screen starts open, and bodies/ and attachments/ start folded", () => {
  const [crm] = filesTree(tables, bundles, { activeTable: "crm/deals", attachmentsOf });
  assert.equal(dir(crm!.root, "tables").open, true);
  assert.equal(dir(crm!.root, "tables/deals").open, true);
  assert.equal(dir(crm!.root, "tables/companies").open, false);
  assert.equal(dir(crm!.root, "tables/deals/bodies").open, false);
});

test("what the viewer opened or closed beats the defaults", () => {
  const [crm] = filesTree(tables, bundles, {
    activeTable: "crm/deals",
    opened: { "crm/tables/deals": false, "crm/tables/deals/bodies": true, "projects/tables/deals": true },
  });
  assert.equal(dir(crm!.root, "tables/deals").open, false);
  assert.equal(dir(crm!.root, "tables/deals/bodies").open, true);
});

test("folded bundles and closed folders list nothing under them when flattened", () => {
  const tree = filesTree(tables, bundles, { folded: ["projects"], activeTable: "crm/deals", attachmentsOf });
  const lines = flattenFilesTree(tree).map((e) =>
    e.kind === "bundle" ? e.bundle.name : `${e.depth} ${e.kind === "dir" ? `${e.dir.name}/` : e.file.name}`,
  );
  assert.deepEqual(lines, [
    "crm.table/",
    "1 meta.json",
    "1 tables/",
    "2 deals/",
    "3 schema.json",
    "3 views.json",
    "3 meta.json",
    "3 rows/",
    "4 0001.ndjson",
    "3 bodies/",
    "2 companies/",
    "projects.table/",
  ]);
});

test("kinds, attachments and text by path", () => {
  assert.equal(fileKind("meta.json"), "manifest");
  assert.equal(fileKind("tables/deals/meta.json"), "meta");
  assert.equal(fileKind("tables/deals/bodies/r0.md"), "body");
  assert.equal(fileKind("tables/deals/rows/0001.ndjson"), "rows");
  assert.equal(fileKind("tables/deals/rows/0002m.ndjson"), "rows");
  // formatVersion 1's one file.
  assert.equal(fileKind("tables/deals/rows.ndjson"), "rows");
  assert.equal(fileKind("tables/deals/attachments/rows.ndjson"), "attachment");
  assert.deepEqual(attachmentAt("crm", "tables/companies/attachments/a/b.png"), { tableKey: "crm/companies", name: "a/b.png" });
  assert.equal(attachmentAt("crm", "tables/companies/rows/0001.ndjson"), null);
  assert.equal(fileText(tables, bundles, "crm", "tables/deals/bodies/r0.md"), "# Notes\n");
  assert.match(fileText(tables, bundles, "crm", "meta.json") ?? "", /"deals",\s*"companies"/);
  assert.equal(fileText(tables, bundles, "crm", "tables/nope/rows/0001.ndjson"), undefined);
});

test("an attachment shows as its image, or a note when it isn't one or isn't there", () => {
  assert.deepEqual(attachmentShown("logo.svg", "file:///a/logo.svg"), { image: "file:///a/logo.svg" });
  assert.deepEqual(attachmentShown("photo.JPG", "x"), { image: "x" });
  assert.deepEqual(attachmentShown("notes.pdf", "x"), { note: "Not an image, so there's nothing to preview." });
  assert.deepEqual(attachmentShown("logo.svg", undefined), { note: "Not found." });
});

test("what counts as drawable is the platform's: a HEIC is a note in a browser, an image where it can be drawn", () => {
  assert.deepEqual(attachmentShown("scan.heic", "x"), { note: "Not an image, so there's nothing to preview." });
  assert.deepEqual(attachmentShown("scan.heic", "x", (n) => /\.(heic|tiff?)$/i.test(n)), { image: "x" });
});

test("the tree as plain nodes for a file browser, ids reading back to bundle and path", () => {
  const tree = filesTree(tables, bundles, { activeTable: "crm/companies" });
  const nodes = filesNodes(tree);
  assert.equal(nodes[0]!.name, tree[0]!.name);
  const walk = (list: FilesNode[]): FilesNode[] => list.flatMap((n) => [n, ...(n.children ? walk(n.children) : [])]);
  const all = walk(nodes);
  const rows = all.find((n) => n.name === "0001.ndjson" && n.id.includes("companies"))!;
  assert.deepEqual(fileOfNode(rows.id), { bundle: "crm", path: "tables/companies/rows/0001.ndjson" });
  assert.equal(rows.opens, "text");
  assert.match(rows.note ?? "", /row/);
  const logo = all.find((n) => n.id.includes("/attachments/") && !n.children);
  if (logo) assert.ok(logo.opens === "image" || logo.opens === "none");
});

test("a table's edit history is listed where the app keeps one, after its other files, and shown as the app has it", () => {
  // The app keeps a history for deals (a file in its folder, or its store), and none for companies.
  const hasHistory = (key: string) => key === "crm/deals";
  const [crm] = filesTree(tables, bundles, { hasHistory });
  assert.deepEqual(
    dir(crm!.root, "tables/deals").files.map((f) => [f.name, f.kind, f.opens, f.note]),
    [
      ["schema.json", "schema", "text", "2 fields"],
      ["views.json", "views", "text", "1 view"],
      ["meta.json", "meta", "text", undefined],
      ["history.ndjson", "history", "text", undefined],
    ],
  );
  assert.equal(dir(crm!.root, "tables/companies").files.some((f) => f.kind === "history"), false);
  // Without being told, nothing is listed that the tables don't hold.
  assert.equal(dir(filesTree(tables, bundles)[0]!.root, "tables/deals").files.some((f) => f.kind === "history"), false);

  assert.equal(fileKind("tables/deals/history.ndjson"), "history");
  assert.equal(fileKind("tables/deals/attachments/history.ndjson"), "attachment");
  assert.deepEqual(historyAt("crm", "tables/deals/history.ndjson"), { tableKey: "crm/deals" });
  assert.equal(historyAt("crm", "tables/deals/rows.ndjson"), null);
  // Its text is the app's to give, by table.
  const kept = '{"id":"e1","at":"2026-10-13T10:00:00Z","op":"set","row":"r0","field":"a","to":1}\n';
  assert.equal(fileText(tables, bundles, "crm", "tables/deals/history.ndjson", (key) => (key === "crm/deals" ? kept : undefined)), kept);
  assert.equal(fileText(tables, bundles, "crm", "tables/deals/history.ndjson"), undefined);
  // Other files don't ask for it.
  assert.equal(fileText(tables, bundles, "crm", "tables/deals/bodies/r0.md", () => "nope"), "# Notes\n");
});

test("a history a table holds itself (it came from an archive) is listed once, and shown until the app has its own", () => {
  const arrived = '{"id":"a1","at":"2026-10-01T10:00:00Z","op":"set","row":"r0","field":"a","to":0}\n';
  const held = { ...tables, "crm/deals": { ...tables["crm/deals"]!, history: arrived } };
  for (const options of [{}, { hasHistory: () => true }]) {
    const [crm] = filesTree(held, bundles, options);
    assert.deepEqual(
      dir(crm!.root, "tables/deals").files.filter((f) => f.kind === "history").map((f) => f.path),
      ["tables/deals/history.ndjson"],
    );
  }
  assert.equal(fileText(held, bundles, "crm", "tables/deals/history.ndjson"), arrived);
  assert.equal(fileText(held, bundles, "crm", "tables/deals/history.ndjson", () => undefined), arrived);
  assert.equal(fileText(held, bundles, "crm", "tables/deals/history.ndjson", () => "newer\n"), "newer\n");
});

