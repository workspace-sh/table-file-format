import { test } from "node:test";
import assert from "node:assert/strict";
import { addressedField, derivedFieldId, withFieldIds } from "./fieldIds.js";
import { newFieldId } from "./id.js";
import { newBundle } from "./new-table.js";
import { readTableArchive, writeTableArchive } from "./archive.js";
import type { TableSchema } from "./types.js";
import { validate } from "./validator.js";

const Z = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{13}$/;

test("a field's id from its name is the same everywhere, and differs by name (D62)", () => {
  assert.match(derivedFieldId("price"), Z);
  assert.equal(derivedFieldId("price"), derivedFieldId("price"));
  assert.notEqual(derivedFieldId("price"), derivedFieldId("Price"));
  assert.notEqual(derivedFieldId("price"), derivedFieldId("price", 1));
  assert.match(newFieldId(), Z);
  assert.notEqual(newFieldId(), newFieldId());
});

test("every field gets an id: kept when it has one, from its name when it hasn't, and a repeated one replaced", () => {
  const schema: TableSchema = {
    fields: [
      { id: "kept", name: "a", type: "string" },
      { name: "b", type: "number" },
      { id: "kept", name: "c", type: "string" },
    ],
  };
  const out = withFieldIds(schema);
  assert.deepEqual(
    out.fields.map((f) => f.id),
    ["kept", derivedFieldId("b"), derivedFieldId("c")],
  );
  // The id leads the field's keys, as rows lead with theirs.
  assert.deepEqual(Object.keys(out.fields[1]!), ["id", "name", "type"]);
  // Nothing to add: the same schema back.
  assert.equal(withFieldIds(out), out);
});

test("an id a name derives that another field already holds is passed over", () => {
  const schema: TableSchema = { fields: [{ id: derivedFieldId("b"), name: "a", type: "string" }, { name: "b", type: "string" }] };
  const [a, b] = withFieldIds(schema).fields;
  assert.equal(a!.id, derivedFieldId("b"));
  assert.equal(b!.id, derivedFieldId("b", 1));
});

test("a table written without ids reads with them, and saving twice keeps the same ones", async () => {
  const bundle = newBundle("Books", "books.table", "books", new Date("2026-10-25T00:00:00Z"));
  const table = bundle.tables.books!;
  table.schema = { fields: [{ name: "title", type: "string" }, { name: "pages", type: "integer" }] };
  const once = await readTableArchive(await writeTableArchive("books", bundle));
  const ids = once.tables.books!.schema.fields.map((f) => f.id);
  assert.deepEqual(ids, [derivedFieldId("title"), derivedFieldId("pages")]);
  const twice = await readTableArchive(await writeTableArchive("books", once));
  assert.deepEqual(twice.tables.books!.schema.fields.map((f) => f.id), ids);
});

test("an address's field= names a field by its id, else by its name", () => {
  const schema: TableSchema = { fields: [{ id: "abc", name: "price", type: "number" }, { id: "price", name: "cost", type: "number" }] };
  assert.equal(addressedField(schema, "abc")?.name, "price");
  // An id wins over a name that happens to match it.
  assert.equal(addressedField(schema, "price")?.name, "cost");
  assert.equal(addressedField(schema, "cost")?.name, "cost");
  assert.equal(addressedField(schema, "nope"), undefined);
});

test("two fields with one id aren't valid", () => {
  const schema: TableSchema = { fields: [{ id: "same", name: "a", type: "string" }, { id: "same", name: "b", type: "string" }] };
  assert.deepEqual(
    validate(schema, []).map((e) => e.message),
    ["field b has the id same, which another field has"],
  );
  assert.deepEqual(validate(withFieldIds(schema), []), []);
});

test("a file another tool wrote without ids reads with them, folder or single file", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readBundle } = await import("./io.js");
  const { nodeFs } = await import("./node-fs.js");
  const { writeZip } = await import("./zip.js");
  const dir = mkdtempSync(join(tmpdir(), "field-ids-"));
  try {
    const schema = JSON.stringify({ fields: [{ name: "title", type: "string" }] });
    const row = '{"id":"r1","title":"One"}\n';
    mkdirSync(join(dir, "t.table", "tables", "t", "rows"), { recursive: true });
    writeFileSync(join(dir, "t.table", "tables", "t", "schema.json"), schema);
    writeFileSync(join(dir, "t.table", "tables", "t", "rows", "0001.ndjson"), row);
    const folder = await readBundle(nodeFs, join(dir, "t.table"));
    assert.equal(folder.tables.t!.schema.fields[0]!.id, derivedFieldId("title"));
    const zip = writeZip([
      { name: "t.table/tables/t/schema.json", data: new TextEncoder().encode(schema) },
      { name: "t.table/tables/t/rows/0001.ndjson", data: new TextEncoder().encode(row) },
    ]);
    const file = await readTableArchive(zip);
    assert.equal(file.tables.t!.schema.fields[0]!.id, derivedFieldId("title"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
