// Every fixture under fixtures/ is a table any reader should open cleanly.
// Found by globbing, so a new fixture is checked the moment it's added.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { parseTable } from "./parser.js";
import { validate, validateBodies } from "./validator.js";
import { readTableArchive, writeTableArchive } from "./archive.js";
import type { ParsedTable } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "..", "..", "fixtures");

async function loadAll(): Promise<Record<string, ParsedTable>> {
  const names = (await readdir(fixturesDir)).filter((n) => n.endsWith(".table")).sort();
  const tables: Record<string, ParsedTable> = {};
  // Keyed as a relation names a table: the directory's name without .table.
  for (const name of names) tables[name.slice(0, -".table".length)] = await parseTable(resolve(fixturesDir, name));
  return tables;
}

test("there are fixtures to check", async () => {
  assert.ok(Object.keys(await loadAll()).length >= 2);
});

test("every fixture reads without skipping anything (D25)", async () => {
  for (const [name, t] of Object.entries(await loadAll())) {
    assert.deepEqual(t.diagnostics ?? [], [], name);
  }
});

test("every fixture's rows fit its schema, and its bodies belong to rows", async () => {
  for (const [name, t] of Object.entries(await loadAll())) {
    assert.deepEqual(validate(t.schema, t.rows), [], name);
    assert.deepEqual(validateBodies(t.rows, t.bodies), [], name);
  }
});

test("every fixture's views name fields that exist", async () => {
  for (const [name, t] of Object.entries(await loadAll())) {
    const fields = new Set(t.schema.fields.map((f) => f.name));
    for (const v of t.views) {
      const named = [
        ...(v.fields ?? []),
        ...(v.filter ?? []).map((f) => f.field),
        ...(v.sort ?? []).map((s) => s.field),
        ...(v.group ? [v.group.field] : []),
        ...[v.board_field, v.gallery_field, v.calendar_field].filter((f): f is string => typeof f === "string"),
      ];
      for (const f of named) assert.ok(fields.has(f), `${name} view "${v.name}" names missing field ${f}`);
    }
  }
});

test("every relation in every fixture points at a row that exists", async () => {
  const tables = await loadAll();
  for (const [name, t] of Object.entries(tables)) {
    for (const field of t.schema.fields) {
      if (!field.relation) continue;
      const target = tables[field.relation.table];
      assert.ok(target, `${name}.${field.name} points at a table that isn't a fixture: ${field.relation.table}`);
      const ids = new Set(target.rows.map((r) => r.id));
      for (const row of t.rows) {
        const value = row[field.name];
        const targets = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
        for (const id of targets) assert.ok(ids.has(String(id)), `${name} row ${row.id}: ${field.name} → ${String(id)} is dangling`);
      }
    }
  }
});

test("every fixture round-trips through a .table archive", async () => {
  for (const [name, t] of Object.entries(await loadAll())) {
    const back = await readTableArchive(await writeTableArchive(name, t));
    assert.deepEqual(back.schema, t.schema, name);
    assert.deepEqual(back.rows, t.rows, name);
    assert.deepEqual(back.views, t.views, name);
    assert.deepEqual(back.meta, t.meta, name);
    assert.deepEqual(back.bodies ?? {}, t.bodies ?? {}, name);
  }
});
