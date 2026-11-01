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

test("the same file opened again takes the index made from it; after a save, or another file, it is made again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-index-host-"));
  try {
    const source = join(dir, "source.table");
    cpSync(join(fixtures, "projects.table"), source, { recursive: true });
    const bundle = await readBundle(nodeFs, source);
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ${"x".repeat(400)}`, priority: i % 7 }));
    bundle.tables.tasks!.rows = many;
    const schema = bundle.tables.tasks!.schema;
    const archive = await bundleToArchive("projects", bundle);
    const home = join(dir, "home");
    // Each rows file written is a build from the archive.
    let written = 0;
    const counted = (): IndexHostPlatform => {
      const p = nodePlatform(home);
      return { ...p, writer: async (path) => (written++, p.writer(path)) };
    };
    const openAndEnsure = async (bytes: Uint8Array) => {
      const host = createIndexHost(counted());
      const { opened } = await host.openZip(bytes, [], 1000);
      const db = host.openIndexDatabase(opened.key);
      const kept = opened.bundle.tables.tasks!.indexed?.kept === true;
      const count = await db.ensure("tasks", schema);
      return { db, count, kept };
    };

    let { db, count, kept } = await openAndEnsure(archive);
    assert.equal(count, many.length);
    assert.equal(written, 1, "made from the archive the first time");
    assert.equal(kept, false);
    await db.close();

    ({ db, count, kept } = await openAndEnsure(archive));
    assert.equal(count, many.length);
    assert.equal(written, 1, "opened again: taken as it is");
    // Said as it's opened, before anything is shown: the screen never says it's being read.
    assert.equal(kept, true);

    // An edit saved: the index is this device's now, and the archive's rows are read again when it's opened.
    await db.rows({ ask: "edits", name: "tasks", table: { schema }, edits: [{ kind: "cell", rowId: "r0", field: "title", value: "Edited" }] });
    assert.equal(await db.save("tasks", schema, true), true);
    await db.close();
    ({ db, count, kept } = await openAndEnsure(archive));
    assert.equal(written, 3, "made again after a save (the save wrote one rows file, the build another)");
    assert.equal(kept, false);
    await db.close();

    // Another file of the same name: made again.
    bundle.tables.tasks!.rows = many.map((r, i) => (i === 1 ? { ...r, title: "Changed" } : r));
    ({ db, count } = await openAndEnsure(await bundleToArchive("projects", bundle)));
    assert.equal(written, 4, "another archive: made again");
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a save writes again only the rows files holding an edited row; a field left out of every row writes them all", async () => {
  const dir = mkdtempSync(join(tmpdir(), "table-index-host-"));
  try {
    const source = join(dir, "source.table");
    cpSync(join(fixtures, "projects.table"), source, { recursive: true });
    const bundle = await readBundle(nodeFs, source);
    const schema = bundle.tables.tasks!.schema;
    // Each file over 1 MB, so the archive hands them over still compressed, to be indexed.
    const many = Array.from({ length: 6000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ${"x".repeat(700)}`, priority: i % 7 }));
    bundle.tables.tasks!.rows = [];
    const files = unzipSync(await bundleToArchive("projects", bundle));
    const rowsDir = "projects.table/tables/tasks/rows/";
    const lines = (rows: typeof many) => rows.map((r) => `${JSON.stringify(r)}\n`).join("");
    files[`${rowsDir}0001.ndjson`] = strToU8(lines(many.slice(0, 2000)));
    files[`${rowsDir}0002.ndjson`] = strToU8(lines(many.slice(2000, 4000)));
    files[`${rowsDir}0003.ndjson`] = strToU8(lines(many.slice(4000)));
    const home = join(dir, "home");
    // The rows files each save writes (staged, then moved over).
    let wrote: string[] = [];
    const platform = nodePlatform(home);
    const host = createIndexHost({ ...platform, writer: async (path) => (wrote.push(path.split("/").pop()!.replace(/\.tmp$/, "")), platform.writer(path)) });
    const { opened } = await host.openZip(zipSync(files), [], 1000);
    const db = host.openIndexDatabase(opened.key);
    assert.equal(await db.ensure("tasks", schema), many.length);
    const tasks = join(host.bundleDir(opened.key), "tables", "tasks", "rows");
    const ids = (file: string) => parseRowsText(readFileSync(join(tasks, file), "utf8"), []).map((r) => r.id);
    const edit = async (edits: Parameters<typeof db.rows>[0] extends infer R ? (R extends { edits: infer E } ? E : never) : never) => {
      wrote = [];
      await db.rows({ ask: "edits", name: "tasks", table: { schema }, edits });
      assert.equal(await db.save("tasks", schema, true), true);
      return [...wrote].sort();
    };

    // One cell in the middle file: only that file.
    assert.deepEqual(await edit([{ kind: "cell", rowId: "r3001", field: "title", value: "Edited" }]), ["0002.ndjson"]);
    assert.equal(parseRowsText(readFileSync(join(tasks, "0002.ndjson"), "utf8"), []).find((r) => r.id === "r3001")!.title, "Edited");
    assert.deepEqual(ids("0001.ndjson"), many.slice(0, 2000).map((r) => r.id));
    // A row added: the last file.
    assert.deepEqual(await edit([{ kind: "add", rowId: "r-new" }]), ["0003.ndjson"]);
    assert.equal(ids("0003.ndjson").at(-1), "r-new");
    // A row removed from the first: that file.
    assert.deepEqual(await edit([{ kind: "remove", rowId: "r5" }]), ["0001.ndjson"]);
    assert.equal(ids("0001.ndjson").includes("r5"), false);
    // Nothing edited since: a save writes no rows file.
    wrote = [];
    assert.equal(await db.save("tasks", schema, true), true);
    assert.deepEqual(wrote, []);
    // Every row, in order, across the files.
    assert.deepEqual(
      [...ids("0001.ndjson"), ...ids("0002.ndjson"), ...ids("0003.ndjson")],
      [...many.map((r) => r.id).filter((id) => id !== "r5"), "r-new"],
    );

    // A field left out of every row: every file.
    wrote = [];
    assert.equal(await db.save("tasks", schema, true, ["priority"]), true);
    assert.deepEqual([...wrote].sort(), ["0001.ndjson", "0002.ndjson", "0003.ndjson"]);
    assert.ok(parseRowsText(readFileSync(join(tasks, "0002.ndjson"), "utf8"), []).every((r) => !("priority" in r)));
    await db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
