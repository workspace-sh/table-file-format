import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readTableArchive, writeTableArchive } from "./archive.js";
import { writeZip } from "./zip.js";
import { parseBundle } from "./parser.js";
import { tableOrder } from "./bundle.js";
import { fixturesDir } from "./test-fixtures.js";

const enc = (s: string) => new TextEncoder().encode(s);
const projects = () => parseBundle(resolve(fixturesDir, "projects.table"));

test("round-trip: writeTableArchive → readTableArchive matches parseBundle", async () => {
  const disk = await projects();
  const back = await readTableArchive(await writeTableArchive("projects", disk));
  assert.deepEqual(tableOrder(back), ["projects", "tasks"]);
  for (const name of ["projects", "tasks"]) {
    assert.deepEqual(back.tables[name]!.schema, disk.tables[name]!.schema, name);
    assert.deepEqual(back.tables[name]!.rows, disk.tables[name]!.rows, name);
    assert.deepEqual(back.tables[name]!.views, disk.tables[name]!.views, name);
    assert.deepEqual(back.tables[name]!.bodies, disk.tables[name]!.bodies, name);
    assert.equal(back.tables[name]!.diagnostics, undefined, name);
  }
  assert.equal(back.meta.format, "table");
  assert.equal(back.meta.title, "Projects");
  assert.equal(back.diagnostics, undefined);
  assert.equal(back.path, "projects.table"); // buffer source → root name
});

test("archive output is byte-deterministic", async () => {
  const disk = await projects();
  const a = await writeTableArchive("projects", disk);
  const b = await writeTableArchive("projects", disk);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test("skip-and-collect applies inside archives, per table", async () => {
  const zipped = writeZip([
    { name: "t.table/tables/t/schema.json", data: enc('{"fields":[{"name":"x","type":"string"}]}') },
    { name: "t.table/tables/t/rows.ndjson", data: enc('{"id":"r1","x":"ok"}\n{broken\n') },
  ]);
  const b = await readTableArchive(zipped);
  assert.equal(b.tables.t!.rows.length, 1);
  assert.equal(b.tables.t!.diagnostics?.length, 1);
  assert.match(b.tables.t!.diagnostics![0]!.message, /malformed line/);
});

test("a table without schema.json is reported, not read; a malformed one is fatal", async () => {
  const missing = writeZip([
    { name: "t.table/tables/good/schema.json", data: enc('{"fields":[]}') },
    { name: "t.table/tables/good/rows.ndjson", data: enc("") },
    { name: "t.table/tables/bad/rows.ndjson", data: enc('{"id":"r1"}\n') },
  ]);
  const b = await readTableArchive(missing);
  assert.deepEqual(Object.keys(b.tables), ["good"]);
  assert.match(b.diagnostics![0]!.message, /tables\/bad isn't a table/);

  const malformed = writeZip([
    { name: "t.table/tables/t/schema.json", data: enc("{not json") },
    { name: "t.table/tables/t/rows.ndjson", data: enc("") },
  ]);
  await assert.rejects(readTableArchive(malformed));
});

test("archiver junk is ignored; layout violations rejected", async () => {
  const good = writeZip([
    { name: "t.table/tables/t/schema.json", data: enc('{"fields":[]}') },
    { name: "t.table/tables/t/rows.ndjson", data: enc("") },
    { name: "__MACOSX/t.table/._meta.json", data: enc("junk") },
    { name: "t.table/.DS_Store", data: enc("junk") },
  ]);
  const b = await readTableArchive(good);
  assert.deepEqual(b.tables.t!.schema.fields, []);

  const twoRoots = writeZip([
    { name: "a.table/meta.json", data: enc("{}") },
    { name: "b.table/meta.json", data: enc("{}") },
  ]);
  await assert.rejects(readTableArchive(twoRoots), /exactly one root/);

  const notTable = writeZip([{ name: "stuff/meta.json", data: enc("{}") }]);
  await assert.rejects(readTableArchive(notTable), /<name>\.table directory/);
});

test("hostile entry names are rejected (zip-slip class)", async () => {
  assert.throws(() => writeZip([{ name: "../evil", data: enc("x") }]), /unsafe/);
  assert.throws(() => writeZip([{ name: "/abs", data: enc("x") }]), /unsafe/);
  assert.throws(
    () => writeZip([{ name: "t.table/../../evil", data: enc("x") }]),
    /unsafe/,
  );
  const t = { schema: { fields: [] }, rows: [] };
  await assert.rejects(writeTableArchive("b", { tables: { "../evil": t } }), /invalid table name/);
});

test("reads archives produced by the system zip CLI", async (t) => {
  if (!existsSync("/usr/bin/zip")) return t.skip("no system zip");
  const dir = await mkdtemp(join(tmpdir(), "table-zip-"));
  try {
    const out = join(dir, "projects.table.zip");
    execFileSync("/usr/bin/zip", ["-qr", out, "projects.table", "-x", "*.sqlite"], {
      cwd: fixturesDir,
    });
    const fromCli = await readTableArchive(await readFile(out));
    const disk = await projects();
    for (const name of ["projects", "tasks"]) {
      assert.deepEqual(fromCli.tables[name]!.rows, disk.tables[name]!.rows, name);
      assert.deepEqual(fromCli.tables[name]!.schema, disk.tables[name]!.schema, name);
      assert.deepEqual(fromCli.tables[name]!.bodies, disk.tables[name]!.bodies, name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bytes-only API: path is the root name; .table name suffix accepted", async () => {
  const disk = await projects();
  const back = await readTableArchive(await writeTableArchive("projects.table", disk)); // suffix accepted
  assert.equal(back.path, "projects.table");
  assert.equal(back.tables.tasks!.rows.length, disk.tables.tasks!.rows.length);
});
