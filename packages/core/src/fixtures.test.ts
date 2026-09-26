// Every fixture under fixtures/ is a bundle any reader should open cleanly,
// and every table in it too (D37). Found by globbing, so a new fixture is
// checked the moment it's added.

import { test } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { validate, validateBodies } from "./validator.js";
import { readTableArchive, writeTableArchive } from "./archive.js";
import { tableOrder } from "./bundle.js";
import { fixtureBundles, fixturesDir } from "./test-fixtures.js";
import type { ParsedTable } from "./types.js";

/** Every table in every bundle, named `bundle/table`. */
async function allTables(): Promise<Array<[string, ParsedTable]>> {
  const out: Array<[string, ParsedTable]> = [];
  for (const [bundle, b] of Object.entries(await fixtureBundles())) {
    for (const name of tableOrder(b)) out.push([`${bundle}/${name}`, b.tables[name]!]);
  }
  return out;
}

test("there are fixtures to check, and at least one holds several tables", async () => {
  const bundles = await fixtureBundles();
  assert.ok(Object.keys(bundles).length >= 2);
  assert.ok(Object.values(bundles).some((b) => Object.keys(b.tables).length > 1));
});

test("every bundle's manifest lists exactly its tables", async () => {
  for (const [name, b] of Object.entries(await fixtureBundles())) {
    assert.equal(b.meta.format, "table", name);
    assert.equal(b.meta.formatVersion, 1, name);
    assert.deepEqual([...(b.meta.tables ?? [])].sort(), Object.keys(b.tables).sort(), name);
  }
});

test("every fixture reads without skipping anything (D25)", async () => {
  for (const [name, b] of Object.entries(await fixtureBundles())) assert.deepEqual(b.diagnostics ?? [], [], name);
  for (const [name, t] of await allTables()) assert.deepEqual(t.diagnostics ?? [], [], name);
});

test("every fixture's rows fit its schema, and its bodies belong to rows", async () => {
  for (const [name, t] of await allTables()) {
    assert.deepEqual(validate(t.schema, t.rows), [], name);
    assert.deepEqual(validateBodies(t.rows, t.bodies), [], name);
  }
});

test("every fixture's views name fields that exist", async () => {
  for (const [name, t] of await allTables()) {
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

test("every relation points at a row that exists, in the same bundle (D37)", async () => {
  for (const [bundle, b] of Object.entries(await fixtureBundles())) {
    for (const [name, t] of Object.entries(b.tables)) {
      for (const field of t.schema.fields) {
        if (!field.relation) continue;
        const target = b.tables[field.relation.table];
        assert.ok(target, `${bundle}/${name}.${field.name} points at a table not in its bundle: ${field.relation.table}`);
        const ids = new Set(target.rows.map((r) => r.id));
        for (const row of t.rows) {
          const value = row[field.name];
          const targets = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
          for (const id of targets) assert.ok(ids.has(String(id)), `${bundle}/${name} row ${row.id}: ${field.name} → ${String(id)} is dangling`);
        }
      }
    }
  }
});

test("every attachment a fixture names is in its table's attachments/ folder", async () => {
  for (const [bundle, b] of Object.entries(await fixtureBundles())) {
    for (const [name, t] of Object.entries(b.tables)) {
      for (const field of t.schema.fields.filter((f) => f.attachment)) {
        for (const row of t.rows) {
          const file = row[field.name];
          if (typeof file !== "string" || file === "") continue;
          await access(resolve(fixturesDir, `${bundle}.table`, "tables", name, "attachments", file)).catch(() =>
            assert.fail(`${bundle}/${name} row ${row.id}: ${field.name} names ${file}, which isn't in attachments/`),
          );
        }
      }
    }
  }
});

test("every fixture round-trips through a .table archive, whole", async () => {
  for (const [bundle, b] of Object.entries(await fixtureBundles())) {
    const back = await readTableArchive(await writeTableArchive(bundle, b));
    assert.deepEqual(tableOrder(back), tableOrder(b), bundle);
    assert.equal(back.meta.title, b.meta.title, bundle);
    for (const name of tableOrder(b)) {
      const t = b.tables[name]!;
      const r = back.tables[name]!;
      assert.deepEqual(r.schema, t.schema, `${bundle}/${name}`);
      assert.deepEqual(r.rows, t.rows, `${bundle}/${name}`);
      assert.deepEqual(r.views, t.views, `${bundle}/${name}`);
      assert.deepEqual(r.meta, t.meta, `${bundle}/${name}`);
      assert.deepEqual(r.bodies ?? {}, t.bodies ?? {}, `${bundle}/${name}`);
    }
  }
});
