import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
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
  rowsInAsyncChunks,
  setIndexedBody,
  setIndexedCell,
  type IndexEdit,
} from "./indexed.ts";
import { strToU8, unzipSync, zipSync } from "fflate";
import { bundleToArchive, openArchive } from "./tableFiles.ts";
import { fieldChanges, isIndexStale, queryIndex, type TableSchema } from "@workspace.sh/table-core";
import { countRows, openIndexHost, saveTableRows, tableContentKey } from "./nodeIndex.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures");

function scratch(): { bundle: string; tasks: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "table-node-index-"));
  const bundle = join(dir, "projects.table");
  cpSync(join(fixtures, "projects.table"), bundle, { recursive: true });
  return { bundle, tasks: join(bundle, "tables", "tasks"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const rowsOnDisk = (tableDir: string) => parseRowsText(readFileSync(join(tableDir, "rows", "0001.ndjson"), "utf8"), []);

test("a table read with its rows elsewhere has none, and writing it leaves its rows files alone", async () => {
  const s = scratch();
  try {
    const before = readFileSync(join(s.tasks, "rows", "0001.ndjson"), "utf8");
    const bundle = await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks });
    assert.deepEqual(bundle.tables.tasks!.rows, []);
    assert.deepEqual(bundle.tables.tasks!.indexed, { count: 0, version: 0 });
    assert.ok(bundle.tables.projects!.rows.length > 0);
    assert.equal(bundle.tables.projects!.indexed, undefined);
    await writeBundleTo(nodeFs, s.bundle, bundle);
    assert.equal(readFileSync(join(s.tasks, "rows", "0001.ndjson"), "utf8"), before);
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
    appendFileSync(join(s.tasks, "rows", "0001.ndjson"), `${JSON.stringify({ id: "t9", title: "Added by hand", priority: 9 })}\n\n`);
    assert.equal(await countRows(s.tasks), 9);
    assert.equal(await host.ensure("tasks", s.tasks, () => (built = true)), 9);
    assert.equal(built, true);
    await host.close();
  } finally {
    s.done();
  }
});

