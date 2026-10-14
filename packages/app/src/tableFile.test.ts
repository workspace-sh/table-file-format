import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { writeBundleTo } from "@workspace.sh/table-core/io";
import { writeTableArchive } from "@workspace.sh/table-core";
import { bundles } from "@workspace.sh/table-fixtures";

import { bundleOf } from "./bundles.ts";
import { linkedRowAddress } from "./embed.ts";
import { readTableArchiveFile, readTableFileWith } from "./tableFile.ts";

const projects = fileURLToPath(new URL("../../../fixtures/projects.table", import.meta.url));

test("a .table folder opens on its first table, in its first view, to be written back where it is", async () => {
  const read = await readTableFileWith(nodeFs, projects);
  assert.equal(read.kind, "shown");
  if (read.kind !== "shown") return;
  assert.ok(read.library.tables[read.key], "the first table is read");
  assert.equal(read.viewId, read.library.tables[read.key]!.views[0]?.id);
  assert.equal(Object.values(read.library.paths)[0], projects);
});

test("a .table folder is read with the .table its relations name beside it (SPEC section 2)", async () => {
  const root = mkdtempSync(join(tmpdir(), "table-file-"));
  try {
    // orders.table's orders name a supplier; suppliers.table, beside it, holds them.
    await writeBundleTo(nodeFs, join(root, "suppliers.table"), {
      meta: {},
      tables: { suppliers: { schema: { fields: [{ name: "name", type: "string" }] }, rows: [{ id: "s1", name: "Acme Supplies" }], views: [{ id: "all", name: "All", layout: "table" }], meta: {} } },
    } as never);
    await writeBundleTo(nodeFs, join(root, "orders.table"), {
      meta: {},
      tables: {
        orders: {
          schema: { fields: [{ name: "title", type: "string" }, { name: "supplier", type: "string", relation: { table: "suppliers", field: "id" } }] },
          rows: [{ id: "o1", title: "First order", supplier: "s1" }],
          views: [{ id: "all", name: "All", layout: "table" }],
          meta: {},
        },
      },
    } as never);
    const read = await readTableFileWith(nodeFs, join(root, "orders.table"));
    assert.equal(read.kind, "shown");
    if (read.kind !== "shown") return;
    assert.ok(Object.values(read.library.paths).includes(join(root, "suppliers.table")), "the file beside it is read");
    // A linked row there (as a view names it: the relation's table and the row) is handed over as that file's own address.
    assert.equal(linkedRowAddress("suppliers#row=s1", read.library, read.library, bundleOf(read.key)), `${join(root, "suppliers.table")}#table=suppliers&row=s1`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a .table opens on the first table its manifest names, even beside a table called projects", async () => {
  const root = mkdtempSync(join(tmpdir(), "table-file-order-"));
  try {
    const path = join(root, "plans.table");
    const table = (title: string) => ({ schema: { fields: [{ name: "title", type: "string" }] }, rows: [{ id: "r1", title }], views: [{ id: "all", name: "All", layout: "table" }], meta: {} });
    await writeBundleTo(nodeFs, path, { meta: { tables: ["tasks", "projects"] }, tables: { projects: table("P"), tasks: table("T") } } as never);
    for (const read of [await readTableFileWith(nodeFs, path), await readTableArchiveFile(await writeTableArchive("plans", { meta: { tables: ["tasks", "projects"] }, tables: { projects: table("P"), tasks: table("T") } } as never), "plans.table.zip")]) {
      assert.equal(read.kind === "shown" && read.key, "plans/tasks");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a folder that isn't there says so", async () => {
  const read = await readTableFileWith(nodeFs, `${projects}-gone.table`);
  assert.deepEqual(read, { kind: "problem", text: "“projects.table-gone.table” isn’t there any more." });
});

test("a .table.zip opens to look at: it has nowhere to be written", async () => {
  const [name, bundle] = Object.entries(bundles)[0]!;
  const bytes = await writeTableArchive(name, bundle);
  const read = await readTableArchiveFile(bytes, "example.table.zip");
  assert.equal(read.kind, "shown");
  if (read.kind !== "shown") return;
  assert.deepEqual(read.library.paths, {});
});

test("bytes that aren't a .table.zip say why", async () => {
  const read = await readTableArchiveFile(new Uint8Array(readFileSync(fileURLToPath(import.meta.url))), "notes.table.zip");
  assert.equal(read.kind, "problem");
});
