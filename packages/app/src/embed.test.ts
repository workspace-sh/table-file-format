import { test } from "node:test";
import assert from "node:assert/strict";

import { bundles } from "@workspace.sh/table-fixtures";
import { fromBundle } from "./bundles.ts";
import { EMBED_COUNT_MAX, embedCount, embedIn, embedLeftOut, embedMoreText, embedSize } from "./embed.ts";
import type { Library } from "./library.ts";

// One `.table` file as an app reads it: its tables by `bundle/table` key.
const read = (key: string): Library => ({
  tables: fromBundle(key, bundles[key]!),
  bundles: { [key]: bundles[key]!.meta },
  paths: { [key]: `/somewhere/${key}.table` },
  problems: {},
});
const projects = read("projects");
const words = (library: Library, address: { tableName?: string; viewId?: string }, file = "projects.table") => {
  const result = embedIn(library, address, file);
  return result.kind === "problem" ? result.text : `shown: ${result.key} ${result.viewId}`;
};

test("the table and view an address names are what is drawn", () => {
  const result = embedIn(projects, { tableName: "tasks", viewId: "v2" }, "projects.table");
  assert.equal(result.kind, "shown");
  assert.deepEqual(result.kind === "shown" && [result.key, result.viewId, result.library], ["projects/tasks", "v2", projects]);
});

test("with no view named, it is the table's first", () => {
  assert.equal(words(projects, { tableName: "projects" }), "shown: projects/projects v1");
});

test("a table with no views of its own is drawn as it is", () => {
  const bare: Library = { ...projects, tables: { ...projects.tables, "projects/tasks": { ...projects.tables["projects/tasks"]!, views: [] } } };
  assert.equal(words(bare, { tableName: "tasks" }), "shown: projects/tasks ");
  assert.equal(words(bare, { tableName: "tasks", viewId: "v1" }), "The table “tasks” has no view “v1”. It has no views of its own.");
});

test("with no table named, a file's only table is drawn, and a file of several says which it has", () => {
  const one: Library = { ...projects, tables: { "projects/tasks": projects.tables["projects/tasks"]! } };
  assert.equal(words(one, {}), "shown: projects/tasks v1");
  assert.equal(words(projects, {}), "“projects.table” holds 2 tables. The link says which with “table=”: “projects”, “tasks”.");
});

test("a table or a view the file doesn't have is said, with the ones it has", () => {
  assert.equal(words(projects, { tableName: "nope" }), "“projects.table” has no table named “nope”. It has “projects”, “tasks”.");
  assert.equal(words(projects, { tableName: "tasks", viewId: "nope" }), "The table “tasks” has no view “nope”. It has “v1”, “v2”.");
});

test("a table read without its rows (one for the index) is too large to draw in a document", () => {
  const large: Library = { ...projects, tables: { ...projects.tables, "projects/tasks": { ...projects.tables["projects/tasks"]!, rows: [], indexed: { count: 60_000, version: 0 } } } };
  assert.equal(words(large, { tableName: "tasks" }), "“tasks” in “projects.table” has too many rows to show in a document yet.");
  // The tables beside it are still drawn.
  assert.equal(words(large, { tableName: "projects" }), "shown: projects/projects v1");
});

test("a file that held no table says what was wrong reading it, when something was", () => {
  const nothing: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  assert.equal(words(nothing, {}, "notes.table"), "“notes.table” isn’t a .table, or it holds no tables.");
  assert.equal(words({ ...nothing, problems: { notes: ["no schema.json, so this isn't a table"] } }, {}, "notes.table"), "“notes.table” couldn’t be read: no schema.json, so this isn't a table");
});

test("an address says how many rows or cards to show at once, and only a whole number from 1 counts", () => {
  assert.deepEqual(embedSize({ extra: { rows: "5", embed: "1" } }), { rows: 5 });
  assert.deepEqual(embedSize({ extra: { cards: "3", rows: "12" } }), { rows: 12, cards: 3 });
  assert.deepEqual(embedSize({}), {});
  for (const not of ["0", "-2", "2.5", "five", "5px", "", "05"]) assert.deepEqual(embedSize({ extra: { rows: not, cards: not } }), {}, not);
  // No more than the cap, however many are asked for.
  assert.deepEqual(embedSize({ extra: { rows: "100000" } }), { rows: EMBED_COUNT_MAX });
});

test("what is drawn carries the size its address asked for", () => {
  const result = embedIn(projects, { tableName: "tasks", viewId: "v1", extra: { rows: "4", embed: "1" } }, "projects.table");
  assert.deepEqual(result.kind === "shown" && result.size, { rows: 4 });
  const plain = embedIn(projects, { tableName: "tasks" }, "projects.table");
  assert.deepEqual(plain.kind === "shown" && plain.size, {});
});

test("rest=more is read beside a count; any other value is the same as none", () => {
  assert.deepEqual(embedSize({ extra: { rows: "5", rest: "more" } }), { rows: 5, rest: "more" });
  for (const other of ["scroll", "MORE", "all", ""]) assert.deepEqual(embedSize({ extra: { rows: "5", rest: other } }), { rows: 5 }, other);
});

test("a layout shows one of the two counts: rows for a table or a list, cards for a board or a gallery, neither for a calendar", () => {
  const size = { rows: 4, cards: 2 };
  assert.deepEqual(
    (["table", "list", "board", "gallery", "calendar"] as const).map((layout) => embedCount(size, layout)),
    [4, 4, 2, 2, undefined],
  );
});

