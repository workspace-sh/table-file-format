import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryFs, writeBundleTo } from "@workspace.sh/table-core/io";
import { readTableDocument, writeTableFileTo } from "@workspace.sh/table-core";
import { tables } from "@workspace.sh/table-fixtures";

import { ChangedElsewhere, copyPathFor, keepEditsAsCopy, packTableFile, restampTableFile, takeFileAsItIs, unpackTableFile, workDirFor } from "./singleFile.ts";

const fs = () => {
  const m = memoryFs();
  return m;
};

test("a single-file .table is edited in a working folder and packed back into it, everything carried (D49, D50)", async () => {
  const m = fs();
  // A single file with an attachment and a history, as someone sent it.
  await writeBundleTo(m, "/made/crm.table", { tables: { tasks: tables["tasks"]! } });
  await m.writeBytes!("/made/crm.table/tables/tasks/history.ndjson", new TextEncoder().encode('{"op":"set"}\n'));
  await m.mkdir("/made/crm.table/attachments");
  await m.writeBytes!("/made/crm.table/attachments/logo.png", new Uint8Array([1, 2, 3]));
  const made = await readTableDocument(m, "/made/crm.table");
  await m.mkdir("/docs");
  const { filesOfFolder } = await import("@workspace.sh/table-core");
  await writeTableFileTo(m, "/docs/crm.table", { ...made.bundle, files: await filesOfFolder(m, "/made/crm.table") });

  // Opened: unpacked into the app's own storage, as a folder.
  const work = workDirFor("/app/files", "/docs/crm.table");
  assert.match(work, /^\/app\/files\/[0-9a-f]{8}\/crm\.table$/);
  assert.notEqual(work, workDirFor("/app/files", "/elsewhere/crm.table"), "files of one name in different places don't share a folder");
  await unpackTableFile(m, (await m.readBytes!("/docs/crm.table"))!, work, "v1");
  const folder = await readTableDocument(m, work);
  assert.equal(folder.form, "folder");
  assert.deepEqual(folder.bundle.tables.tasks!.rows, made.bundle.tables.tasks!.rows);
  assert.deepEqual([...(await m.readBytes!(`${work}/attachments/logo.png`))!], [1, 2, 3]);
  assert.equal(await m.readText(`${work}/tables/tasks/history.ndjson`), '{"op":"set"}\n');

  // Edited as a folder (and the index host's .gitignore beside its index), then packed back.
  const edited = { ...folder.bundle.tables.tasks!, rows: folder.bundle.tables.tasks!.rows.slice(1) };
  await writeBundleTo(m, work, { meta: folder.bundle.meta, tables: { tasks: edited } });
  await m.writeText(`${work}/.gitignore`, "index.sqlite*\n");
  await m.writeText(`${work}/index.sqlite`, "an index");
  await packTableFile(m, work, "/docs/crm.table");
  const back = await readTableDocument(m, "/docs/crm.table");
  assert.equal(back.form, "file");
  assert.equal(back.bundle.tables.tasks!.rows.length, made.bundle.tables.tasks!.rows.length - 1);
  assert.equal(back.bundle.tables.tasks!.history, '{"op":"set"}\n');
  assert.deepEqual([...back.bundle.files!["attachments/logo.png"]!], [1, 2, 3]);
  assert.deepEqual(Object.keys(back.bundle.files!), ["attachments/logo.png"], "not the index, nor the index's .gitignore");

  // Opened again from the same file: the working folder (its index with it) is kept; from a changed one, made again.
  await restampTableFile(m, work, "v2");
  await unpackTableFile(m, (await m.readBytes!("/docs/crm.table"))!, work, "v2");
  assert.equal(await m.readText(`${work}/index.sqlite`), "an index");
  await unpackTableFile(m, (await m.readBytes!("/docs/crm.table"))!, work, "v3");
  assert.equal(await m.readText(`${work}/index.sqlite`), null);
});

test("a file changed elsewhere since it was opened isn't saved over: the edits stay in the working folder", async () => {
  const m = fs();
  await m.mkdir("/docs");
  const original = { tables: { tasks: tables["tasks"]! } };
  await writeTableFileTo(m, "/docs/t.table", original);
  const work = workDirFor("/app", "/docs/t.table");
  await unpackTableFile(m, (await m.readBytes!("/docs/t.table"))!, work, "opened");

  // Meanwhile another copy of the app, or a sync, writes a newer file.
  const newer = { tables: { tasks: { ...tables["tasks"]!, rows: tables["tasks"]!.rows.slice(0, 1) } } };
  await writeTableFileTo(m, "/docs/t.table", newer);
  const theirs = await m.readBytes!("/docs/t.table");

  // An edit here is written to the working folder, then packed: refused, the newer file left as it is.
  await writeBundleTo(m, work, { tables: { tasks: { ...tables["tasks"]!, rows: tables["tasks"]!.rows.slice(1) } } });
  await assert.rejects(packTableFile(m, work, "/docs/t.table", "changed"), (e: unknown) => e instanceof ChangedElsewhere && /t\.table was changed somewhere else/.test(e.message));
  assert.deepEqual(await m.readBytes!("/docs/t.table"), theirs);
  assert.equal((await readTableDocument(m, work)).bundle.tables.tasks!.rows.length, tables["tasks"]!.rows.length - 1, "the edit is kept");

  // As it was opened, it packs.
  await packTableFile(m, work, "/docs/t.table", "opened");
  assert.notDeepEqual(await m.readBytes!("/docs/t.table"), theirs);
});

test("after a file changed elsewhere, the edits are kept as a copy beside it, or let go", async () => {
  const m = fs();
  await m.mkdir("/docs");
  await writeTableFileTo(m, "/docs/t.table", { tables: { tasks: tables["tasks"]! } });
  const work = workDirFor("/app", "/docs/t.table");
  await unpackTableFile(m, (await m.readBytes!("/docs/t.table"))!, work, "opened");
  const newer = { tables: { tasks: { ...tables["tasks"]!, rows: tables["tasks"]!.rows.slice(0, 1) } } };
  await writeTableFileTo(m, "/docs/t.table", newer);
  const theirs = await m.readBytes!("/docs/t.table");
  const mine = tables["tasks"]!.rows.slice(1);
  await writeBundleTo(m, work, { tables: { tasks: { ...tables["tasks"]!, rows: mine } } });

  // Kept: a new file beside it holds the edits; the file is as it was changed; the working folder is let go.
  const copy = await keepEditsAsCopy(m, work, "/docs/t.table");
  assert.equal(copy, "/docs/t (edited here).table");
  assert.deepEqual((await readTableDocument(m, copy)).bundle.tables.tasks!.rows, mine);
  assert.deepEqual(await m.readBytes!("/docs/t.table"), theirs);
  assert.equal(await m.list(work), null);
  // Opened again, it's the file as it now is.
  await unpackTableFile(m, theirs!, work, "changed");
  assert.equal((await readTableDocument(m, work)).bundle.tables.tasks!.rows.length, 1);

  // A second copy is numbered; letting the edits go leaves the file and no working folder.
  assert.equal(await copyPathFor(m, "/docs/t.table"), "/docs/t (edited here 2).table");
  await takeFileAsItIs(m, work);
  assert.equal(await m.list(work), null);
  assert.deepEqual(await m.readBytes!("/docs/t.table"), theirs);
});