test("a view of an indexed table shows what the table in memory shows, and edits are saved to its rows files", async () => {
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

    assert.deepEqual(await setIndexedCell(host, "tasks", held, "ytjc8tj8w8ftnbf9h86s5k9jfk", "title", "Edited in the index"), { value: memory.rows.find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")!.title });
    assert.equal(await setIndexedCell(host, "tasks", held, "nobody", "title", "x"), null);
    await addIndexedRow(host, "tasks", held, "t-new");
    await removeIndexedRow(host, "tasks", held, "wpzuom5b9k3k4g6co658ozwerw");
    const after = await indexedViewRows(host, "tasks", held, memory.views[0]!, "");
    const ids = await after.ids(0, after.count);
    assert.equal(after.count, want.length);
    assert.ok(ids.includes("t-new") && !ids.includes("wpzuom5b9k3k4g6co658ozwerw"));
    assert.equal((await after.row("ytjc8tj8w8ftnbf9h86s5k9jfk"))?.title, "Edited in the index");
    // A search reaches the edit.
    assert.deepEqual(await (await indexedViewRows(host, "tasks", held, memory.views[0]!, "edited in the")).ids(0, 5), ["ytjc8tj8w8ftnbf9h86s5k9jfk"]);
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
      { kind: "cell", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "title", value: "Edited in the index" },
      { kind: "cell", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "priority", value: undefined },
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
    assert.equal((await all()).find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")!.title, "Edited in the index");
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
    await setIndexedCell(host, "tasks", held, "ytjc8tj8w8ftnbf9h86s5k9jfk", "title", "Edited in the index");
    await addIndexedRow(host, "tasks", held, "t-new");
    await removeIndexedRow(host, "tasks", held, "wpzuom5b9k3k4g6co658ozwerw");
    await host.save("tasks", s.tasks, true);
    const after = rowsOnDisk(s.tasks);
    assert.deepEqual(
      after,
      [...before.filter((r) => r.id !== "wpzuom5b9k3k4g6co658ozwerw").map((r) => (r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk" ? { ...r, title: "Edited in the index" } : r)), { id: "t-new" }],
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

test("a save writes each row back to the rows file it came from, new rows to the last, and moves an old rows.ndjson into rows/ (D51)", async () => {
  const s = scratch();
  try {
    // tasks' rows across two files, as a writer splitting at the limit leaves them.
    const lines = readFileSync(join(s.tasks, "rows", "0001.ndjson"), "utf8").trimEnd().split("\n");
    writeFileSync(join(s.tasks, "rows", "0001.ndjson"), `${lines.slice(0, 3).join("\n")}\n`);
    writeFileSync(join(s.tasks, "rows", "0002.ndjson"), `${lines.slice(3).join("\n")}\n`);
    const ids = (name: string) => parseRowsText(readFileSync(join(s.tasks, "rows", name), "utf8"), []).map((r) => r.id);
    const first = ids("0001.ndjson");
    const second = ids("0002.ndjson");
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    const host = openIndexHost(s.bundle);
    assert.equal(await host.ensure("tasks", s.tasks), lines.length);
    await setIndexedCell(host, "tasks", held, first[0]!, "title", "Edited");
    await addIndexedRow(host, "tasks", held, "t-new");
    await host.save("tasks", s.tasks, true);
    assert.deepEqual(readdirSync(join(s.tasks, "rows")), ["0001.ndjson", "0002.ndjson"]);
    assert.deepEqual(ids("0001.ndjson"), first);
    assert.deepEqual(ids("0002.ndjson"), [...second, "t-new"]);

    // Every row of the first file gone: the file is too.
    for (const id of first) await removeIndexedRow(host, "tasks", held, id);
    await host.save("tasks", s.tasks, true);
    assert.deepEqual(readdirSync(join(s.tasks, "rows")), ["0002.ndjson"]);
    await host.close();
  } finally {
    s.done();
  }

  // formatVersion 1's one file: read, and written to rows/.
  const old = scratch();
  try {
    renameSync(join(old.tasks, "rows", "0001.ndjson"), join(old.tasks, "rows.ndjson"));
    rmSync(join(old.tasks, "rows"), { recursive: true });
    const before = parseRowsText(readFileSync(join(old.tasks, "rows.ndjson"), "utf8"), []);
    const host = openIndexHost(old.bundle);
    assert.equal(await host.ensure("tasks", old.tasks), before.length);
    await host.save("tasks", old.tasks, true);
    assert.equal(existsSync(join(old.tasks, "rows.ndjson")), false);
    assert.deepEqual(rowsOnDisk(old.tasks), before);
    await host.close();
  } finally {
    old.done();
  }
});

test("a save splits a rows file past the limit: by number at the end of the table, by letters in the middle (D51)", async () => {
  const s = scratch();
  try {
    const lines = readFileSync(join(s.tasks, "rows", "0001.ndjson"), "utf8").trimEnd().split("\n");
    mkdirSync(join(s.tasks, "rows"), { recursive: true });
    writeFileSync(join(s.tasks, "rows", "0001.ndjson"), `${lines.slice(0, 4).join("\n")}\n`);
    writeFileSync(join(s.tasks, "rows", "0002.ndjson"), `${lines.slice(4).join("\n")}\n`);
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    // A limit of one byte: every row past a file's first starts another.
    assert.equal(await saveTableRows(host, "tasks", s.tasks, [], { limit: 1 }), true);
    const names = readdirSync(join(s.tasks, "rows")).sort();
    assert.deepEqual(names.slice(0, 4), ["0001.ndjson", "0001m.ndjson", "0001t.ndjson", "0001w.ndjson"]);
    assert.deepEqual(names.slice(4, 6), ["0002.ndjson", "0003.ndjson"]);
    assert.equal(names.length, lines.length);
    // One row a file, all in order, and read back as the table was.
    const read = names.flatMap((n) => readFileSync(join(s.tasks, "rows", n), "utf8").trimEnd().split("\n"));
    assert.deepEqual(read, lines);
    // Saved again with the limit, nothing moves: each file is past it after its first row.
    assert.equal(await saveTableRows(host, "tasks", s.tasks, [], { limit: 1 }), true);
    assert.deepEqual(readdirSync(join(s.tasks, "rows")).sort(), names);
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

    await edit("ytjc8tj8w8ftnbf9h86s5k9jfk", "First");
    turns = 0;
    const stopped = host.save("tasks", s.tasks, true);
    // While it's on its first rows, another edit.
    await edit("wpzuom5b9k3k4g6co658ozwerw", "Second");
    assert.equal(await stopped, false);
    assert.deepEqual(rowsOnDisk(s.tasks), before, "the file is as it was");
    assert.equal(existsSync(join(s.tasks, "rows", "0001.ndjson.tmp")), false);
    assert.equal(await stale(), true, "and the index isn't said to be fresh for it");

    // Asked again with nothing coming into it: both edits are written, a piece a turn.
    turns = 0;
    assert.equal(await host.save("tasks", s.tasks, true), true);
    assert.ok(turns >= before.length / 2, `${turns} turns`);
    assert.deepEqual(
      rowsOnDisk(s.tasks).map((r) => r.title),
      before.map((r) => (r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk" ? "First" : r.id === "wpzuom5b9k3k4g6co658ozwerw" ? "Second" : r.title)),
    );
    assert.equal(await stale(), false);

    // The save a build is about to read isn't stopped: it has what the index had when it began or since, and is stamped.
    await edit("ytjc8tj8w8ftnbf9h86s5k9jfk", "Third");
    const whole = host.save("tasks", s.tasks, true, undefined, true);
    await edit("wpzuom5b9k3k4g6co658ozwerw", "Fourth");
    assert.equal(await whole, true);
    assert.equal(rowsOnDisk(s.tasks).find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")!.title, "Third");
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
    await host.rows({ ask: "edits", name: "tasks", table: { schema: held.schema }, edits: [{ kind: "cell", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "title", value: "Edited" }] });
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

test("a change of fields is made in the index where it is, and what it leaves to work out is filled in after", async () => {
  const s = scratch();
  try {
    const host = openIndexHost(s.bundle, { turn: (run) => run() });
    await host.ensure("tasks", s.tasks);
    const from = JSON.parse(readFileSync(join(s.tasks, "schema.json"), "utf8")) as TableSchema;
    // A formula added, and a field gone: the file is saved without it first, as the app saves it.
    const to: TableSchema = {
      ...from,
      fields: [...from.fields.filter((f) => f.name !== "assignee"), { name: "urgency", type: "integer", computed: { dialect: "table-expr-v1", expr: "(- 6 priority)" } }],
    };
    writeFileSync(join(s.tasks, "schema.json"), JSON.stringify(to));
    assert.equal(await host.save("tasks", s.tasks, true, ["assignee"], true), true);
    let built = false;
    const build = host.build;
    host.build = (...args) => ((built = true), build(...args));
    assert.equal(await host.alter("tasks", from, to), true);
    // Answering for the new fields at once, the formula's values worked out as they're read.
    const now = await queryIndex(host, { name: "tasks", schema: to });
    assert.deepEqual((await now!.rows(0, 2)).map((r) => [r.id, r.urgency, "assignee" in r]), [["ytjc8tj8w8ftnbf9h86s5k9jfk", 5, false], ["wpzuom5b9k3k4g6co658ozwerw", 4, false]]);
    const bySoonest = { sort: [{ field: "urgency", direction: "desc" as const }] };
    assert.equal(await queryIndex(host, { name: "tasks", schema: to, query: bySoonest }), null, "sorted by it once it's filled in");
    await host.fill("tasks", to);
    const sorted = await queryIndex(host, { name: "tasks", schema: to, query: bySoonest });
    const want = applyView({ path: "", schema: to, rows: rowsOnDisk(s.tasks), views: [], meta: {} as never }, { id: "v", name: "v", layout: "table", ...bySoonest });
    assert.deepEqual(await sorted!.ids(0, 8), want.map((r) => r.id));
    assert.equal(built, false, "never built again");
    // Fresh for the files as they are: opened again, it's kept.
    assert.equal(await host.ensure("tasks", s.tasks), 8);
    await host.close();
    // A change it can't make in place: from a schema it wasn't made for.
    const again = openIndexHost(s.bundle);
    assert.equal(await again.alter("tasks", from, to), false);
    await again.close();
  } finally {
    s.done();
  }
});

test("a field renamed is renamed in the index first, then every row is written with its new name, its values kept (#709)", async () => {
  const s = scratch();
  try {
    const host = openIndexHost(s.bundle, { turn: (run) => run() });
    await host.ensure("tasks", s.tasks);
    const from = JSON.parse(readFileSync(join(s.tasks, "schema.json"), "utf8")) as TableSchema;
    const before = rowsOnDisk(s.tasks);
    // The same field (its id) under another name, as renameField leaves it.
    const to: TableSchema = { ...from, fields: from.fields.map((f) => (f.name === "title" ? { ...f, name: "task" } : f)) };
    assert.deepEqual(fieldChanges(from, to), { matched: from.fields.map((_, i) => i), renamed: [{ from: "title", to: "task" }], gone: [] });
    assert.equal(await host.alter("tasks", from, to), true);
    writeFileSync(join(s.tasks, "schema.json"), JSON.stringify(to));
    assert.equal(await host.save("tasks", s.tasks, true, [], true), true);
    const after = rowsOnDisk(s.tasks);
    assert.ok(after.every((r) => !("title" in r)), "no row keeps the old name");
    assert.deepEqual(after.map((r) => [r.id, r.task]), before.map((r) => [r.id, r.title]));
    // Read under its new name, sorted and searched.
    const sorted = await queryIndex(host, { name: "tasks", schema: to, query: { sort: [{ field: "task", direction: "asc" }] } });
    assert.deepEqual(await sorted!.ids(0, 8), [...before].sort((a, b) => String(a.title).localeCompare(String(b.title))).map((r) => r.id));
    // Undone: renamed back the same way.
    assert.equal(await host.alter("tasks", to, from), true);
    writeFileSync(join(s.tasks, "schema.json"), JSON.stringify(from));
    assert.equal(await host.save("tasks", s.tasks, true, [], true), true);
    assert.deepEqual(rowsOnDisk(s.tasks).map((r) => [r.id, r.title, "task" in r]), before.map((r) => [r.id, r.title, false]));
    await host.close();
  } finally {
    s.done();
  }
});

test("a field removed and another added with its name are two fields: the old one's values aren't the new one's (D62)", () => {
  const from: TableSchema = { fields: [{ id: "aaaaaaaaaaaaa", name: "notes", type: "text" }] };
  const to: TableSchema = { fields: [{ id: "bbbbbbbbbbbbb", name: "notes", type: "text" }] };
  assert.deepEqual(fieldChanges(from, to), { matched: [undefined], renamed: [], gone: ["notes"] });
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

test("a large table split across rows files is handed over as one, in file order, small files and all (D51)", async () => {
  const s = scratch();
  try {
    const whole = await readBundle(nodeFs, s.bundle);
    const many = Array.from({ length: 6000 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}`, priority: i % 7 }));
    whole.tables.tasks!.rows = [];
    const files = unzipSync(await bundleToArchive("projects", whole));
    const dir = "projects.table/tables/tasks/rows/";
    const lines = (rows: typeof many) => rows.map((r) => JSON.stringify(r)).join("\n");
    // Two large files and a small one between (inflated as the archive is read, not left compressed);
    // the first without its last line end, as a hand edit can leave it.
    files[`${dir}0001.ndjson`] = strToU8(lines(many.slice(0, 3000)));
    files[`${dir}0001m.ndjson`] = strToU8(`${lines(many.slice(3000, 3005))}\n`);
    files[`${dir}0002.ndjson`] = strToU8(`${lines(many.slice(3005))}\n`);
    let entry: import("@workspace.sh/table-core").LazyZipEntry | undefined;
    const opened = await openArchive(zipSync(files), [], {
      lazyFrom: 1000,
      rowsLazily: (name, _table, rows) => name === "tasks" && ((entry = rows), true),
    });
    assert.deepEqual(opened.bundle.tables.tasks!.rows, []);
    assert.deepEqual([...rowsInChunks(entry!.chunks())], many);
    assert.deepEqual(firstRowsInBytes(entry!.head(1 << 20), 6000), many);
    assert.deepEqual(firstRowsInBytes(entry!.head(64), 1), many.slice(0, 1));

    // Declined: read as any other, all three files.
    const read = await openArchive(zipSync(files), [], { lazyFrom: 1000, rowsLazily: () => false });
    assert.deepEqual(read.bundle.tables.tasks!.rows, many);
  } finally {
    s.done();
  }
});

test("a table with two rows of one id isn't indexed: held in memory, where the later is kept (D54)", async () => {
  const s = scratch();
  try {
    appendFileSync(join(s.tasks, "rows", "0001.ndjson"), '{"id":"ytjc8tj8w8ftnbf9h86s5k9jfk","title":"Edited on another branch"}\n');
    const host = openIndexHost(s.bundle);
    await assert.rejects(host.ensure("tasks", s.tasks), /two of its rows have the same id/);
    await host.close();
  } finally {
    s.done();
  }
});

test("rows read a piece at a time as they come are the rows read whole", async () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, title: `Row ${i} ünïcode` }));
  const bytes = new TextEncoder().encode(many.map((r) => JSON.stringify(r)).join("\n") + "\n");
  for (const size of [1, 7, 64, 1000, bytes.length]) {
    async function* pieces(): AsyncIterable<Uint8Array> {
      for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
    }
    const out = [];
    for await (const row of rowsInAsyncChunks(pieces())) out.push(row);
    assert.deepEqual(out, many, `pieces of ${size}`);
  }
});

test("a table with a line its rows can't read isn't indexed: held in memory, the line is kept (#567)", async () => {
  const s = scratch();
  try {
    appendFileSync(join(s.tasks, "rows", "0001.ndjson"), '{"id":"t9","title":"Broken because of a typo"\n');
    const host = openIndexHost(s.bundle);
    await assert.rejects(host.ensure("tasks", s.tasks), /line 9 of rows\/0001.ndjson couldn't be read/);
    await host.close();
  } finally {
    s.done();
  }
});

test("a table with cells' own formulas is indexed: shown with their results, edited, and saved back to cells/ (D52)", async () => {
  const s = scratch();
  try {
    mkdirSync(join(s.tasks, "cells"), { recursive: true });
    writeFileSync(join(s.tasks, "cells", "0001.ndjson"), '{"id":"wpzuom5b9k3k4g6co658ozwerw","field":"priority","expr":"(* 7 6)"}\n');
    // The row's own value goes with the formula, as a writer would have left it.
    const rows = rowsOnDisk(s.tasks).map((r) => (r.id === "wpzuom5b9k3k4g6co658ozwerw" ? (({ priority: _p, ...rest }) => rest)(r) : r));
    writeFileSync(join(s.tasks, "rows", "0001.ndjson"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const held = (await readBundle(nodeFs, s.bundle, { rowsElsewhere: (dir) => dir === s.tasks })).tables.tasks!;
    // Held in the index, its cells are there, not in memory.
    assert.equal(held.cells, undefined);
    assert.equal(canBeIndexed({ ...held, cells: [{ id: "wpzuom5b9k3k4g6co658ozwerw", field: "priority", expr: "(* 7 6)" }] }), true);
    assert.equal(canBeIndexed({ ...held, cells: [{ id: "wpzuom5b9k3k4g6co658ozwerw", field: "priority", expr: '(sum (values "priority"))' }] }), false);
    const host = openIndexHost(s.bundle);
    await host.ensure("tasks", s.tasks);
    const shownOf = async (id: string) => (await (await indexedViewRows(host, "tasks", held, held.views[0]!, "")).rows(0, 20)).find((r) => r.id === id)!;
    assert.equal((await shownOf("wpzuom5b9k3k4g6co658ozwerw")).priority, 42);
    // A formula given in place, and one typed over: undo of that brings the formula back.
    const made = await makeIndexEdits(host, "tasks", held, [{ kind: "formula", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "priority", expr: "(+ 1 1)" }]);
    assert.deepEqual(made.back, [{ kind: "formula", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "priority", expr: null }]);
    assert.equal((await shownOf("ytjc8tj8w8ftnbf9h86s5k9jfk")).priority, 2);
    const typed = await makeIndexEdits(host, "tasks", held, [{ kind: "cell", rowId: "wpzuom5b9k3k4g6co658ozwerw", field: "priority", value: 5 }]);
    assert.deepEqual(typed.back, [{ kind: "formula", rowId: "wpzuom5b9k3k4g6co658ozwerw", field: "priority", expr: "(* 7 6)" }]);
    assert.equal((await shownOf("wpzuom5b9k3k4g6co658ozwerw")).priority, 5);
    // Another of t1's fields edited: its formula's result isn't taken for a typed value.
    await makeIndexEdits(host, "tasks", held, [{ kind: "cell", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "title", value: "Retitled" }, { kind: "body", rowId: "ytjc8tj8w8ftnbf9h86s5k9jfk", content: "Notes" }]);
    assert.equal((await shownOf("ytjc8tj8w8ftnbf9h86s5k9jfk")).priority, 2);
    await host.save("tasks", s.tasks, true);
    assert.equal(readFileSync(join(s.tasks, "cells", "0001.ndjson"), "utf8"), '{"id":"ytjc8tj8w8ftnbf9h86s5k9jfk","field":"priority","expr":"(+ 1 1)"}\n');
    assert.equal(rowsOnDisk(s.tasks).find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")!.priority, undefined);
    assert.equal(rowsOnDisk(s.tasks).find((r) => r.id === "wpzuom5b9k3k4g6co658ozwerw")!.priority, 5);
    // Read again from the files, as any reader: the same.
    const again = (await readBundle(nodeFs, s.bundle)).tables.tasks!;
    assert.deepEqual(again.cells, [{ id: "ytjc8tj8w8ftnbf9h86s5k9jfk", field: "priority", expr: "(+ 1 1)" }]);
    await host.close();
  } finally {
    s.done();
  }
});
