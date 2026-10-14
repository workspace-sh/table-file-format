import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { writeTableArchive } from "@workspace.sh/table-core";
import { bundles } from "@workspace.sh/table-fixtures";

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
