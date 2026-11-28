// Changes applied by the engine to the rows it holds (#867, step 3a): what applyChanges gives in
// memory, for batches made the way peers make them (each side's diff, merged in some order), and
// edits as history says them, as rowChanges says them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyChanges, diffBundle, type BundleChange } from "./changes.js";
import { rowChanges } from "./edit-log.js";
import { call, formulaEngineSet } from "./engine.js";
import { applyChangesThroughEngine, applyToHeld, heldRowsAll, isRowChange } from "./engineEdits.js";
import { freeRows, holdRows } from "./engineViews.js";
import { problemsOf } from "./problems.js";
import { problemRows, problemSchema, random } from "./viewCases.js";
import { enumValues } from "./types.js";
import type { CellFormula, Field, ParsedBundle, ParsedTable, Row } from "./types.js";

const skip = formulaEngineSet() ? false : "these tests need the engine (edn/js/src/node-engine.ts)";

const FIELDS: Field[] = [
  { name: "title", type: "string" },
  { name: "n", type: "number" },
  { name: "tags", type: "array" },
  { name: "total", type: "number", computed: { kind: "formula", expr: "n" } } as Field,
];

const bundleOf = (rows: Row[], more: Partial<ParsedTable> = {}): ParsedBundle => ({
  path: "/x.table",
  meta: { title: "X" },
  tables: { t: { path: "/x.table/tables/t", schema: { fields: FIELDS }, rows, views: [], meta: {}, ...more } },
});

/** A row's edit as the engine says it: the row held, changed by the diff that makes `after` of it. */
function eventsOf(before: Row | undefined, after: Row | undefined, computed?: ReadonlySet<string>) {
  const fields = computed ? FIELDS : FIELDS.filter((f) => !f.computed);
  const a = bundleOf(before ? [before] : []);
  const b = bundleOf(after ? [after] : []);
  a.tables.t!.schema = { fields };
  b.tables.t!.schema = { fields };
  const changes = diffBundle(a, b).filter(isRowChange);
  const held = holdRows(
    fields.map((f) => f.name),
    a.tables.t!.rows,
  );
  try {
    const applied = applyToHeld(held, a.tables.t!, changes);
    assert.deepEqual(heldRowsAll(held), applyChanges(a, changes).tables.t!.rows);
    return applied.events;
  } finally {
    freeRows(held);
  }
}

test("a row's edits are said as rowChanges says them: each of edit-log.test's cases", { skip }, () => {
  const cases: [Row | undefined, Row | undefined, ReadonlySet<string>?][] = [
    // A cell changed is one set, with from and to; an empty side is left out.
    [{ id: "p1", title: "A", status: "todo", owner: "sam" }, { id: "p1", title: "A", status: "doing", owner: "sam" }],
    [{ id: "p1", title: "A", status: "todo", owner: "sam" }, { id: "p1", title: "A", status: "todo", owner: null }],
    [{ id: "p1", title: "A", status: "todo", owner: "sam" }, { id: "p1", title: "A", status: "todo", owner: "" }],
    [{ id: "p1", title: "A", status: "todo", owner: "sam" }, { id: "p1", title: "A", status: "todo" }],
    [{ id: "p1", due: null }, { id: "p1", due: "2026-10-01" }],
    [{ id: "p1", due: null }, { id: "p1", due: "" }],
    [{ id: "p1" }, { id: "p1", due: null }],
    // Values are compared as they are stored.
    [{ id: "p1", tags: ["a", "b"] }, { id: "p1", tags: ["a", "b"] }],
    [{ id: "p1", tags: ["a", "b"] }, { id: "p1", tags: ["b", "a"] }],
    [{ id: "p1", n: 1 }, { id: "p1", n: "1" }],
    [{ id: "p1", done: false }, { id: "p1", done: true }],
    [{ id: "p1", n: 0 }, { id: "p1" }],
    // Several cells changed are a set each, and nothing changed is nothing.
    [{ id: "p1", a: 1, b: 2, c: 3 }, { id: "p1", a: 1, b: 2, c: 3 }],
    [{ id: "p1", a: 1, b: 2, c: 3 }, { id: "p1", a: 1, b: 20, d: 4 }],
    // A row added is an insert and one removed a delete, each with the whole row.
    [undefined, { id: "p9", title: "New", n: 2 }],
    [{ id: "p9", title: "New", n: 2 }, undefined],
    // Fields worked out from others aren't recorded.
    [{ id: "p1", n: 1, total: 10 }, { id: "p1", n: 2, total: 20 }, new Set(["total"])],
    [{ id: "p1", n: 1, total: 10 }, { id: "p1", n: 1, total: 20 }, new Set(["total"])],
    [undefined, { id: "p1", n: 1, total: 10 }, new Set(["total"])],
    [{ id: "p1", n: 1, total: 10 }, undefined, new Set(["total"])],
  ];
  for (const [before, after, computed] of cases) {
    assert.deepEqual(eventsOf(before, after, computed), rowChanges(before, after, computed), JSON.stringify([before, after]));
  }
});

