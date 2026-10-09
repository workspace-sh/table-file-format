import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyView, parseRowsText } from "@workspace.sh/table-core";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { readBundle, writeBundleTo } from "@workspace.sh/table-core/io";
import { addIndexedRow, canBeIndexed, indexedViewRows, removeIndexedRow, setIndexedCell } from "./indexed.ts";
import { countRows, openIndexHost, tableContentKey } from "./nodeIndex.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

function scratch(): { bundle: string; tasks: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "table-node-index-"));
  const bundle = join(dir, "projects.table");
  cpSync(join(fixtures, "projects.table"), bundle, { recursive: true });
  return { bundle, tasks: join(bundle, "tables", "tasks"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const rowsOnDisk = (tableDir: string) => parseRowsText(readFileSync(join(tableDir, "rows.ndjson"), "utf8"), []);

test("a table read with its rows elsewhere has none, and writing it leaves rows.ndjson alone", async () => {
  const s = scratch();
  try {
    const before = readFileSync(join(s.tasks, "rows.ndjson"), "utf8");
    const bundle = await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks });
    assert.deepEqual(bundle.tables.tasks!.rows, []);
    assert.deepEqual(bundle.tables.tasks!.indexed, { count: 0, version: 0 });
    assert.ok(bundle.tables.projects!.rows.length > 0);
    assert.equal(bundle.tables.projects!.indexed, undefined);
    await writeBundleTo(nodeFs, s.bundle, bundle);
    assert.equal(readFileSync(join(s.tasks, "rows.ndjson"), "utf8"), before);
  } finally {
    s.done();
  }
});

test("the index is built from the files, reused while they're the same, and rebuilt when they change", async () => {
  const s = scratch();
  try {
    const host = openIndexHost(s.bundle);
    const progress: [number, number][] = [];
    assert.equal(await host.ensure("tasks", s.tasks, (done, total) => progress.push([done, total])), 8);
    assert.deepEqual(progress.at(-1), [8, 8]);
    assert.ok(existsSync(join(s.bundle, "index.sqlite")));
    assert.match(readFileSync(join(s.bundle, ".gitignore"), "utf8"), /^index\.sqlite\*$/m);
    // Fresh: nothing is built.
    let built = false;
    assert.equal(await host.ensure("tasks", s.tasks, () => (built = true)), 8);
    assert.equal(built, false);
    // Edited outside the app: stale, and built again.
    appendFileSync(join(s.tasks, "rows.ndjson"), `${JSON.stringify({ id: "t9", title: "Added by hand", priority: 9 })}\n\n`);
    assert.equal(await countRows(s.tasks), 9);
    assert.equal(await host.ensure("tasks", s.tasks, () => (built = true)), 9);
    assert.equal(built, true);
    await host.close();
  } finally {
    s.done();
  }
});

test("a view of an indexed table shows what the table in memory shows, and edits are saved to rows.ndjson", async () => {
  const s = scratch();
  try {
    const memory = (await readBundle(nodeFs, s.bundle)).tables.tasks!;
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    assert.equal(canBeIndexed(held), true);
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    const view = { ...memory.views[0]!, group: { field: "status" }, totals: { priority: "sum" as const } };
    const shown = await indexedViewRows(host, "tasks", held, view, "");
    const want = applyView(memory, view);
    assert.equal(shown.count, want.length);
    assert.deepEqual((await shown.totals()).priority, want.reduce((a, r) => a + (r.priority as number), 0));
    assert.deepEqual((await shown.groups()).map((g) => g.count).reduce((a, b) => a + b, 0), want.length);

    assert.equal(await setIndexedCell(host, "tasks", held, "t1", "title", "Edited in the index"), true);
    assert.equal(await setIndexedCell(host, "tasks", held, "nobody", "title", "x"), false);
    await addIndexedRow(host, "tasks", held, "t-new");
    await removeIndexedRow(host, "tasks", held, "t2");
    const after = await indexedViewRows(host, "tasks", held, memory.views[0]!, "");
    const ids = await after.ids(0, after.count);
    assert.equal(after.count, want.length);
    assert.ok(ids.includes("t-new") && !ids.includes("t2"));
    assert.equal((await after.row("t1"))?.title, "Edited in the index");
    // A search reaches the edit.
    assert.deepEqual(await (await indexedViewRows(host, "tasks", held, memory.views[0]!, "edited in the")).ids(0, 5), ["t1"]);
    await host.close();
  } finally {
    s.done();
  }
});

test("saving writes the rows in file order and leaves the index fresh", async () => {
  const s = scratch();
  try {
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    const before = rowsOnDisk(s.tasks);
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    await setIndexedCell(host, "tasks", held, "t1", "title", "Edited in the index");
    await addIndexedRow(host, "tasks", held, "t-new");
    await removeIndexedRow(host, "tasks", held, "t2");
    await host.save("tasks", s.tasks, true);
    const after = rowsOnDisk(s.tasks);
    assert.deepEqual(
      after,
      [...before.filter((r) => r.id !== "t2").map((r) => (r.id === "t1" ? { ...r, title: "Edited in the index" } : r)), { id: "t-new" }],
    );
    // Fresh for what was written: opening again builds nothing.
    let built = false;
    assert.equal(await host.ensure("tasks", s.tasks, () => (built = true)), after.length);
    assert.equal(built, false);
    assert.equal(await tableContentKey(s.tasks), await tableContentKey(s.tasks));
    await host.close();
  } finally {
    s.done();
  }
});
