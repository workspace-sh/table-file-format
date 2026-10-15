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
  assert.equal((await fs.readText("/b/tables/b/rows/0001.ndjson"))!.includes("One"), true);
});

test("a history that came with a table is written once; one on disk is never changed, and a table without one makes none", async () => {
  const fs = memoryFs();
  const table = { schema: { fields: [{ name: "title", type: "string" as const }] }, rows: [{ id: "r1", title: "A" }] };
  const file = "x.table/tables/t/history.ndjson";
  await writeBundleTo(fs, "x.table", { tables: { t: table } });
  assert.equal(await fs.readText(file), null);
  // Arrived with a history (an archive opened into a folder): it is put there.
  const arrived = '{"id":"e1","at":"2026-10-01T15:00:00Z","op":"set","row":"r1","field":"title","to":"A"}\n';
  await writeBundleTo(fs, "x.table", { tables: { t: { ...table, history: arrived } } });
  assert.equal(await fs.readText(file), arrived);
  // The app has added to it since. The table held still carries what it arrived with: the file wins.
  const grown = arrived + '{"id":"e2","at":"2026-10-02T09:00:00Z","op":"set","row":"r1","field":"title","from":"A","to":"B"}\n';
  await fs.writeText(file, grown);
  await writeBundleTo(fs, "x.table", { tables: { t: { ...table, rows: [{ id: "r1", title: "B" }], history: arrived } } });
  assert.equal(await fs.readText(file), grown);
  // Nor is it removed when the table held has none.
  await writeBundleTo(fs, "x.table", { tables: { t: table } });
  assert.equal(await fs.readText(file), grown);
  // The directory reader leaves it where it is.
  assert.equal("history" in (await readBundle(fs, "x.table")).tables.t!, false);
});

test("rows are files in rows/, read in name order; a save writes each row back to its file, only the files that changed (D51)", async () => {
  const fs = memoryFs();
  const schema = { fields: [{ name: "title", type: "string" as const }] };
  await fs.mkdir("/b/tables/t/rows");
  await fs.writeText("/b/tables/t/schema.json", JSON.stringify(schema));
  await fs.writeText("/b/tables/t/rows/0002.ndjson", '{"id":"c","title":"C"}\n');
  await fs.writeText("/b/tables/t/rows/0001.ndjson", '{"id":"a","title":"A"}\n{"id":"b","title":"B"}\n');
  await fs.writeText("/b/tables/t/rows/0001m.ndjson", '{"id":"ab","title":"AB"}\n');
  const read = await readBundle(fs, "/b");
  const t = read.tables.t!;
  assert.deepEqual(t.rows.map((r) => r.id), ["a", "b", "ab", "c"]);
  assert.deepEqual(t.rowFiles, [{ name: "0001.ndjson", ids: ["a", "b"] }, { name: "0001m.ndjson", ids: ["ab"] }, { name: "0002.ndjson", ids: ["c"] }]);
  // An edit to "c" and a new row at the end: only 0002 is written.
  let written: string[] = [];
  const watched = { ...fs, writeText: async (p: string, c: string) => { written.push(p); return fs.writeText(p, c); } };
  const edited = { ...t, rows: [...t.rows.slice(0, 3), { id: "c", title: "C2" }, { id: "d", title: "D" }] };
  await writeBundleTo(watched, "/b", { meta: read.meta, tables: { t: edited } });
  assert.deepEqual(written.filter((p) => p.includes("/rows/")), ["/b/tables/t/rows/0002.ndjson.tmp"]);
  assert.equal(await fs.readText("/b/tables/t/rows/0002.ndjson"), '{"id":"c","title":"C2"}\n{"id":"d","title":"D"}\n');
  // Every row of 0001m removed: the file goes.
  written = [];
  const back = (await readBundle(fs, "/b")).tables.t!;
  await writeBundleTo(fs, "/b", { meta: read.meta, tables: { t: { ...back, rows: back.rows.filter((r) => r.id !== "ab") } } });
  assert.deepEqual((await fs.list("/b/tables/t/rows"))!.map((e) => e.name).sort(), ["0001.ndjson", "0002.ndjson"]);
});

test("formatVersion 1's rows.ndjson is read as the table's rows, and the next save moves them into rows/ (D51)", async () => {
  const fs = memoryFs();
  await fs.mkdir("/b/tables/t");
  await fs.writeText("/b/tables/t/schema.json", JSON.stringify({ fields: [{ name: "title", type: "string" }] }));
  await fs.writeText("/b/tables/t/rows.ndjson", '{"id":"a","title":"A"}\n');
  const read = await readBundle(fs, "/b");
  assert.deepEqual(read.tables.t!.rows.map((r) => r.id), ["a"]);
  await writeBundleTo(fs, "/b", read);
  assert.equal(await fs.readText("/b/tables/t/rows.ndjson"), null);
  assert.equal(await fs.readText("/b/tables/t/rows/0001.ndjson"), '{"id":"a","title":"A"}\n');
});

test("a table with no rows keeps its rows/ folder, with one empty file (git keeps no empty folder)", async () => {
  const fs = memoryFs();
  await writeBundleTo(fs, "/b", { tables: { t: { schema: { fields: [] }, rows: [] } } });
  assert.equal(await fs.readText("/b/tables/t/rows/0001.ndjson"), "");
  assert.deepEqual(Object.keys((await readBundle(fs, "/b")).tables), ["t"]);
});
