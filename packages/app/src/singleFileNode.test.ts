import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTableArchive } from "@workspace.sh/table-core";
import { readBundle } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";

import { appendHistory, openSingleFile, readTableFile, saveBundle } from "./node.ts";
import { bundleToArchive } from "./tableFiles.ts";
import { withCell } from "./edits.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

test("a single-file .table opened in Node is edited in its working folder and packed back into the file after each write (D49)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-single-"));
  const cache = process.env.XDG_CACHE_HOME;
  // Working folders made by default (readTableFile's) go in this test's own cache.
  process.env.XDG_CACHE_HOME = join(dir, "xdg-cache");
  try {
    const file = join(dir, "projects.table");
    writeFileSync(file, await bundleToArchive("projects", await readBundle(nodeFs, join(fixtures, "projects.table"))));
    const home = join(dir, "cache");
    const library = await openSingleFile(file, [], { home });
    const key = Object.keys(library.bundles)[0]!;
    assert.equal(library.singleFiles?.[key], file);
    assert.ok(library.paths[key]!.startsWith(home), "edited in the app's own storage");
    assert.equal(statSync(file).isFile(), true);

    // An edit saved: in the file, which stays a single file.
    const tasks = `${key}/tasks`;
    const edited = { ...library.tables, [tasks]: withCell(library.tables[tasks]!, "ytjc8tj8w8ftnbf9h86s5k9jfk", "title", "Packed") };
    await saveBundle(library, edited, library.bundles, key);
    assert.equal(statSync(file).isFile(), true);
    const after = await readTableArchive(new Uint8Array(readFileSync(file)));
    assert.equal(after.tables.tasks!.rows.find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")!.title, "Packed");

    // A history appended: in the file too.
    await appendHistory(join(library.paths[key]!, "tables", "tasks"), [{ op: "set", at: "2026-10-15T00:00:00Z", table: "tasks", row: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "title", from: "x", to: "Packed" } as never]);
    const withHistory = await readTableArchive(new Uint8Array(readFileSync(file)));
    assert.match(withHistory.tables.tasks!.history ?? "", /"Packed"/);

    // Opened again, as a document: its first table, editable (it has somewhere to be written).
    const read = await readTableFile(file);
    assert.equal(read.kind, "shown");
    if (read.kind === "shown") assert.equal(read.library.singleFiles?.[Object.keys(read.library.bundles)[0]!], file);
  } finally {
    if (cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cache;
    rmSync(dir, { recursive: true, force: true });
  }
});
