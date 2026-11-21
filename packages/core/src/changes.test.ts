import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyChanges, diffBundle, RowsNotLoadedError } from "./changes.js";
import type { ParsedBundle, ParsedTable, Row } from "./types.js";
import { writeBundle } from "./writer.js";

const row = (id: string, title: string, status = "todo"): Row => ({ id, title, status });
const bundle = (rows: Row[], more: Partial<ParsedTable> = {}): ParsedBundle => ({
  path: "/x.table",
  meta: { title: "X" },
  tables: {
    tasks: {
      path: "/x.table/tables/tasks",
      schema: { fields: [{ name: "title", type: "string" }, { name: "status", type: "string" }] },
      rows,
      views: [{ id: "v1", name: "All", layout: "table" }],
      meta: {},
      ...more,
    },
  },
});
const clone = (b: ParsedBundle) => JSON.parse(JSON.stringify(b)) as ParsedBundle;
const edit = (b: ParsedBundle, f: (t: ParsedTable) => void) => {
  const next = clone(b);
  f(next.tables.tasks!);
  return next;
};
const rowsOf = (b: ParsedBundle) => b.tables.tasks!.rows;
const base = () => bundle([row("a", "A"), row("b", "B"), row("c", "C")]);

test("a diff applied to the old bundle gives the new one", () => {
  const before = base();
  const after = edit(before, t => {
    t.rows[0]!.title = "A2";
    t.rows.splice(1, 1);
    t.rows.push(row("d", "D"));
    t.rows.reverse();
    t.schema.fields.push({ name: "owner", type: "string" });
    t.views.push({ id: "v2", name: "Board", layout: "board" });
    t.meta.title = "Tasks";
    t.bodies = { a: "page\n" };
    t.cells = [{ id: "a", field: "status", note: "check" }];
  });
  const applied = applyChanges(before, JSON.parse(JSON.stringify(diffBundle(before, after))));
  const t = applied.tables.tasks!;
  const want = after.tables.tasks!;
  assert.deepEqual(t.rows, want.rows);
  assert.deepEqual(t.schema, want.schema);
  assert.deepEqual(t.views, want.views);
  assert.deepEqual(t.bodies, want.bodies);
  assert.deepEqual(t.cells, want.cells);
  assert.equal(t.meta.title, "Tasks");
});
test("no change, no changes; a new modified_at isn't one", () => {
  const before = base();
  assert.deepEqual(diffBundle(before, clone(before)), []);
  assert.deepEqual(diffBundle(before, edit(before, t => void (t.meta.modified_at = "2026-11-21T00:00:00Z"))), []);
});
test("the bundle given isn't changed", () => {
  const before = base();
  const snapshot = clone(before);
  applyChanges(before, diffBundle(before, edit(before, t => void (t.rows[0]!.title = "Z"))));
  assert.deepEqual(clone(before), snapshot);
});
test("two sides editing different cells of one row both survive, in either order", () => {
  const b = base();
  const one = diffBundle(b, edit(b, t => void (t.rows[0]!.title = "mine")));
  const two = diffBundle(b, edit(b, t => void (t.rows[0]!.status = "done")));
  for (const order of [[...one, ...two], [...two, ...one]]) {
    assert.deepEqual(rowsOf(applyChanges(b, order))[0], { id: "a", title: "mine", status: "done" });
  }
});
test("two edits to one cell: the later in the order stands", () => {
  const b = base();
  const one = diffBundle(b, edit(b, t => void (t.rows[0]!.title = "first")));
  const two = diffBundle(b, edit(b, t => void (t.rows[0]!.title = "second")));
  assert.equal(rowsOf(applyChanges(b, [...one, ...two]))[0]!.title, "second");
});
test("deleted on one side and edited on the other: the row stays with the edit, in either order", () => {
  const b = base();
  const del = diffBundle(b, edit(b, t => void t.rows.splice(1, 1)));
  const set = diffBundle(b, edit(b, t => void (t.rows[1]!.title = "kept")));
  for (const order of [[...del, ...set], [...set, ...del]]) {
    assert.equal(rowsOf(applyChanges(b, order)).find(r => r.id === "b")?.title, "kept");
  }
});
test("a delete made after seeing the edit deletes", () => {
  const b = base();
  const edited = edit(b, t => void (t.rows[1]!.title = "seen"));
  const del = diffBundle(edited, edit(edited, t => void t.rows.splice(1, 1)));
  assert.equal(rowsOf(applyChanges(b, [...diffBundle(b, edited), ...del])).some(r => r.id === "b"), false);
});
test("a page comes back with a row kept by an edit", () => {
  const b = bundle([row("a", "A")], { bodies: { a: "page\n" } });
  const del = diffBundle(b, edit(b, t => { t.rows.splice(0, 1); delete t.bodies!.a; }));
  const set = diffBundle(b, edit(b, t => void (t.rows[0]!.title = "kept")));
  assert.equal(applyChanges(b, [...del, ...set]).tables.tasks!.bodies?.a, "page\n");
});
test("rows both sides insert after one row are all there, in one order", () => {
  const b = base();
  const one = diffBundle(b, edit(b, t => void t.rows.splice(1, 0, row("x", "X"))));
  const two = diffBundle(b, edit(b, t => void t.rows.splice(1, 0, row("y", "Y"))));
  assert.deepEqual(rowsOf(applyChanges(b, [...one, ...two])).map(r => r.id), ["a", "y", "x", "b", "c"]);
});
test("an insert whose neighbour has gone goes at the end", () => {
  const b = base();
  const del = diffBundle(b, edit(b, t => void t.rows.splice(1, 1)));
  const add = diffBundle(b, edit(b, t => void t.rows.splice(2, 0, row("x", "X"))));
  assert.deepEqual(rowsOf(applyChanges(b, [...del, ...add])).map(r => r.id), ["a", "c", "x"]);
});
test("computed values aren't carried", () => {
  const b = bundle([{ id: "a", title: "A", status: "todo", total: 1 }]);
  b.tables.tasks!.schema.fields.push({ name: "total", type: "number", computed: { kind: "formula", expr: "1" } } as never);
  assert.deepEqual(diffBundle(b, edit(b, t => void (t.rows[0]!.total = 2))), []);
});
test("a table without its rows in memory is refused, not treated as empty", () => {
  const b = bundle([], { indexed: { count: 10, version: 1 } });
  assert.throws(() => diffBundle(b, clone(b)), RowsNotLoadedError);
});
test("the same order of the same changes writes byte-identical files", async () => {
  const b = base();
  const changes = [
    ...diffBundle(b, edit(b, t => void (t.rows[0]!.title = "one"))),
    ...diffBundle(b, edit(b, t => void t.rows.push(row("d", "D")))),
    ...diffBundle(b, edit(b, t => void t.rows.splice(1, 1))),
  ];
  const read = async (dir: string) => {
    const out: Record<string, string> = {};
    const walk = async (at: string) => {
      for (const e of await readdir(join(dir, at), { withFileTypes: true })) {
        const rel = at ? `${at}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(rel);
        else if (!rel.endsWith("table.json")) out[rel] = await readFile(join(dir, rel), "utf8");
      }
    };
    await walk("");
    return out;
  };
  const dirs = await Promise.all([1, 2].map(async () => join(await mkdtemp(join(tmpdir(), "changes-")), "x.table")));
  for (const dir of dirs) await writeBundle(dir, applyChanges(clone(b), JSON.parse(JSON.stringify(changes))));
  assert.deepEqual(await read(dirs[0]!), await read(dirs[1]!));
});
