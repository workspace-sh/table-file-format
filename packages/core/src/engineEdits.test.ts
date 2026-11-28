// Changes applied by the engine to the rows it holds (#867, step 3a): what applyChanges gives in
// memory, for batches made the way peers make them (each side's diff, merged in some order), and
// edits as history says them, as rowChanges says them.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyChanges, diffBundle, type BundleChange } from "./changes.js";
import { rowChanges } from "./edit-log.js";
import { call, formulaEngineSet } from "./engine.js";
import { applyChangesThroughEngine, applyToHeld, dropSteps, heldRowsAll, isRowChange, undoDepth, undoHeld } from "./engineEdits.js";
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
        else t.schema.fields = [...t.schema.fields.filter((f) => f.name !== "extra"), { name: "extra", type: "object" }];
        break;
      case 6:
        // A field changed or added: a diff writes it before the rows' changes.
        if (r.int(2)) t.schema.fields = t.schema.fields.map((f) => (f.name === "n" ? { ...f, title: `N${r.int(9)}` } : f));
        else if (!t.schema.fields.some((f) => f.name === "added")) t.schema.fields = [...t.schema.fields, { name: "added", type: "string" }];
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
      // Every change, fields' and views' with the rows': the batch goes in runs.
      sides.push(JSON.parse(JSON.stringify(diffBundle(r.int(2) ? from : base, next))) as BundleChange[]);
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
    assert.deepEqual(got.schema, want.schema, `seed ${seed}: schema`);
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

test("a batch of rows' changes and others is applied in its order, as applyChanges applies it", { skip }, () => {
  const rows: Row[] = [
    { id: "a", n: 1, total: 5 },
    { id: "b", n: 2, total: 6 },
  ];
  const plain: Field[] = [
    { name: "n", type: "number" },
    { name: "total", type: "number" },
  ];
  const base = (): ParsedBundle => ({ path: "/x.table", meta: { title: "X" }, tables: { t: { path: "/x.table/tables/t", schema: { fields: plain }, rows, views: [], meta: {} } } });
  const cases: [string, BundleChange[]][] = [
    // The delete compares `total` while it's a stored value: changed since, the row stays. Made
    // computed only after, it's no longer compared.
    [
      "a delete, then its field made computed",
      [
        { op: "delete", table: "t", row: "a", values: { id: "a", n: 1, total: 99 } },
        { op: "field", table: "t", name: "total", to: { name: "total", type: "number", computed: { kind: "formula", expr: "n" } } as Field },
      ],
    ],
    // A row taken out, a field changed, then the row edited: brought back, with the edit, across
    // the batch's runs (two peers' diffs joined give this order: a diff writes fields first).
    [
      "a delete, a field changed, then the deleted row set",
      [
        { op: "delete", table: "t", row: "a", values: { id: "a", n: 1, total: 5 } },
        { op: "field", table: "t", name: "x", to: { name: "x", type: "string" } },
        { op: "set", table: "t", row: "a", field: "y", to: "kept" },
      ],
    ],
    // A cell set, then its table taken away and added again: the new table's rows are the content's.
    [
      "a cell set, then its table removed and added again",
      [
        { op: "set", table: "t", row: "a", field: "x", to: 1 },
        { op: "table-remove", table: "t" },
        { op: "table-add", table: "t", content: { schema: { fields: plain }, rows: [{ id: "a", n: 1 }], views: [], meta: {} as never } },
        { op: "set", table: "t", row: "a", field: "n", to: 7 },
      ],
    ],
  ];
  for (const [name, changes] of cases) {
    const want = applyChanges(base(), changes).tables.t!;
    const got = applyChangesThroughEngine(base(), changes).tables.t!;
    assert.deepEqual(got.rows, want.rows, name);
    assert.deepEqual(got.schema, want.schema, name);
  }
});

