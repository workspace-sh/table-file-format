import { test } from "node:test";
import assert from "node:assert/strict";

import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { attachmentAt, attachmentShown, fileKind, fileText, filesTree, flattenFilesTree, type FilesTreeDir } from "./filesTree.ts";

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
    ["rows.ndjson", "rows", "text", "1 row"],
    ["views.json", "views", "text", "1 view"],
    ["meta.json", "meta", "text", undefined],
  ]);
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
    "3 rows.ndjson",
    "3 views.json",
    "3 meta.json",
    "3 bodies/",
    "2 companies/",
    "projects.table/",
  ]);
});

test("kinds, attachments and text by path", () => {
  assert.equal(fileKind("meta.json"), "manifest");
  assert.equal(fileKind("tables/deals/meta.json"), "meta");
  assert.equal(fileKind("tables/deals/bodies/r0.md"), "body");
  assert.equal(fileKind("tables/deals/attachments/rows.ndjson"), "attachment");
  assert.deepEqual(attachmentAt("crm", "tables/companies/attachments/a/b.png"), { tableKey: "crm/companies", name: "a/b.png" });
  assert.equal(attachmentAt("crm", "tables/companies/rows.ndjson"), null);
  assert.equal(fileText(tables, bundles, "crm", "tables/deals/bodies/r0.md"), "# Notes\n");
  assert.match(fileText(tables, bundles, "crm", "meta.json") ?? "", /"deals",\s*"companies"/);
  assert.equal(fileText(tables, bundles, "crm", "tables/nope/rows.ndjson"), undefined);
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
