import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRowsText } from "@workspace.sh/table-core";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { readBundle } from "@workspace.sh/table-core/io";
import { openNodeDatabase } from "@workspace.sh/table-core/sqlite-node";
import { createIndexHost, type IndexHostPlatform } from "./indexHost.ts";
import { bundleToArchive } from "./tableFiles.ts";

// The host iOS and the Mac keep large tables with, over Node's files and SQLite.

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

function nodePlatform(home: string): IndexHostPlatform {
  return {
    fs: nodeFs,
    home: () => home,
    size: async (path) => (existsSync(path) ? statSync(path).size : null),
    writer: async (path) => {
      const fd = openSync(path, "w");
      return { write: (bytes: Uint8Array) => writeSync(fd, bytes), close: () => closeSync(fd) };
    },
    *pieces(path, size, step) {
      const all = readFileSync(path).subarray(0, size);
      for (let at = 0; at < all.length; at += step) yield all.subarray(at, at + step);
    },
    openDatabase: async (dir) => {
      const db = openNodeDatabase(join(dir, "index.sqlite"));
      return { exec: db.exec, run: db.run, all: db.all, ...(db.batch ? { batch: db.batch } : {}), close: async () => db.close() };
    },
  };
}

test("a large table from an archive is kept in rows/0001.ndjson, saved there, and an old rows.ndjson moved into rows/ (D51)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-index-host-"));
  try {
    const source = join(dir, "source.table");
    cpSync(join(fixtures, "projects.table"), source, { recursive: true });
    const bundle = await readBundle(nodeFs, source);
    // Over 1 MB, so the archive hands it over still compressed.
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ${"x".repeat(400)}`, priority: i % 7 }));
    bundle.tables.tasks!.rows = many;
    const schema = bundle.tables.tasks!.schema;
    const home = join(dir, "home");

    let host = createIndexHost(nodePlatform(home));
    const { opened } = await host.openZip(await bundleToArchive("projects", bundle), [], 1000);
    assert.ok(opened.bundle.tables.tasks!.indexed);
    let db = host.openIndexDatabase(opened.key);
    assert.equal(await db.ensure("tasks", schema), many.length);
    const tasks = join(host.bundleDir(opened.key), "tables", "tasks");
    const kept = join(tasks, "rows", "0001.ndjson");
    assert.deepEqual(parseRowsText(readFileSync(kept, "utf8"), []), many);
    assert.equal(existsSync(join(tasks, "rows.ndjson")), false);

    await db.rows({ ask: "edits", name: "tasks", table: { schema }, edits: [{ kind: "cell", rowId: "r0", field: "title", value: "Edited" }] });
    assert.equal(await db.save("tasks", schema, true), true);
    assert.equal(parseRowsText(readFileSync(kept, "utf8"), [])[0]!.title, "Edited");
    await db.close();

    // Kept before D51: the table's rows.ndjson, moved into rows/ when the index is made again from it.
    renameSync(kept, join(tasks, "rows.ndjson"));
    rmSync(join(tasks, "rows"), { recursive: true });
    host = createIndexHost(nodePlatform(home));
    db = host.openIndexDatabase(opened.key);
    assert.equal(await db.build("tasks", schema), many.length);
    assert.equal(existsSync(join(tasks, "rows.ndjson")), false);
    assert.equal(parseRowsText(readFileSync(kept, "utf8"), [])[0]!.title, "Edited");
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