test("the problems batches make and end, worked out from what each names, keep up with the whole table's, batch after batch", { skip }, () => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = random(seed * 13);
    let table: ParsedTable = { path: "", schema: problemSchema, rows: problemRows(seed, 80), views: [], meta: {} as never };
    const bodies = [table.rows[0]!.id, table.rows[3]!.id, "gone page"];
    const attachments = ["a.png", "b.png", "unused.png", "c.png"];
    const input = {
      schema: { ...problemSchema, fields: problemSchema.fields.map((f) => ({ ...f, choices: enumValues(f) })) },
      bodies,
      attachments,
      targets: {},
    };
    const held = holdRows(
      problemSchema.fields.map((f) => f.name),
      table.rows,
    );
    try {
      const all = () => call<{ found: unknown[]; total: number; counts: Record<string, number> }>("rows.problems", { handle: held.handle, ...input, from: 0, to: 1e9 });
      let was = all().found.map((f) => JSON.stringify(f));
      for (let round = 0; round < 4; round++) {
        const next = JSON.parse(JSON.stringify(table)) as ParsedTable;
        for (let k = 0; k < 1 + r.int(5); k++) {
          const at = r.int(next.rows.length);
          const roll = r.int(5);
          if (roll === 0) next.rows.splice(at, 1);
          else if (roll === 1) next.rows.splice(at, 0, { ...problemRows(seed * 97 + round * 7 + k, 1)[0]!, id: `n${seed}-${round}-${k}` });
          else if (roll === 2) {
            const [moved] = next.rows.splice(at, 1);
            next.rows.splice(r.int(next.rows.length + 1), 0, moved!);
          } else next.rows[at] = { ...next.rows[at]!, ...problemRows(seed * 31 + round * 5 + k, 1)[0]!, id: next.rows[at]!.id };
        }
        const wrap = (t: ParsedTable): ParsedBundle => ({ path: "", meta: {} as never, tables: { t } });
        const changes = diffBundle(wrap(table), wrap(next)).filter(isRowChange);
        const applied = applyToHeld(held, table, changes, { problems: input })!;
        const now = all();
        const said = now.found.map((f) => JSON.stringify(f));
        const left = [...was];
        for (const g of applied.problems!.gone.map((f) => JSON.stringify(f))) {
          const i = left.indexOf(g);
          assert.ok(i >= 0, `seed ${seed}, round ${round}: ended a problem there wasn't: ${g}`);
          left.splice(i, 1);
        }
        assert.deepEqual([...left, ...applied.problems!.found.map((f) => JSON.stringify(f))].sort(), [...said].sort(), `seed ${seed}, round ${round}`);
        assert.equal(applied.problems!.total, now.total, `seed ${seed}, round ${round}: total`);
        assert.deepEqual(applied.problems!.counts, now.counts, `seed ${seed}, round ${round}: counts`);
        checked += said.length;
        was = said;
        table = applyChanges(wrap(table), changes).tables.t!;
      }
    } finally {
      freeRows(held);
    }
  }
  assert.ok(checked > 1000, `${checked} problems compared`);
});

test("undo through the engine gives back each row as it was, with its page and cells, and redo each as it became (#867, step 3b)", { skip }, () => {
  let undone = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const r = random(seed * 3);
    const rows = rowsFor(r, 2 + r.int(10));
    const bodies: Record<string, string> = {};
    const cells: CellFormula[] = [];
    for (const row of rows) {
      if (r.int(3) === 0) bodies[row.id] = "a page\n";
      if (r.int(4) === 0) cells.push({ id: row.id, field: "title", note: "check" });
    }
    let table: ParsedTable = bundleOf(rows, { bodies, cells }).tables.t!;
    const held = holdRows(
      FIELDS.map((f) => f.name),
      rows,
    );
    try {
      // A few edits, each a side's diff applied to the table as the engine holds it.
      const states: { rows: Row[]; bodies: ParsedTable["bodies"]; cells: ParsedTable["cells"] }[] = [{ rows: heldRowsAll(held), bodies: table.bodies, cells: table.cells }];
      for (let e = 0; e < 1 + r.int(4); e++) {
        const next = editOf(r, bundleOf(table.rows, { ...(table.bodies ? { bodies: table.bodies } : {}), ...(table.cells ? { cells: table.cells } : {}) })).tables.t!;
        const wrap = (t: ParsedTable): ParsedBundle => ({ path: "", meta: {} as never, tables: { t } });
        const changes = diffBundle(wrap(table), wrap(next)).filter(isRowChange);
        const done = applyToHeld(held, table, changes);
        table = { ...table, rows: heldRowsAll(held), bodies: done.bodies, cells: done.cells };
        states.push({ rows: table.rows, bodies: table.bodies, cells: table.cells });
      }
      // Undone one by one, back to the start; then redone to the end.
      for (let i = states.length - 2; i >= 0; i--) {
        const back = undoHeld(held, table);
        if (back === null) {
          // An edit that changed nothing isn't a step: the state before it is the same.
          assert.deepEqual(states[i]!.rows, table.rows);
          continue;
        }
        table = { ...table, rows: heldRowsAll(held), bodies: back.bodies, cells: back.cells };
        undone++;
      }
      assert.deepEqual(table.rows, states[0]!.rows, `seed ${seed}: undone, the rows as they were`);
      assert.deepEqual(table.bodies ?? {}, states[0]!.bodies ?? {}, `seed ${seed}: undone, the pages`);
      assert.deepEqual([...(table.cells ?? [])].map((c) => JSON.stringify(c)).sort(), [...(states[0]!.cells ?? [])].map((c) => JSON.stringify(c)).sort(), `seed ${seed}: undone, the cells`);
      for (;;) {
        const forth = undoHeld(held, table, { redo: true });
        if (forth === null) break;
        table = { ...table, rows: heldRowsAll(held), bodies: forth.bodies, cells: forth.cells };
      }
      const last = states.at(-1)!;
      assert.deepEqual(table.rows, last.rows, `seed ${seed}: redone, the rows as they became`);
      assert.deepEqual(table.bodies ?? {}, last.bodies ?? {}, `seed ${seed}: redone, the pages`);
    } finally {
      freeRows(held);
    }
  }
  assert.ok(undone > 150, `${undone} edits undone`);
});

