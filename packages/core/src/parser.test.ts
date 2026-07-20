import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseTable } from "./parser";

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src/parser.test.ts → repo root → fixtures/
const fixturesDir = resolve(here, "..", "..", "..", "fixtures");

test("parseTable reads projects.table fixture", async () => {
  const t = await parseTable(resolve(fixturesDir, "projects.table"));
  assert.equal(t.schema.fields.length, 6);
  assert.equal(t.rows.length, 17);
  assert.equal(t.views.length, 9);
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

test("parseTable stays fatal on a missing schema.json (not a table)", async () => {
  await assert.rejects(async () => {
    await parseTable(resolve(here, "..", "..", "..", "fixtures-broken-DOES-NOT-EXIST"));
  });
});

// ---- Skip-and-collect reader contract (issue #44 / DECISIONS D25) ----

async function scratchTable(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "table-parse-test-"));
  const target = join(dir, "t.table");
  await mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(target, name), content);
  }
  return target;
}

const MINIMAL_SCHEMA = JSON.stringify({
  fields: [{ name: "title", type: "string" }],
});

test("malformed NDJSON line is skipped and reported; good rows survive", async () => {
  const target = await scratchTable({
    "schema.json": MINIMAL_SCHEMA,
    "rows.ndjson":
      '{"id":"r1","title":"one"}\n' +
      "{this is not json}\n" +
      '{"id":"r3","title":"three"}\n',
  });
  try {
    const t = await parseTable(target);
    assert.deepEqual(t.rows.map((r) => r.id), ["r1", "r3"]);
    assert.equal(t.diagnostics?.length, 1);
    assert.equal(t.diagnostics![0]!.rowIndex, 1); // zero-based line number
    assert.match(t.diagnostics![0]!.message, /malformed line/);
  } finally {
    await rm(dirname(target), { recursive: true, force: true });
  }
});

test("git conflict markers degrade to reported skips, not total loss", async () => {
  const target = await scratchTable({
    "schema.json": MINIMAL_SCHEMA,
    "rows.ndjson":
      "<<<<<<< HEAD\n" +
      '{"id":"r1","title":"ours"}\n' +
      "=======\n" +
      '{"id":"r1","title":"theirs"}\n' +
      ">>>>>>> feature\n",
  });
  try {
    const t = await parseTable(target);
    // Both row variants parse (duplicate-id detection is validate()'s
    // job); the three marker lines are reported skips.
    assert.equal(t.rows.length, 2);
    assert.equal(t.diagnostics?.length, 3);
  } finally {
    await rm(dirname(target), { recursive: true, force: true });
  }
});

test("row missing system id is skipped and reported", async () => {
  const target = await scratchTable({
    "schema.json": MINIMAL_SCHEMA,
    "rows.ndjson": '{"title":"no id"}\n{"id":"r2","title":"ok"}\n',
  });
  try {
    const t = await parseTable(target);
    assert.deepEqual(t.rows.map((r) => r.id), ["r2"]);
    assert.equal(t.diagnostics?.length, 1);
    assert.match(t.diagnostics![0]!.message, /missing system id/);
  } finally {
    await rm(dirname(target), { recursive: true, force: true });
  }
});

test("malformed optional views.json degrades to defaults with a diagnostic", async () => {
  const target = await scratchTable({
    "schema.json": MINIMAL_SCHEMA,
    "rows.ndjson": '{"id":"r1","title":"one"}\n',
    "views.json": "[{not json",
  });
  try {
    const t = await parseTable(target);
    assert.deepEqual(t.views, []);
    assert.equal(t.rows.length, 1);
    assert.equal(t.diagnostics?.length, 1);
    assert.equal(t.diagnostics![0]!.rowIndex, -1); // file-level
    assert.match(t.diagnostics![0]!.message, /views\.json/);
  } finally {
    await rm(dirname(target), { recursive: true, force: true });
  }
});

test("clean parse carries no diagnostics field", async () => {
  const t = await parseTable(resolve(fixturesDir, "projects.table"));
  assert.equal(t.diagnostics, undefined);
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
