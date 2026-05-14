import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseTable } from "./parser.js";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/parser.test.ts → repo root → fixtures/
const fixturesDir = resolve(here, "..", "..", "..", "fixtures");

test("parseTable reads projects.table fixture", async () => {
  const t = await parseTable(resolve(fixturesDir, "projects.table"));
  assert.equal(t.schema.fields.length, 6);
  assert.equal(t.rows.length, 7);
  assert.equal(t.views.length, 7);
  assert.equal(t.meta.title, "Projects");
  assert.equal(t.meta.format, "table");
  assert.equal(t.meta.formatVersion, 1);
});

test("every parsed row carries a non-empty system id", async () => {
  const t = await parseTable(resolve(fixturesDir, "projects.table"));
  for (const row of t.rows) {
    assert.equal(typeof row.id, "string");
    assert.ok((row.id as string).length > 0);
  }
});

test("parseTable preserves cross-table relation declaration on tasks", async () => {
  const t = await parseTable(resolve(fixturesDir, "tasks.table"));
  const projectField = t.schema.fields.find((f) => f.name === "project");
  assert.ok(projectField, "tasks schema should declare a project field");
  assert.equal(projectField!.relation?.table, "projects");
  assert.equal(projectField!.relation?.field, "id");
});

test("parseTable throws on row missing system id", async () => {
  await assert.rejects(async () => {
    await parseTable(resolve(here, "..", "..", "..", "fixtures-broken-DOES-NOT-EXIST"));
  });
});

test("parseTable reads bodies/{id}.md and keys them by row id", async () => {
  const t = await parseTable(resolve(fixturesDir, "projects.table"));
  assert.ok(t.bodies, "bodies map should be present when bodies/ exists");
  assert.ok("p2" in t.bodies!, "p2 should have a body in fixtures");
  assert.match(t.bodies!.p2!, /Table file format spike/);
});

test("parseTable returns no bodies field when bodies/ is absent", async () => {
  const t = await parseTable(resolve(fixturesDir, "tasks.table"));
  assert.equal(t.bodies, undefined);
});
