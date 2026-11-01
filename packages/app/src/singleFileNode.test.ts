import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTableArchive } from "@workspace.sh/table-core";
import { readBundle } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";

import { appendHistory, discardSingleFileEdits, keepSingleFileEdits, openSingleFile, readTableFile, saveBundle } from "./node.ts";
import { ChangedElsewhere } from "./singleFile.ts";
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

test("a single file changed elsewhere isn't saved over; its edits are kept as a copy beside it, or let go", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-elsewhere-"));
  try {
    const file = join(dir, "projects.table");
    const original = await bundleToArchive("projects", await readBundle(nodeFs, join(fixtures, "projects.table")));
    writeFileSync(file, original);
    const home = join(dir, "cache");
    const row = "ytjc8tj8w8ftnbf9h86s5k9jfk";
    const edit = async (title: string) => {
      const library = await openSingleFile(file, [], { home });
      const key = Object.keys(library.bundles)[0]!;
      const tasks = `${key}/tasks`;
      return () => saveBundle(library, { ...library.tables, [tasks]: withCell(library.tables[tasks]!, row, "title", title) }, library.bundles, key);
    };
    const titleIn = async (path: string) => (await readTableArchive(new Uint8Array(readFileSync(path)))).tables.tasks!.rows.find((r) => r.id === row)!.title;

    // Opened, then the file is changed by someone else (another size, so its stamp differs), then a save here.
    const save = await edit("Mine");
    const theirs = await bundleToArchive("projects", { ...(await readBundle(nodeFs, join(fixtures, "projects.table"))), meta: { title: "Theirs" } });
    writeFileSync(file, theirs);
    await assert.rejects(save(), (e: unknown) => e instanceof ChangedElsewhere);
    assert.deepEqual(new Uint8Array(readFileSync(file)), theirs);

    // Kept as a copy: beside it, with the edit; the file as they left it; opened again, it's theirs.
    const copy = await keepSingleFileEdits(file);
    assert.equal(copy, join(dir, "projects (edited here).table"));
    assert.equal(await titleIn(copy), "Mine");
    assert.deepEqual(new Uint8Array(readFileSync(file)), theirs);
    const again = await openSingleFile(file, [], { home });
    assert.equal(Object.values(again.bundles)[0]!.title, "Theirs");

    // Let go: the same, with no copy.
    const save2 = await edit("Mine again");
    writeFileSync(file, original);
    await assert.rejects(save2(), (e: unknown) => e instanceof ChangedElsewhere);
    await discardSingleFileEdits(file);
    assert.deepEqual(new Uint8Array(readFileSync(file)), original);
    assert.notEqual(Object.values((await openSingleFile(file, [], { home })).bundles)[0]!.title, "Theirs");
    assert.notEqual(await titleIn(file), "Mine again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