/** Rows of a table, a few fields each, some empty. */
function rowsFor(r: ReturnType<typeof random>, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const row: Row = { id: `r${i}` };
    if (r.int(4) !== 0) row.title = r.pick(["A", "B", "é", "", "a\nb", "x\"y"]);
    if (r.int(3) !== 0) row.n = r.pick([0, 1, 1.5, -2, 1e21, 0.1]);
    if (r.int(4) === 0) row.tags = r.pick([["a"], ["a", "b"], []]);
    if (r.int(6) === 0) row.extra = { k: r.int(3) };
    if (r.int(8) === 0) row.title = null;
    return row;
  });
}

/** One side's edit of a bundle, as an app makes it. */
function editOf(r: ReturnType<typeof random>, b: ParsedBundle): ParsedBundle {
  const next = JSON.parse(JSON.stringify(b)) as ParsedBundle;
  const t = next.tables.t!;
  for (let k = 1 + r.int(4); k > 0; k--) {
    const at = r.int(Math.max(1, t.rows.length));
    switch (r.int(9)) {
      case 0:
        t.rows.splice(r.int(t.rows.length + 1), 0, { id: `new${r.int(1000)}`, title: r.pick(["N", "M"]) });
        break;
      case 1:
        if (t.rows[at]) {
          const [gone] = t.rows.splice(at, 1);
          if (t.bodies) delete t.bodies[gone!.id];
          if (t.cells) t.cells = t.cells.filter((c) => c.id !== gone!.id);
        }
        break;
      case 2: {
        const [moved] = t.rows.splice(at, 1);
        if (moved) t.rows.splice(r.int(t.rows.length + 1), 0, moved);
        break;
      }
      case 3:
        if (t.rows[at]) (t.bodies ??= {})[t.rows[at]!.id] = r.pick(["page\n", "other\n"]);
        break;
      case 4:
        if (t.rows[at]) t.cells = [...(t.cells ?? []).filter((c) => !(c.id === t.rows[at]!.id && c.field === "n")), { id: t.rows[at]!.id, field: "n", note: r.pick(["a", "b"]) }];
        break;
      case 5:
        if (t.rows[at]) delete t.rows[at]!.title;
        break;
      default:
        if (t.rows[at]) t.rows[at] = { ...t.rows[at]!, [r.pick(["title", "n", "tags", "other"])]: r.pick(["v", 7, ["z"], null, "" ]) };
    }
  }
  return next;
}

