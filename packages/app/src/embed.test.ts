import { test } from "node:test";
import assert from "node:assert/strict";

import { bundles } from "@workspace.sh/table-fixtures";
import { fromBundle } from "./bundles.ts";
import { EMBED_COUNT_MAX, embedIn, embedSize } from "./embed.ts";
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
