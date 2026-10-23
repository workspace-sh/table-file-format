import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
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

    // Kept before D51: the table's rows.ndjson, its size said in _kept, moved into rows/ when the index is made again from it.
    const bytes = statSync(kept).size;
    renameSync(kept, join(tasks, "rows.ndjson"));
    rmSync(join(tasks, "rows"), { recursive: true });
    const old = openNodeDatabase(join(host.bundleDir(opened.key), "index.sqlite"));
    await old.exec("drop table _keptfiles; drop table _rowfiles; create table _kept(name text primary key, bytes integer not null)");
    await old.run("insert into _kept(name, bytes) values(?, ?)", ["tasks", bytes]);
    old.close();
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

test("a large table's rows files are kept as they came, each row saved back to its own, and made again from them (D51)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-index-host-"));
  try {
    const source = join(dir, "source.table");
    cpSync(join(fixtures, "projects.table"), source, { recursive: true });
    const bundle = await readBundle(nodeFs, source);
    const schema = bundle.tables.tasks!.schema;
    const many = Array.from({ length: 6000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ${"x".repeat(400)}`, priority: i % 7 }));
    bundle.tables.tasks!.rows = [];
    // The rows in three files, as a writer splitting them leaves them: two large and a small one between.
    const files = unzipSync(await bundleToArchive("projects", bundle));
    const rowsDir = "projects.table/tables/tasks/rows/";
    const lines = (rows: typeof many) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
    files[`${rowsDir}0001.ndjson`] = strToU8(lines(many.slice(0, 3000)));
    files[`${rowsDir}0001m.ndjson`] = strToU8(lines(many.slice(3000, 3002)));
    files[`${rowsDir}0002.ndjson`] = strToU8(lines(many.slice(3002)));

    const home = join(dir, "home");
    let host = createIndexHost(nodePlatform(home));
    const { opened } = await host.openZip(zipSync(files), [], 1000);
    let db = host.openIndexDatabase(opened.key);
    assert.equal(await db.ensure("tasks", schema), many.length);
    const tasks = join(host.bundleDir(opened.key), "tables", "tasks", "rows");
    const ids = (file: string) => parseRowsText(readFileSync(join(tasks, file), "utf8"), []).map((r) => r.id);
    assert.deepEqual(readdirSync(tasks).sort(), ["0001.ndjson", "0001m.ndjson", "0002.ndjson"]);
    assert.equal(readFileSync(join(tasks, "0001m.ndjson"), "utf8"), lines(many.slice(3000, 3002)));

    // A row in the middle file edited, one added, the first file's first ten removed: each written to its own file.
    const removed = many.slice(0, 10).map((r) => ({ kind: "remove" as const, rowId: r.id }));
    await db.rows({ ask: "edits", name: "tasks", table: { schema }, edits: [{ kind: "cell", rowId: "r3001", field: "title", value: "Edited" }, { kind: "add", rowId: "r-new" }, ...removed] });
    assert.equal(await db.save("tasks", schema, true), true);
    assert.deepEqual(readdirSync(tasks).sort(), ["0001.ndjson", "0001m.ndjson", "0002.ndjson"]);
    assert.deepEqual(ids("0001.ndjson"), many.slice(10, 3000).map((r) => r.id));
    assert.deepEqual(ids("0001m.ndjson"), ["r3000", "r3001"]);
    assert.equal(parseRowsText(readFileSync(join(tasks, "0001m.ndjson"), "utf8"), [])[1]!.title, "Edited");
    assert.deepEqual(ids("0002.ndjson"), [...many.slice(3002).map((r) => r.id), "r-new"]);
    await db.close();

    // Made again from the files kept here (after a relaunch): the same files, and a save keeps them.
    host = createIndexHost(nodePlatform(home));
    db = host.openIndexDatabase(opened.key);
    // Its rows placed afresh, from 1: where each file starts is said again, not kept from before.
    assert.equal(await db.build("tasks", schema), many.length - 9);
    await db.rows({ ask: "edits", name: "tasks", table: { schema }, edits: [{ kind: "remove", rowId: "r3000" }, { kind: "remove", rowId: "r3001" }] });
    assert.equal(await db.save("tasks", schema, true), true);
    // The middle file's rows all gone: so is it.
    assert.deepEqual(readdirSync(tasks).sort(), ["0001.ndjson", "0002.ndjson"]);
    assert.deepEqual(ids("0001.ndjson"), many.slice(10, 3000).map((r) => r.id));
    assert.deepEqual(ids("0002.ndjson"), [...many.slice(3002).map((r) => r.id), "r-new"]);
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a large table from an archive with a line it can't read isn't indexed: held in memory, the line kept and said (#567)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-index-host-"));
  try {
    const source = join(dir, "source.table");
    cpSync(join(fixtures, "projects.table"), source, { recursive: true });
    const bundle = await readBundle(nodeFs, source);
    const schema = bundle.tables.tasks!.schema;
    const many = Array.from({ length: 6000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ${"x".repeat(400)}`, priority: i % 7 }));
    bundle.tables.tasks!.rows = [];
    const files = unzipSync(await bundleToArchive("projects", bundle));
    const rowsDir = "projects.table/tables/tasks/rows/";
    const lines = (rows: typeof many) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
    const broken = '{"id":"r9999","title":"Broken by a typo"\n';
    const repeat = '{"id":"r5","title":"Edited on another branch"}\n';
    files[`${rowsDir}0001.ndjson`] = strToU8(lines(many.slice(0, 3000)));
    files[`${rowsDir}0002.ndjson`] = strToU8(lines(many.slice(3000, 4000)) + broken + repeat + lines(many.slice(4000)));

    const host = createIndexHost(nodePlatform(join(dir, "home")));
    const { opened } = await host.openZip(zipSync(files), [], 1000);
    assert.ok(opened.bundle.tables.tasks!.indexed);
    const db = host.openIndexDatabase(opened.key);
    await assert.rejects(db.ensure("tasks", schema), /a line of rows\/0002.ndjson couldn't be read/);

    // Read into memory instead, as a reader reads it: every row, and both lines kept where they were.
    const held = db.heldRows("tasks")!;
    assert.deepEqual(held.rows, many);
    assert.deepEqual(held.unread, [
      { after: "r3999", text: broken.trimEnd() },
      { after: "r3999", text: repeat.trimEnd() },
    ]);
    assert.equal(held.diagnostics.length, 2);
    assert.deepEqual(held.rowFiles.map((f) => [f.name, f.ids.length]), [["0001.ndjson", 3000], ["0002.ndjson", 3000]]);
    // Taken once: the archive isn't held after.
    assert.equal(db.heldRows("tasks"), null);
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