test("batches made as peers make them (each side's diff, in some order) give what applyChanges gives", { skip }, () => {
  let applied = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = random(seed);
    const rows = rowsFor(r, 1 + r.int(12));
    const bodies: Record<string, string> = {};
    const cells: CellFormula[] = [];
    for (const row of rows) {
      if (r.int(4) === 0) bodies[row.id] = "a page\n";
      if (r.int(5) === 0) cells.push({ id: row.id, field: "title", note: "check" });
    }
    const base = bundleOf(rows, { ...(r.int(2) ? { bodies } : {}), ...(r.int(2) ? { cells } : {}) });
    // Two or three sides, each from the base or from another's result.
    const sides: BundleChange[][] = [];
    let from = base;
    for (let s = 2 + r.int(2); s > 0; s--) {
      const next = editOf(r, r.int(2) ? from : base);
      sides.push(JSON.parse(JSON.stringify(diffBundle(r.int(2) ? from : base, next).filter(isRowChange))) as BundleChange[]);
      from = next;
    }
    const order = sides.flat();
    for (let i = order.length - 1; i > 0 && r.int(3) === 0; i--) {
      const j = r.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    // Some changes made by hand: to a row nobody has, after one nobody has.
    if (r.int(4) === 0) order.push({ op: "set", table: "t", row: "nobody", field: "title", to: "x" });
    if (r.int(4) === 0) order.push({ op: "move", table: "t", row: rows[0]!.id, after: "nobody" });
    const want = applyChanges(base, order).tables.t!;
    const got = applyChangesThroughEngine(base, order).tables.t!;
    assert.deepEqual(got.rows, want.rows, `seed ${seed}: rows`);
    assert.deepEqual(got.bodies, want.bodies, `seed ${seed}: pages`);
    assert.deepEqual(got.cells, want.cells, `seed ${seed}: cells`);
    applied += order.length;
  }
  assert.ok(applied > 1500, `${applied} changes applied`);
});

test("a change that isn't a row's is refused by the engine, and the table is as it was", { skip }, () => {
  const rows: Row[] = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  const held = holdRows(["title"], rows);
  try {
    const table = bundleOf(rows).tables.t!;
    assert.throws(
      () => applyToHeld(held, table, [{ op: "delete", table: "t", row: "b", values: rows[1]! }, { op: "field", table: "t", name: "title" } as never]),
      /isn't a row's/,
    );
    assert.throws(() => applyToHeld(held, table, [{ op: "set", table: "t", row: "a", field: "id", to: "z" }]), /id isn't changed by a set/);
    assert.deepEqual(heldRowsAll(held), rows);
  } finally {
    freeRows(held);
  }
});

test("asked, the answer says the problems the changes made and the ones they ended: with those, the problems before are the problems after", { skip }, () => {
  for (const seed of [1, 2, 3, 4]) {
    const rows = problemRows(seed, 120);
    const table: ParsedTable = { path: "", schema: problemSchema, rows, views: [], meta: {} as never };
    const input = {
      schema: { ...problemSchema, fields: problemSchema.fields.map((f) => ({ ...f, choices: enumValues(f) })) },
      bodies: [],
      attachments: null,
      targets: {},
    };
    const held = holdRows(
      problemSchema.fields.map((f) => f.name),
      rows,
    );
    try {
      const all = () => call<{ found: unknown[] }>("rows.problems", { handle: held.handle, ...input, from: 0, to: 1e9 }).found.map((f) => JSON.stringify(f));
      const was = all();
      const r = random(seed);
      const next = JSON.parse(JSON.stringify(table)) as ParsedTable;
      for (let k = 0; k < 6; k++) {
        const at = r.int(next.rows.length);
        if (r.int(3) === 0) next.rows.splice(at, 1);
        else next.rows[at] = { ...next.rows[at]!, ...problemRows(seed * 31 + k, 1)[0]!, id: next.rows[at]!.id };
      }
      const wrap = (t: ParsedTable): ParsedBundle => ({ path: "", meta: {} as never, tables: { t } });
      const changes = diffBundle(wrap(table), wrap(next)).filter(isRowChange);
      const applied = applyToHeld(held, table, changes, { problems: input })!;
      const now = all();
      // What was, less what ended, and what was made: what is.
      const left = [...was];
      for (const g of applied.problems!.gone.map((f) => JSON.stringify(f))) left.splice(left.indexOf(g), 1);
      assert.deepEqual([...left, ...applied.problems!.found.map((f) => JSON.stringify(f))].sort(), [...now].sort(), `seed ${seed}`);
      assert.equal(applied.problems!.total, now.length);
      // And what memory finds of the rows the changes give.
      const counts: Record<string, number> = {};
      for (const p of problemsOf(applyChanges(wrap(table), changes).tables.t!, "t")) counts[p.code] = (counts[p.code] ?? 0) + 1;
      assert.deepEqual(applied.problems!.counts, counts, `seed ${seed}: counts`);
      assert.ok(applied.problems!.found.length + applied.problems!.gone.length > 0, `seed ${seed}: something changed`);
    } finally {
      freeRows(held);
    }
  }
});
