import { test } from "node:test";
import assert from "node:assert/strict";

import { memoryFs, writeBundleTo } from "@workspace.sh/table-core/io";
import { tables } from "@workspace.sh/table-fixtures";
import { bundleKey, openLibrary, writeLibraryBundle } from "./library.ts";
import { withCell } from "./edits.ts";

test("a library opens over any file system, keys bundles by folder, and saves back", async () => {
  const fs = memoryFs();
  await writeBundleTo(fs, "/docs/Work.table", { tables: { tasks: tables["tasks"]! } });
  const library = await openLibrary(fs, ["/docs/Work.table", "/docs/missing.table"]);
  assert.deepEqual(Object.keys(library.tables), ["Work/tasks"]);
  assert.equal(library.paths["Work"], "/docs/Work.table");
  // A folder that isn't there opens as an empty bundle, as core's reader has
  // always read one: no tables, no problem reported.
  assert.equal(library.bundles["missing"] !== undefined, true);
  assert.equal(Object.keys(library.tables).some((k) => k.startsWith("missing/")), false);

  const edited = { ...library.tables, "Work/tasks": withCell(library.tables["Work/tasks"]!, "t1", "title", "Saved") };
  await writeLibraryBundle(fs, library, edited, library.bundles, "Work");
  const again = await openLibrary(fs, ["/docs/Work.table"]);
  assert.equal(again.tables["Work/tasks"]!.rows.find((r) => r.id === "t1")!.title, "Saved");
});

test("bundle keys come from the folder name, made unique", () => {
  const taken = new Set(["crm"]);
  assert.equal(bundleKey("/a/crm.table", taken), "crm-2");
  assert.equal(bundleKey("/a/Notes.TABLE/", new Set()), "Notes");
});
