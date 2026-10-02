// derive() on the renders that change nothing about the table on screen
// gives the same rows again (#126), and works them out again when anything
// they read has changed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bundles } from "@workspace.sh/table-fixtures";
import { derive, initialAppState, tableApp } from "./appState.ts";
import { fromBundle } from "./bundles.ts";

const tables = Object.assign({}, ...Object.entries(bundles).map(([key, b]) => fromBundle(key, b)));
const metas = Object.fromEntries(Object.entries(bundles).map(([key, b]) => [key, b.meta]));
const start = { ...initialAppState({ tables, bundles: metas }), active: "crm/companies" };

test("a render that changes nothing about the table gives the same rows and summary", () => {
  const before = derive(start);
  const panel = derive(tableApp(start, { type: "settings", open: true }));
  assert.equal(panel.shown, before.shown);
  assert.equal(panel.summary, before.summary);
});

test("an edit works the rows out again, and shows the edit", () => {
  const before = derive(start);
  const id = before.shown.rows[0]!.id;
  const after = derive(tableApp(start, { type: "updateRow", rowId: id, field: "name", value: "Renamed" }));
  assert.notEqual(after.shown, before.shown);
  assert.ok(after.shown.rows.some((r) => r.name === "Renamed"));
  assert.ok(!before.shown.rows.some((r) => r.name === "Renamed"));
});

test("a search is worked out again, and clearing it goes back to all the rows", () => {
  const all = derive(start);
  const searched = derive({ ...start, search: "freight" });
  assert.equal(searched.shown.rows.length, 1);
  assert.equal(derive({ ...start, search: "" }).shown.rows.length, all.shown.rows.length);
});

test("another table in the bundle changing works the rows out again: lookups read it", () => {
  const before = derive({ ...start, active: "crm/deals" });
  const company = start.tables["crm/companies"]!;
  const edited = {
    ...start,
    active: "crm/deals",
    tables: { ...start.tables, "crm/companies": { ...company, rows: company.rows.map((r, i) => (i === 0 ? { ...r, name: "Changed" } : r)) } },
  };
  assert.notEqual(derive(edited).shown, before.shown);
});