test("undo keeps the app's budget, a new edit ends what there was to redo, and a stretch of typing is one step", { skip }, () => {
  const rows: Row[] = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  const table = bundleOf(rows).tables.t!;
  const held = holdRows(["title", "n", "tags", "total"], rows);
  try {
    const set = (to: string, options = {}) => applyToHeld(held, table, [{ op: "set", table: "t", row: "a", field: "title", to }], options);
    set("1", { keep: 2 });
    set("2", { keep: 2 });
    assert.equal(set("3", { keep: 2 }).steps.undo, 2);
    undoHeld(held, table);
    assert.equal(heldRowsAll(held)[0]!.title, "2");
    assert.equal(undoDepth(held).redo, 1);
    // A new edit: nothing to redo.
    set("4");
    assert.equal(undoDepth(held).redo, 0);
    // A refresh isn't the person's edit: nothing to undo for it.
    const before = undoDepth(held).undo;
    applyToHeld(held, table, [{ op: "set", table: "t", row: "b", field: "title", to: "kept" }], { undoable: false });
    assert.equal(undoDepth(held).undo, before);
    // Typed in, a stretch: one step, undone all at once.
    set("5", { run: "page:a" });
    set("56", { run: "page:a" });
    set("567", { run: "page:a" });
    assert.equal(undoDepth(held).undo, before + 1);
    undoHeld(held, table);
    assert.equal(heldRowsAll(held)[0]!.title, "4");
    assert.ok(undoDepth(held).bytes > 0);
  } finally {
    freeRows(held);
  }
});

test("the app's undo is the one order: steps by token, a batch in runs one step, a step made moot dropped, the budget the app's", { skip }, () => {
  const rows: Row[] = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];
  const table = bundleOf(rows).tables.t!;
  const held = holdRows(["title", "n", "tags", "total"], rows);
  try {
    const title = (id: string) => heldRowsAll(held).find((r) => r.id === id)?.title;
    // A step's token: undo names it, and another on top is refused.
    const first = applyToHeld(held, table, [{ op: "set", table: "t", row: "a", field: "title", to: "A1" }]).step!;
    const second = applyToHeld(held, table, [{ op: "set", table: "t", row: "b", field: "title", to: "B1" }]).step!;
    assert.notEqual(first, second);
    assert.throws(() => undoHeld(held, table, { step: first }), /the step to undo is \d+, not \d+/);
    assert.equal(undoHeld(held, table, { step: second })!.step, second);
    assert.equal(title("b"), "B");
    // Redone, it's the app's same step.
    assert.equal(undoHeld(held, table, { redo: true, step: second })!.step, second);
    // A batch in runs (fields changed between): one step, undone at once.
    const run = "batch:mixed";
    const x = applyToHeld(held, table, [{ op: "set", table: "t", row: "a", field: "title", to: "A2" }], { run }).step;
    const z = applyToHeld(held, table, [{ op: "set", table: "t", row: "b", field: "title", to: "B2" }], { run }).step;
    assert.equal(x, z);
    undoHeld(held, table, { step: x! });
    assert.deepEqual([title("a"), title("b")], ["A1", "B1"]);
    // A row put in, then changed by a peer's edit (not the person's): undoing the insert would take
    // out a row changed since, which the merge rule leaves. It changes nothing: dropped, not kept on top.
    const put = applyToHeld(held, table, [{ op: "insert", table: "t", row: "n", values: { id: "n", title: "new" }, after: "b" }]).step!;
    applyToHeld(held, table, [{ op: "set", table: "t", row: "n", field: "title", to: "peer" }], { undoable: false });
    const moot = undoHeld(held, table, { step: put })!;
    assert.equal(moot.moot, put);
    assert.equal(title("n"), "peer");
    // The step below it is next: the second edit, redone above.
    assert.equal(undoDepth(held).nextUndo, second, "the step below is next");
    // Without a token, undo goes past a moot step to the next.
    const again = applyToHeld(held, table, [{ op: "insert", table: "t", row: "m", values: { id: "m" }, after: null }]).step!;
    applyToHeld(held, table, [{ op: "set", table: "t", row: "m", field: "title", to: "peer" }], { undoable: false });
    const past = undoHeld(held, table)!;
    assert.notEqual(past.step, again);
    assert.equal(past.step, second);
    assert.equal(title("b"), "B", "the step below it undone");
    // The app's budget lets steps go, by token.
    const kept = applyToHeld(held, table, [{ op: "set", table: "t", row: "a", field: "title", to: "kept" }]).step!;
    assert.equal(dropSteps(held, [kept]), 1);
    assert.equal(undoDepth(held).nextUndo, first, "the first edit, still below");
  } finally {
    freeRows(held);
  }
});
