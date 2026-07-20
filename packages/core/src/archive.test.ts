import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readTableArchive, writeTableArchive } from "./archive.js";
import { writeZip } from "./zip.js";
import { parseTable } from "./parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "..", "..", "fixtures");

const enc = (s: string) => new TextEncoder().encode(s);

test("round-trip: writeTableArchive → readTableArchive matches parseTable", async () => {
  const disk = await parseTable(resolve(fixturesDir, "projects.table"));
  const zipped = await writeTableArchive("projects", disk);
  const back = await readTableArchive(zipped);
  assert.deepEqual(back.schema, disk.schema);
  assert.deepEqual(back.rows, disk.rows);
  assert.deepEqual(back.views, disk.views);
  assert.deepEqual(back.bodies, disk.bodies);
  assert.equal(back.meta.format, "table");
  assert.equal(back.diagnostics, undefined);
  assert.equal(back.path, "projects.table"); // buffer source → root name
});

test("archive output is byte-deterministic", async () => {
  const disk = await parseTable(resolve(fixturesDir, "projects.table"));
  const a = await writeTableArchive("projects", disk);
  const b = await writeTableArchive("projects", disk);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test("skip-and-collect applies inside archives", async () => {
  const zipped = writeZip([
    { name: "t.table/schema.json", data: enc('{"fields":[{"name":"x","type":"string"}]}') },
    { name: "t.table/rows.ndjson", data: enc('{"id":"r1","x":"ok"}\n{broken\n') },
  ]);
  const t = await readTableArchive(zipped);
  assert.equal(t.rows.length, 1);
  assert.equal(t.diagnostics?.length, 1);
  assert.match(t.diagnostics![0]!.message, /malformed line/);
});

test("missing schema.json in archive is fatal", async () => {
  const zipped = writeZip([
    { name: "t.table/rows.ndjson", data: enc('{"id":"r1"}\n') },
  ]);
  await assert.rejects(readTableArchive(zipped), /missing schema\.json/);
});

test("archiver junk is ignored; layout violations rejected", async () => {
  const good = writeZip([
    { name: "t.table/schema.json", data: enc('{"fields":[]}') },
    { name: "__MACOSX/t.table/._schema.json", data: enc("junk") },
    { name: "t.table/.DS_Store", data: enc("junk") },
  ]);
  const t = await readTableArchive(good);
  assert.deepEqual(t.schema.fields, []);

  const twoRoots = writeZip([
    { name: "a.table/schema.json", data: enc('{"fields":[]}') },
    { name: "b.table/schema.json", data: enc('{"fields":[]}') },
  ]);
  await assert.rejects(readTableArchive(twoRoots), /exactly one root/);

  const notTable = writeZip([{ name: "stuff/schema.json", data: enc("{}") }]);
  await assert.rejects(readTableArchive(notTable), /<name>\.table directory/);
});

test("hostile entry names are rejected (zip-slip class)", () => {
  assert.throws(() => writeZip([{ name: "../evil", data: enc("x") }]), /unsafe/);
  assert.throws(() => writeZip([{ name: "/abs", data: enc("x") }]), /unsafe/);
  assert.throws(
    () => writeZip([{ name: "t.table/../../evil", data: enc("x") }]),
    /unsafe/,
  );
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
    const disk = await parseTable(resolve(fixturesDir, "projects.table"));
    assert.deepEqual(fromCli.rows, disk.rows);
    assert.deepEqual(fromCli.schema, disk.schema);
    assert.deepEqual(fromCli.bodies, disk.bodies);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file-path source sets path to the archive path", async () => {
  const disk = await parseTable(resolve(fixturesDir, "tasks.table"));
  const dir = await mkdtemp(join(tmpdir(), "table-zip-"));
  try {
    const out = join(dir, "tasks.table.zip");
    const bytes = await writeTableArchive("tasks.table", disk); // .table suffix accepted
    await (await import("node:fs/promises")).writeFile(out, bytes);
    const back = await readTableArchive(out);
    assert.equal(back.path, out);
    assert.equal(back.rows.length, disk.rows.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
