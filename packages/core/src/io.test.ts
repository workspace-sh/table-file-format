import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { joinPath, memoryFs, readBundle, readTable, writeBundleTo, writeTableTo } from "./io.js";

const table = {
  schema: { fields: [{ name: "title", type: "string" as const }] },
  rows: [{ id: "r1", title: "One" }],
  views: [{ id: "v", name: "All", layout: "table" as const }],
  meta: { title: "Things" },
  bodies: { r1: "# Page" },
};

test("a bundle written over any file system reads back as it was", async () => {
  const fs = memoryFs();
  await writeBundleTo(fs, "/x/b.table", { meta: { title: "B" }, tables: { things: table } });
  const back = await readBundle(fs, "/x/b.table");
  assert.equal(back.meta.title, "B");
  assert.deepEqual(back.meta.tables, ["things"]);
  assert.deepEqual(back.tables["things"]!.rows, table.rows);
  assert.equal(back.tables["things"]!.bodies?.["r1"], "# Page\n");
  assert.equal(back.diagnostics, undefined);
  // Every file went through a staged rename; nothing is left staged.
  assert.ok(fs.renames >= 6);
  assert.equal([...fs.files.keys()].some((f) => f.endsWith(".tmp")), false);
});

test("a table directory missing its files is reported, not read", async () => {
  const fs = memoryFs();
  await fs.mkdir("/b.table/tables/stray");
  await fs.writeText("/b.table/tables/stray/notes.txt", "hi");
  const back = await readBundle(fs, "/b.table");
  assert.deepEqual(Object.keys(back.tables), []);
  assert.match(back.diagnostics![0]!.message, /tables\/stray isn't a table/);
});

test("no schema.json is fatal; a failed stage leaves the table as it was", async () => {
  const fs = memoryFs();
  await assert.rejects(readTable(fs, "/nowhere"), /no schema\.json/);
  await writeTableTo(fs, "/t", table);
  const before = new Map(fs.files);
  await assert.rejects(writeTableTo(fs, "/t", { ...table, rows: [{ id: "r1", title: "Changed" }], bodies: { "no/dir": "x" } }));
  assert.deepEqual(fs.files, before);
});

test("rewriting without bodies removes them; a dropped table is trimmed", async () => {
  const fs = memoryFs();
  await writeBundleTo(fs, "/b", { tables: { a: table, b: table } });
  await writeBundleTo(fs, "/b", { tables: { a: { ...table, bodies: {} } } });
  assert.equal((await fs.list("/b/tables/a/bodies")), null);
  assert.equal((await fs.list("/b/tables/b")), null);
});

test("io reaches for nothing from Node, so React Native and browsers can load it", () => {
  const source = readFileSync(fileURLToPath(new URL("./io.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /from "node:/);
});

test("paths join with one separator", () => {
  assert.equal(joinPath("/a/", "b", "/c.json"), "/a/b/c.json");
  assert.equal(joinPath("a", "", "b"), "a/b");
});

test("bodies read in name order, whatever order the file system lists them", async () => {
  const fs = memoryFs();
  await writeTableTo(fs, "/t", { ...table, rows: [{ id: "b" }, { id: "a" }], bodies: { b: "B", a: "A" } });
  // Listed backwards by name, whatever order memoryFs keeps them in.
  const backwards = { ...fs, list: async (p: string) => ((await fs.list(p)) ?? []).sort((x, y) => (x.name < y.name ? 1 : -1)) };
  const back = await readTable(backwards, "/t");
  assert.deepEqual(Object.keys(back.bodies!), ["a", "b"]);
});

test("saving again writes only what changed, and adds no attachments folder", async () => {
  const fs = memoryFs();
  const bundle = { tables: { a: table, b: table } };
  await writeBundleTo(fs, "/b", bundle);
  assert.equal((await fs.list("/b/tables/a"))!.some((e) => e.name === "attachments"), false);
  let writes = 0;
  const counting = { ...fs, writeText: async (p: string, c: string) => { writes++; return fs.writeText(p, c); } };
  await writeBundleTo(counting, "/b", bundle);
  assert.equal(writes, 0);
  await writeBundleTo(counting, "/b", { tables: { a: { ...table, rows: [{ id: "r1", title: "Two" }] }, b: table } });
  // Only a's rows: not its schema, views, meta or body, not table b, not the manifest.
  assert.equal(writes, 1);
  assert.equal((await fs.readText("/b/tables/b/rows.ndjson"))!.includes("One"), true);
});
