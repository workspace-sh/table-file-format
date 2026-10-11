import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyView, parseRowsText } from "@workspace.sh/table-core";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { readBundle, writeBundleTo } from "@workspace.sh/table-core/io";
import {
  addIndexedRow,
  buildIndexFromBytes,
  canBeIndexed,
  firstRowsInBytes,
  indexedViewRows,
  linesInBytes,
  makeIndexEdits,
  removeIndexedRow,
  rowsInChunks,
  setIndexedBody,
  setIndexedCell,
  type IndexEdit,
} from "./indexed.ts";
import { bundleToArchive, openArchive } from "./tableFiles.ts";
import { isIndexStale, queryIndex } from "@workspace.sh/table-core";
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

    assert.deepEqual(await setIndexedCell(host, "tasks", held, "t1", "title", "Edited in the index"), { value: memory.rows.find((r) => r.id === "t1")!.title });
    assert.equal(await setIndexedCell(host, "tasks", held, "nobody", "title", "x"), null);
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

test("each edit made in the index says what undoes it, and those put the table back as it was", async () => {
  const s = scratch();
  try {
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    const all = async () => {
      const rows = await indexedViewRows(host, "tasks", held, { ...held.views[0]!, filter: undefined, sort: undefined, group: undefined }, "");
      return rows.rows(0, rows.count);
    };
    const found = async (text: string) => {
      const rows = await indexedViewRows(host, "tasks", held, held.views[0]!, text);
      return rows.ids(0, rows.count);
    };
    const before = await all();
    const second = before[1]!.id;
    await setIndexedBody(host, "tasks", held, second, "A page with a needle in it");
    const edits: IndexEdit[] = [
      { kind: "cell", rowId: "t1", field: "title", value: "Edited in the index" },
      { kind: "cell", rowId: "t1", field: "priority", value: undefined },
      { kind: "add", rowId: "t-new" },
      { kind: "cell", rowId: "t-new", field: "title", value: "New" },
      { kind: "remove", rowId: second },
      { kind: "cell", rowId: "nobody", field: "title", value: "x" },
      { kind: "remove", rowId: "nobody" },
    ];
    const made = await makeIndexEdits(host, "tasks", held, edits);
    assert.equal(made.count, before.length);
    assert.deepEqual(made.back.map((b) => b?.kind ?? null), ["cell", "cell", "remove", "cell", "restore", null, null]);
    assert.deepEqual(await found("needle"), []);
    assert.notDeepEqual(await all(), before);

    // Newest first, as undo takes them; the page of the row removed is the state's to give back.
    const back = made.back
      .filter((b) => b !== null)
      .reverse()
      .map((b) => (b.kind === "restore" ? { ...b, content: "A page with a needle in it" } : b));
    const undone = await makeIndexEdits(host, "tasks", held, back);
    assert.equal(undone.count, before.length);
    assert.deepEqual(await all(), before);
    assert.deepEqual(await found("needle"), [second]);
    // And what undoes those makes the edits again.
    const again = await makeIndexEdits(host, "tasks", held, undone.back.filter((b) => b !== null).reverse());
    assert.equal((await all()).find((r) => r.id === "t1")!.title, "Edited in the index");
    assert.equal((await all()).some((r) => r.id === second), false);
    assert.equal(again.count, before.length);
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

test("a save takes turns, and an edit made while it writes stops it: the file stays as it was until a save no edit comes into", async () => {
  const s = scratch();
  try {
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    const facts = { schema: held.schema };
    const before = rowsOnDisk(s.tasks);
    // Turns as a worker gives them, one after another, and a few rows a piece so a save takes several.
    let last: Promise<unknown> = Promise.resolve();
    let turns = 0;
    const host = openIndexHost(s.bundle, {
      saveBatch: 2,
      turn: (run) => {
        turns++;
        const turn = last.then(run);
        last = turn.catch(() => {});
        return turn;
      },
    });
    await host.ensure("tasks", s.tasks);
    const stale = async () => (await isIndexStale(host, "tasks", await tableContentKey(s.tasks)));
    const edit = (rowId: string, value: string) => host.rows({ ask: "edits", name: "tasks", table: facts, edits: [{ kind: "cell", rowId, field: "title", value }] });

    await edit("t1", "First");
    turns = 0;
    const stopped = host.save("tasks", s.tasks, true);
    // While it's on its first rows, another edit.
    await edit("t2", "Second");
    assert.equal(await stopped, false);
    assert.deepEqual(rowsOnDisk(s.tasks), before, "the file is as it was");
    assert.equal(existsSync(join(s.tasks, "rows.ndjson.tmp")), false);
    assert.equal(await stale(), true, "and the index isn't said to be fresh for it");

    // Asked again with nothing coming into it: both edits are written, a piece a turn.
    turns = 0;
    assert.equal(await host.save("tasks", s.tasks, true), true);
    assert.ok(turns >= before.length / 2, `${turns} turns`);
    assert.deepEqual(
      rowsOnDisk(s.tasks).map((r) => r.title),
      before.map((r) => (r.id === "t1" ? "First" : r.id === "t2" ? "Second" : r.title)),
    );
    assert.equal(await stale(), false);

    // The save a build is about to read isn't stopped: it has what the index had when it began or since, and is stamped.
    await edit("t1", "Third");
    const whole = host.save("tasks", s.tasks, true, undefined, true);
    await edit("t2", "Fourth");
    assert.equal(await whole, true);
    assert.equal(rowsOnDisk(s.tasks).find((r) => r.id === "t1")!.title, "Third");
    await host.close();
  } finally {
    s.done();
  }
});

test("a save that only stamps (pages changed, not rows) leaves the index unstamped when an edit came into it", async () => {
  const s = scratch();
  try {
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    const saving = host.save("tasks", s.tasks, false);
    await host.rows({ ask: "edits", name: "tasks", table: { schema: held.schema }, edits: [{ kind: "cell", rowId: "t1", field: "title", value: "Edited" }] });
    assert.equal(await saving, false);
    assert.equal(await isIndexStale(host, "tasks", await tableContentKey(s.tasks)), true);
    await host.close();
  } finally {
    s.done();
  }
});

test("a save can leave out a field the table no longer has, and a build makes the index again", async () => {
  const s = scratch();
  try {
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    await host.save("tasks", s.tasks, true, ["assignee"]);
    const after = rowsOnDisk(s.tasks);
    assert.equal(after.length, 8);
    assert.ok(after.every((r) => !("assignee" in r) && typeof r.title === "string"));
    let progressed = false;
    assert.equal(await host.build("tasks", s.tasks, () => (progressed = true)), 8);
    assert.equal(progressed, true);
    await host.close();
  } finally {
    s.done();
  }
});

test("an archive's large table is handed over as bytes, unparsed, and indexed from them", async () => {
  const s = scratch();
  try {
    const whole = await readBundle(nodeFs, s.bundle);
    const zip = await bundleToArchive("projects", whole);
    const taken: Record<string, Uint8Array> = {};
    const opened = await openArchive(zip, [], {
      rowsElsewhere: (name, _table, rows) => {
        if (name !== "tasks") return false;
        taken[name] = rows;
        return true;
      },
    });
    assert.deepEqual(opened.bundle.tables.tasks!.rows, []);
    assert.ok(opened.bundle.tables.tasks!.indexed);
    assert.equal(opened.bundle.tables.projects!.rows.length, whole.tables.projects!.rows.length);
    const bytes = taken.tasks!;
    assert.equal(linesInBytes(bytes), 8);
    assert.deepEqual(firstRowsInBytes(bytes, 3), whole.tables.tasks!.rows.slice(0, 3));
    // Lines that aren't rows are skipped, as the reader skips them.
    const messy = new TextEncoder().encode('{"id":"a","title":"ünï"}\n\nnot json\n{"title":"no id"}\r\n{"id":"b"}');
    assert.deepEqual(firstRowsInBytes(messy, 10), [{ id: "a", title: "ünï" }, { id: "b" }]);

    const host = openIndexHost(s.bundle);
    const progress: [number, number][] = [];
    assert.equal(await buildIndexFromBytes(host, { name: "tasks", schema: whole.tables.tasks!.schema, rows: bytes, key: "k", onProgress: (d, t) => progress.push([d, t]) }), 8);
    assert.deepEqual(progress.at(-1), [8, 8]);
    const all = await queryIndex(host, { name: "tasks", schema: whole.tables.tasks!.schema });
    assert.deepEqual(await all!.rows(0, 8), JSON.parse(JSON.stringify(whole.tables.tasks!.rows)));
    await host.close();
  } finally {
    s.done();
  }
});

test("a large table in an archive is handed over compressed: its start at once, the rest a piece at a time", async () => {
  const s = scratch();
  try {
    const whole = await readBundle(nodeFs, s.bundle);
    // Rows enough that the file is inflated in several pieces, with lines split across them.
    let seed = 9;
    const noise = () => Array.from({ length: 6 }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff)).toString(36)).join("");
    const many = Array.from({ length: 30_000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ünï ${noise()}`, priority: i % 7 }));
    whole.tables.tasks!.rows = many;
    const zip = await bundleToArchive("projects", whole);
    let entry: import("@workspace.sh/table-core").LazyZipEntry | undefined;
    const opened = await openArchive(zip, [], {
      lazyFrom: 1000,
      rowsLazily: (name, _table, rows) => {
        if (name !== "tasks") return false;
        entry = rows;
        return true;
      },
    });
    assert.deepEqual(opened.bundle.tables.tasks!.rows, []);
    assert.ok(opened.bundle.tables.tasks!.indexed);
    // The small table beside it was offered too, declined, and read as usual.
    assert.equal(opened.bundle.tables.projects!.rows.length, whole.tables.projects!.rows.length);
    // The start, without the rest.
    assert.deepEqual(firstRowsInBytes(entry!.head(4096), 5), many.slice(0, 5));
    // All of it, in pieces.
    let pieces = 0;
    const counted = (function* () {
      for (const chunk of entry!.chunks()) {
        pieces++;
        yield chunk;
      }
    })();
    assert.deepEqual([...rowsInChunks(counted)], many);
    assert.ok(pieces >= 1);
    // However the pieces fall, a line split across two (or a character split across two) is one row.
    const bytes = new TextEncoder().encode(many.slice(0, 300).map((r) => JSON.stringify(r)).join("\n") + "\n\n");
    for (const size of [1, 7, 64, 1000]) {
      const cut = (function* () {
        for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
      })();
      assert.deepEqual([...rowsInChunks(cut)], many.slice(0, 300), `pieces of ${size}`);
    }

    const host = openIndexHost(s.bundle);
    const kept: Uint8Array[] = [];
    const progress: [number, number][] = [];
    const count = await buildIndexFromBytes(host, {
      name: "tasks",
      schema: whole.tables.tasks!.schema,
      rows: { chunks: entry!.chunks(), size: entry!.size, keep: (c) => kept.push(c.slice()) },
      key: "k",
      onProgress: (d, t) => progress.push([d, t]),
    });
    assert.equal(count, many.length);
    assert.deepEqual(progress.at(-1), [many.length, many.length]);
    // On the way, the total is an estimate near the truth.
    const midway = progress[Math.floor(progress.length / 2)]!;
    assert.ok(Math.abs(midway[1] - many.length) < many.length * 0.2, `estimated ${midway[1]}`);
    assert.equal(kept.reduce((a, c) => a + c.length, 0), entry!.size);
    const all = await queryIndex(host, { name: "tasks", schema: whole.tables.tasks!.schema });
    assert.equal(all!.count, many.length);
    assert.deepEqual(await all!.rows(29_990, 30_000), many.slice(29_990));
    await host.close();

    // A damaged archive is caught at the end of the reading.
    const bad = zip.slice();
    const at = bad.length >> 1;
    bad[at] = bad[at]! ^ 0xff;
    let caught = "";
    try {
      const again = await openArchive(bad, [], { lazyFrom: 1000, rowsLazily: (name, _t, rows) => name === "tasks" && (entry = rows, true) });
      void again;
      for (const _ of entry!.chunks()) void _;
    } catch (error) {
      caught = String(error);
    }
    assert.match(caught, /corrupt|invalid|unexpected/i);
  } finally {
    s.done();
  }
});