test("an embed cut to its count says how many rows or cards it leaves out", () => {
  const tasks = projects.tables["projects/tasks"]!;
  const table = tasks.views.find((v) => v.id === "v1")!;
  const board = tasks.views.find((v) => v.id === "v2")!;
  const left = (size: Parameters<typeof embedLeftOut>[0], view = table) => embedLeftOut(size, view, tasks.rows, tasks.schema);
  // Eight tasks.
  assert.equal(left({ rows: 5, rest: "more" }), 3);
  assert.equal(left({ rows: 8, rest: "more" }), 0);
  assert.equal(left({ rows: 20, rest: "more" }), 0);
  // Not cut: it scrolls to them, so nothing is left out.
  assert.equal(left({ rows: 5 }), 0);
  // A count the layout doesn't show cuts nothing.
  assert.equal(left({ cards: 2, rest: "more" }), 0);
  assert.equal(left({ rest: "more" }), 0);
  // A board: the cards past the count in each column. todo 3, doing 3, done 2.
  assert.equal(left({ cards: 1, rest: "more" }, board), 2 + 2 + 1);
  assert.equal(left({ cards: 2, rest: "more" }, board), 1 + 1 + 0);
  assert.equal(left({ cards: 3, rest: "more" }, board), 0);
  assert.equal(left({ rows: 1, rest: "more" }, board), 0);
});

test("the line beneath a cut embed counts what its layout shows", () => {
  assert.equal(embedMoreText(12, "table"), "Show 12 more rows");
  assert.equal(embedMoreText(1, "list"), "Show 1 more row");
  assert.equal(embedMoreText(5, "board"), "Show 5 more cards");
  assert.equal(embedMoreText(1, "gallery"), "Show 1 more card");
  assert.equal(embedMoreText(1200, "table"), "Show 1,200 more rows");
});

// Read over any platform's files: a workspace in memory, a document in docs/ linking to tables/.
test("a link is read over any platform's files, from the document's folder and kept inside the open one", async () => {
  const { memoryFs, writeBundleTo } = await import("@workspace.sh/table-core/io");
  const { readEmbedWith, embedFilesWith, resolvePath } = await import("./embed.ts");
  const fs = memoryFs();
  await writeBundleTo(fs, "/ws/tables/projects.table", bundles.projects!);
  await fs.mkdir("/ws/docs");
  await fs.writeText("/ws/docs/notes.txt", "not a table");
  const at = (address: string, within: string | null = "/ws") =>
    readEmbedWith(fs, { address, baseDir: "/ws/docs", ...(within ? { within } : {}) }).then((r) => (r.kind === "problem" ? r.text : `shown: ${r.key} ${r.viewId} ${JSON.stringify(r.size)}`));

  assert.equal(resolvePath("/ws/docs", "../tables/./projects.table"), "/ws/tables/projects.table");
  // As iOS's files speak: a URL keeps its scheme.
  assert.equal(resolvePath("file:///var/mobile/ws/docs", "../tables/projects.table"), "file:///var/mobile/ws/tables/projects.table");
  assert.equal(await at("../tables/projects.table#table=tasks&view=v1&rows=5&embed=1"), 'shown: projects/tasks v1 {"rows":5}');
  // Percent-encoded as Markdown writes a space.
  await writeBundleTo(fs, "/ws/tables/my projects.table", bundles.projects!);
  assert.match(await at("../tables/my%20projects.table#table=tasks&embed=1"), /^shown: my projects\/tasks /);
  assert.equal(await at("../../elsewhere/projects.table#embed=1"), "“../../elsewhere/projects.table” is outside the folder that’s open, so it isn’t shown.");
  assert.equal(await at("../tables/projects.table#embed=1", "/ws/tables/projects.table"), "“../tables/projects.table” is outside the folder that’s open, so it isn’t shown.");
  assert.match(await at("../../elsewhere/projects.table#embed=1", null), /^There’s no table at/);
  assert.equal(await at("../tables/nowhere.table#embed=1"), "There’s no table at “../tables/nowhere.table”.");
  assert.equal(await at("notes.txt#embed=1"), "“notes.txt” isn’t a .table.");
  assert.equal(await at("../tables/projects.table#table=nope&embed=1"), "“projects.table” has no table named “nope”. It has “projects”, “tasks”.");

  // Written back where it was read from, history beside its table.
  const shown = await readEmbedWith(fs, { address: "../tables/projects.table#table=tasks&embed=1", baseDir: "/ws/docs" });
  assert.equal(shown.kind, "shown");
  if (shown.kind !== "shown") return;
  const files = embedFilesWith(fs);
  const table = shown.library.tables[shown.key]!;
  const renamed = { ...table, rows: table.rows.map((r, i) => (i === 0 ? { ...r, title: "Renamed" } : r)) };
  await files.write(shown.library, { ...shown.library.tables, [shown.key]: renamed }, shown.library.bundles, "projects");
  assert.match((await fs.readText("/ws/tables/projects.table/tables/tasks/rows.ndjson"))!, /Renamed/);
  await files.appendHistory!(shown.library, shown.key, [{ id: "e1", at: "2026-10-13T00:00:00Z", op: "set", row: renamed.rows[0]!.id, field: "title", to: "Renamed" }]);
  assert.ok((await fs.readText("/ws/tables/projects.table/tables/tasks/history.ndjson"))?.includes("Renamed"));
});
