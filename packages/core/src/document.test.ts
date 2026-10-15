import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { filesOfFolder, readTableDocument, tableFormOf, writeTableFileTo } from "./document.js";
import { memoryFs, writeBundleTo } from "./io.js";
import { nodeFs } from "./node-fs.js";
import { readZip } from "./zip.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "table-document-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a .table is read in whichever form is on disk, and saved in it: a folder saved as a single file is the same document (D49, D50)", async () => {
  const s = scratch();
  try {
    const folder = join(s.dir, "crm.table");
    cpSync(join(fixtures, "crm.table"), folder, { recursive: true });
    // What only a single file carries as it is: an attachment, a history, a file no reader knows.
    mkdirSync(join(folder, "attachments"), { recursive: true });
    writeFileSync(join(folder, "attachments", "logo.png"), new Uint8Array([137, 80, 78, 71, 0, 255]));
    writeFileSync(join(folder, "tables", "deals", "history.ndjson"), '{"op":"set"}\n');
    writeFileSync(join(folder, "notes.txt"), "kept\n");
    writeFileSync(join(folder, "index.sqlite"), "never carried");

    assert.equal(await tableFormOf(nodeFs, folder), "folder");
    const read = await readTableDocument(nodeFs, folder);
    assert.equal(read.form, "folder");
    const files = await filesOfFolder(nodeFs, folder);
    // Ours, and the example's own attachments (its companies' logos), but not its text or its index.
    assert.deepEqual(
      Object.keys(files).filter((p) => !p.startsWith("tables/companies/attachments/")).sort(),
      ["attachments/logo.png", "notes.txt", "tables/deals/history.ndjson"],
    );
    assert.equal(Object.keys(files).filter((p) => p.startsWith("tables/companies/attachments/")).length, 6);

    // Saved as a single file beside it, under its own name.
    const single = join(s.dir, "single", "crm.table");
    mkdirSync(dirname(single));
    await writeTableFileTo(nodeFs, single, { ...read.bundle, files });
    assert.equal(await tableFormOf(nodeFs, single), "file");
    assert.equal(existsSync(`${single}.tmp`), false, "nothing staged is left");
    const names = readZip(new Uint8Array(readFileSync(single))).map((e) => e.name);
    assert.ok(names.every((n) => n.startsWith("crm.table/")));
    assert.ok(names.includes("crm.table/attachments/logo.png") && names.includes("crm.table/notes.txt") && names.includes("crm.table/tables/deals/history.ndjson"));
    assert.ok(!names.some((n) => n.includes("index.sqlite")), "the index is never carried");

    // Read back: the same tables, and the same files, byte for byte.
    const back = await readTableDocument(nodeFs, single);
    assert.equal(back.form, "file");
    assert.deepEqual(Object.keys(back.bundle.tables).sort(), Object.keys(read.bundle.tables).sort());
    for (const [name, table] of Object.entries(read.bundle.tables)) {
      assert.deepEqual(back.bundle.tables[name]!.rows, table.rows, name);
      assert.deepEqual(back.bundle.tables[name]!.schema, table.schema, name);
    }
    assert.deepEqual(back.bundle.tables.deals!.history, '{"op":"set"}\n');
    assert.deepEqual([...back.bundle.files!["attachments/logo.png"]!], [137, 80, 78, 71, 0, 255]);
    assert.equal(new TextDecoder().decode(back.bundle.files!["notes.txt"]), "kept\n");

    // Edited and saved again in its own form: everything it carried, it still does.
    const edited = { ...back.bundle, tables: { ...back.bundle.tables, deals: { ...back.bundle.tables.deals!, rows: back.bundle.tables.deals!.rows.slice(1) } } };
    await writeTableFileTo(nodeFs, single, edited);
    const again = await readTableDocument(nodeFs, single);
    assert.equal(again.bundle.tables.deals!.rows.length, read.bundle.tables.deals!.rows.length - 1);
    assert.deepEqual([...again.bundle.files!["attachments/logo.png"]!], [137, 80, 78, 71, 0, 255]);
    assert.equal(again.bundle.tables.deals!.history, '{"op":"set"}\n');
    assert.deepEqual(readdirSync(dirname(single)), ["crm.table"]);
  } finally {
    s.done();
  }
});

test("the form is what's on disk, whatever the name; nothing there is null", async () => {
  const fs = memoryFs();
  await writeBundleTo(fs, "/docs/a.table", { tables: { t: { schema: { fields: [] }, rows: [] } } });
  assert.equal(await tableFormOf(fs, "/docs/a.table"), "folder");
  await fs.mkdir("/docs/b");
  await writeTableFileTo(fs, "/docs/b/a.table", (await readTableDocument(fs, "/docs/a.table")).bundle);
  assert.equal(await tableFormOf(fs, "/docs/b/a.table"), "file");
  assert.equal(await tableFormOf(fs, "/docs/missing.table"), null);
  await assert.rejects(writeTableFileTo(fs, "/docs/b/a.zip", { tables: {} }), /ends \.table/);
});

test("a single-file save is written beside the document and renamed over it", async () => {
  const fs = memoryFs();
  await fs.mkdir("/docs");
  const written: string[] = [];
  const watched = { ...fs, writeBytes: (p: string, b: Uint8Array) => (written.push(p), fs.writeBytes(p, b)) };
  const before = fs.renames;
  await writeTableFileTo(watched, "/docs/a.table", { tables: { t: { schema: { fields: [] }, rows: [] } } });
  assert.deepEqual(written, ["/docs/a.table.tmp"]);
  assert.equal(fs.renames, before + 1);
  assert.equal(fs.bytes.has("/docs/a.table.tmp"), false);
  assert.equal(await tableFormOf(fs, "/docs/a.table"), "file");
});
