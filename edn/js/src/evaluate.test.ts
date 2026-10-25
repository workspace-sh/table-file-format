import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FormulaError } from "../../../packages/core/src/expr.ts";
import { computeRows } from "../../../packages/core/src/workbook.ts";
import { readBundle } from "../../../packages/core/src/io.ts";
import { nodeFs } from "../../../packages/core/src/node-fs.ts";
import type { ParsedTable } from "../../../packages/core/src/types.ts";
import { loadEdn, type Edn, type FormulaResult } from "./index.ts";

// Today's evaluator and the core, value for value, over the same rows: a formula's
// result is the same whichever computes it (empties compared as empties).

type Row = { id: string } & Record<string, unknown>;

const plain = (v: unknown): unknown =>
  v instanceof FormulaError ? { code: v.code, message: v.message } : Array.isArray(v) ? v.map(plain) : v === "" || v === null ? undefined : v;

/** Today's results for a bundle's tables: computeRows, table by table, as the apps compute them. */
function today(tables: Record<string, ParsedTable>, now: Date): Record<string, Record<string, unknown[]>> {
  const out: Record<string, Record<string, unknown[]>> = {};
  for (const [name, t] of Object.entries(tables)) {
    const { rows } = computeRows(t.schema, t.rows, { tables, self: name, views: t.views, now, ...(t.cells ? { cells: t.cells } : {}) });
    // A field is worked out when it has a formula, or a cell of it has its own (D52).
    const own = new Set((t.cells ?? []).filter((c) => c.expr !== undefined).map((c) => c.field));
    out[name] = Object.fromEntries(t.schema.fields.filter((f) => f.computed || own.has(f.name)).map((f) => [f.name, rows.map((r) => r[f.name])]));
  }
  return out;
}

/** A moment past midnight UTC in some places and before it in others: the date is the reader's own. */
const MOMENT = new Date("2026-10-24T23:30:15.250Z");

function same(edn: Edn, tables: Record<string, ParsedTable>, label: string): { core: number; host: number } {
  const want = today(tables, MOMENT);
  const got = edn.computeTables(tables as never, { now: MOMENT });
  let core = 0;
  let host = 0;
  for (const [name, fields] of Object.entries(want)) {
    const g = got[name];
    if (g === "host") {
      host++;
      continue;
    }
    for (const [field, values] of Object.entries(fields)) {
      core++;
      const mine = g![field]!.map(plain);
      values.forEach((v, i) => assert.deepEqual(mine[i], plain(v), `${label}: ${name}.${field} row ${i} (${tables[name]!.schema.fields.find((f) => f.name === field)?.computed?.expr})`));
    }
  }
  return { core, host };
}

// Rows meant to find differences: empties of every kind, text where numbers go, halves, huge and tiny numbers.
const hostile: Record<string, unknown>[] = [
  { a: 1, b: 2, s: "x", t: true },
  { a: 2.5, b: 0, s: "", t: false },
  { a: -2.5, b: null, s: "Zebra", t: true },
  { a: "", b: 3, s: "apple", t: null },
  { a: "12", b: 4, s: "äb", t: "yes" },
  { a: 1e21, b: 1e-7, s: "🙂", t: false },
  { a: 0.1, b: 0.2, s: "a\"b", t: true },
  { a: 1.005, b: -1.005, s: "MiXeD", t: true },
  { a: 123456789012345680000, b: 5e-324, s: "1", t: false },
  {},
];

const hostileFormulas = [
  "(+ a b)", "(- a b)", "(- a)", "(* a b)", "(/ a b)", "(/ a 0)", "(+ a b 1 2)",
  "(round a)", "(round a 2)", "(round b 1)", "(round (* a 100) -1)", "(abs b)",
  "(sum a b)", "(sum (values \"a\"))", "(average (values \"b\"))", "(min (values \"a\"))", "(max a b 7)", "(count (values \"s\"))", "(count a b s t)",
  "(= a b)", "(<> s \"x\")", "(< a b)", "(>= s \"b\")", "(< s a)", "(= a nil)", "(= s \"\")",
  "(and t true)", "(or t false)", "(not t)", "(if t a b)", "(if (> a b) \"big\" \"small\")", "(if nil 1)", "(isblank a)", "(isblank s)",
  "(concatenate s \"-\" a \"-\" b \"-\" t)", "(concatenate (values \"a\"))", "(upper s)", "(lower s)", "(len s)", "(len a)",
  "(field \"a\")", "(values \"t\")", "(nope a)", "(+ a (values \"a\"))", "(round)", "(/ 1 2 3)", "(+ (/ a 0) 1)",
];

/** The awkward rows as one table, each formula a computed field over them. */
function hostileTable(): Record<string, ParsedTable> {
  const fields = [
    { name: "a", type: "number" }, { name: "b", type: "number" }, { name: "s", type: "string" }, { name: "t", type: "boolean" },
    ...hostileFormulas.map((expr, i) => ({ name: `f${i}`, type: "string", computed: { expr, dialect: "table-expr-v1" } })),
  ];
  const rows = hostile.map((r, i) => ({ ...r, id: `r${i}` })) as Row[];
  return { t: { schema: { fields }, rows, views: [], meta: {} } as unknown as ParsedTable };
}

/** Two tables that point at each other, with every way a relation goes wrong. */
function relationsTables(): Record<string, ParsedTable> {
  const t = (fields: object[], rows: object[]) => ({ schema: { fields }, rows, views: [], meta: {} }) as unknown as ParsedTable;
  const f = (name: string, expr: string) => ({ name, type: "string", computed: { expr, dialect: "table-expr-v1" } });
  return {
    companies: t(
      [
        { name: "name", type: "string" },
        { name: "size", type: "number" },
        f("open", '(sum (linked "deals" "company" "value"))'),
        f("count", '(count (linked "deals" "company" "title"))'),
        f("loop", '(sum (linked "deals" "company" "back"))'),
        f("nowhere", '(linked "nope" "company" "value")'),
        f("unknown", '(linked "deals" "company" "nosuchfield")'),
      ],
      [{ id: "c1", name: "Atlas", size: 10 }, { id: "c2", name: "Beacon", size: "" }, { id: "c3", name: "Cove" }],
    ),
    deals: t(
      [
        { name: "title", type: "string" },
        { name: "value", type: "number" },
        { name: "company", type: "string", relation: { table: "companies" } },
        { name: "owners", type: "string", relation: { table: "companies" } },
        f("industry", '(related "company" "name")'),
        f("size", '(related "company" "size")'),
        f("many", '(related "owners" "name")'),
        f("back", '(related "company" "loop")'),
        f("notarelation", '(related "title" "name")'),
        f("nosuch", '(related "nosuch" "name")'),
        f("self", "(+ self 1)"),
        f("other", '(field "value" "d2")'),
        f("gone", '(field "value" "d404")'),
        f("unknownfield", "(+ ghost 1)"),
        f("broken", "(+ 1"),
      ],
      [
        { id: "d1", title: "Renewal", value: 100, company: "c1", owners: ["c1", "c2"] },
        { id: "d2", title: "Pilot", value: 250.5, company: "c1", owners: [] },
        { id: "d3", title: "Lost", value: "", company: "c404", owners: ["c3", "c404", ""] },
        { id: "d4", title: "Orphan", value: 7 },
        { id: "d5", title: "Second", value: 3, company: "c2", owners: "c2" },
      ],
    ),
  };
}

const table = (fields: object[], rows: object[]) => ({ schema: { fields }, rows, views: [], meta: {} }) as unknown as ParsedTable;
const f = (name: string, expr: string) => ({ name, type: "string", computed: { expr, dialect: "table-expr-v1" } });

for (const binding of ["native", "wasm"] as const) {
  test(`${binding}: every fixture bundle's formulas give today's results`, async () => {
    const edn = await loadEdn({ binding });
    let core = 0;
    let host = 0;
    const root = new URL("../../../fixtures/", import.meta.url);
    for (const bundle of readdirSync(root).filter((d) => d.endsWith(".table"))) {
      const b = await readBundle(nodeFs, fileURLToPath(new URL(bundle, root)));
      const n = same(edn, b.tables, bundle);
      core += n.core;
      host += n.host;
    }
    assert.ok(core >= 18, `${core} computed fields checked by the core, ${host} tables left to the host`);
  });

  test(`${binding}: awkward values give today's results, error messages included`, async () => {
    const edn = await loadEdn({ binding });
    same(edn, hostileTable(), "hostile");
  });

  test(`${binding}: relations gone wrong give today's results: missing rows and tables, lists, loops, unknown names`, async () => {
    const edn = await loadEdn({ binding });
    const n = same(edn, relationsTables(), "relations");
    assert.equal(n.host, 0);
    assert.ok(n.core >= 15, `${n.core}`);
  });

  test(`${binding}: the clock gives today's results, read at one moment`, async () => {
    const edn = await loadEdn({ binding });
    const fields = [
      { name: "n", type: "number" },
      f("day", "(today)"), f("at", "(now)"), f("later", '(if (> (today) "2000-01-01") "after" "before")'),
      f("wrong", "(today 1)"),
    ];
    const n = same(edn, { t: table(fields, [{ id: "r1", n: 1 }, { id: "r2" }]) }, "clock");
    assert.equal(n.host, 0);
  });

  test(`${binding}: chance draws a new number from 0 up to 1 for every cell, the same again from the same seed`, async () => {
    const edn = await loadEdn({ binding });
    const t = { t: table([f("r", "(rand)")], Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` }))) } as never;
    const a = (edn.computeTables(t, { seed: 7 })["t"] as Record<string, FormulaResult[]>)["r"]!;
    assert.ok(a.every((x) => typeof x === "number" && x >= 0 && x < 1));
    assert.equal(new Set(a).size, a.length);
    assert.deepEqual((edn.computeTables(t, { seed: 7 })["t"] as Record<string, FormulaResult[]>)["r"], a);
    assert.notDeepEqual((edn.computeTables(t, { seed: 8 })["t"] as Record<string, FormulaResult[]>)["r"], a);
  });

  test(`${binding}: cells' own formulas give today's results: over a formula, in an empty cell, under a typed value, the wrong type`, async () => {
    const edn = await loadEdn({ binding });
    const fields = [
      { name: "n", type: "number" }, { name: "s", type: "string" }, { name: "d", type: "date" }, { name: "k", type: "integer" },
      { name: "tags", type: "string", relation: { table: "t", cardinality: "many" } },
      f("x", "(* n 2)"), f("y", "(+ x 1)"),
    ];
    const rows = [{ id: "r1", n: 1 }, { id: "r2", n: 2, s: "typed" }, { id: "r3", n: 3 }, { id: "r4" }];
    const cell = (id: string, field: string, expr: string, more: object = {}) => ({ id, field, expr, ...more });
    const cells = [
      cell("r1", "x", "100"), // over its field's formula, read by another
      cell("r1", "x", "999"), // a second line for the cell: the first is used
      cell("r2", "s", '"mine"'), // under a typed value: the value wins
      cell("r3", "s", '(concatenate "n=" n)'),
      cell("r1", "d", '"2026-02-30"'), cell("r2", "d", '"2026-02-28"'), cell("r3", "d", "(today)"),
      cell("r1", "k", "2.5"), cell("r2", "k", "(* n 21)"), cell("r3", "k", '"seven"'),
      cell("r1", "n", "(+ 1"), // doesn't read
      cell("r4", "n", "5", { dialect: "other" }),
      cell("r4", "s", "(+ y 1)"), cell("r4", "y", "(len s)"), // a loop through two cells
      cell("r1", "tags", '(values "s")'), cell("r2", "tags", "(values \"n\")"),
      cell("r404", "x", "1"), cell("r1", "nope", "1"), cell("r1", "id", '"z"'),
      { id: "r3", field: "x", note: "a note alone is no formula" },
    ];
    const n = same(edn, { t: { ...table(fields, rows), cells } as unknown as ParsedTable }, "cells");
    assert.equal(n.host, 0);
    assert.ok(n.core >= 7, `${n.core}`);
  });

  test(`${binding}: loops worked out by iteration give today's results, and stop at the most passes allowed`, async () => {
    const edn = await loadEdn({ binding });
    // Interest on a balance that includes the interest: settles. A counter that only grows: stops at max.
    const fields = [{ name: "base", type: "number" }, f("total", "(+ base interest)"), f("interest", "(* total 0.1)"), f("up", "(+ up 1)"), f("off", "(+ off (rand))")];
    for (const iteration of [{ max: 100, change: 0.001 }, { max: 7, change: 0.5 }, { max: 1, change: 0 }]) {
      const t = { ...table(fields.slice(0, 4), [{ id: "r1", base: 100 }, { id: "r2", base: 0 }, { id: "r3" }]), meta: { iteration } } as unknown as ParsedTable;
      const reader = table([{ name: "to", type: "string", relation: { table: "t" } }, f("seen", '(related "to" "total")')], [{ id: "a", to: "r1" }]);
      const n = same(edn, { t, reader }, `iteration ${iteration.max}`);
      assert.equal(n.host, 0);
    }
    // A change exactly the one allowed is settled: the loop stops there (1), rather than going on to 5.
    const exact = { ...table([f("z", "(min 5 (+ z 0.5))")], [{ id: "r1" }]), meta: { iteration: { max: 100, change: 0.5 } } } as unknown as ParsedTable;
    same(edn, { exact }, "settles at the change allowed");
    assert.deepEqual((edn.computeTables({ exact } as never)["exact"] as Record<string, FormulaResult[]>)["z"], [1]);
  });

  test(`${binding}: a cell's own formula in a GeoJSON field is the host's, with every table related to it`, async () => {
    const edn = await loadEdn({ binding });
    const plainTable = table([{ name: "n", type: "number" }, f("x", "(* n 2)")], [{ id: "r1", n: 1 }]);
    const shaped = { ...table([{ name: "shape", type: "geojson" }], [{ id: "r1" }]), cells: [{ id: "r1", field: "shape", expr: '"{}"' }] };
    const reader = table([{ name: "to", type: "string", relation: { table: "t" } }, f("y", '(related "to" "shape")')], [{ id: "a", to: "r1" }]);
    const out = edn.computeTables({ t: shaped as never, reader: reader as never, alone: plainTable as never });
    assert.equal(out["t"], "host");
    assert.equal(out["reader"], "host");
    assert.notEqual(out["alone"], "host");
  });

  test(`${binding}: Sheet places give today's results: running totals down long grids, groups, sorts, manual order, other tables`, async () => {
    const edn = await loadEdn({ binding });
    const sheet = (id: string, more: object = {}) => ({ id, name: id, layout: "table", coordinates: true, ...more });
    const n = 3000;
    const ledger = {
      ...table(
        [
          { name: "when", type: "datetime" }, { name: "amount", type: "number" },
          { name: "kind", type: "string", constraints: { enum: ["rent", "food", { value: "fun" }] } },
          f("balance", '(+ amount (at "balance" -1 "by-date"))'),
          f("left", '(+ amount (at "left" 1 "by-date"))'),
          f("place", '(row (at "amount" 0 "by-date"))'),
          f("above", '(sum (range "amount" nil "amount" -1 "by-date"))'),
          f("block", '(range "amount" 0 "kind" 1 "by-kind")'),
          f("count", '(rows (range "amount" nil "amount" nil "by-kind"))'),
          f("pinned", '(at "amount" "r7" "by-date")'),
          f("off", '(row (at "amount" -5000 "by-date"))'),
          f("bykind", '(at "balance" 0 "by-kind")'),
          f("manual", '(at "amount" 1 "manual")'),
          f("kindnext", '(at "kind" 1 "kind-sort")'),
          f("noview", '(at "amount" 0 "nope")'),
          f("notsheet", '(at "amount" 0 "plain")'),
          f("nofield", '(at "ghost" 0 "by-date")'),
          f("notcolumn", '(range "amount" 0 "when" 0 "narrow")'),
          f("byown", '(at "amount" 0 "by-own")'),
          f("ownplace", '(at "amount" -1 "by-own")'),
          f("bad", '(at "amount" "by-date")'),
          f("badrow", "(row 1)"),
        ],
        Array.from({ length: n }, (_, i) => ({
          id: `r${i}`,
          when: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00${i % 3 === 0 ? "+02:00" : "Z"}`,
          amount: i % 7 === 0 ? "" : (i * 37) % 101 - 50,
          kind: ["rent", "food", "fun", "", "other"][i % 5],
        })),
      ),
      views: [
        sheet("by-date", { sort: [{ field: "when", direction: "asc" }] }),
        sheet("by-kind", { group: { field: "kind" }, sort: [{ field: "amount", direction: "desc" }] }),
        sheet("manual", { order: ["r9", "r3", "r400"] }),
        sheet("kind-sort", { sort: [{ field: "kind", direction: "asc" }, { field: "when", direction: "desc" }] }),
        sheet("narrow", { fields: ["amount", "kind"] }),
        sheet("by-own", { sort: [{ field: "ownplace", direction: "asc" }] }),
        { id: "plain", name: "plain", layout: "table" },
      ],
    } as unknown as ParsedTable;
    const reader = table(
      [f("there", '(at "amount" "r12" "by-date" "ledger")'), f("sum", '(sum (range "amount" "r1" "amount" "r30" "by-date" "ledger"))'), f("offset", '(at "amount" 1 "by-date" "ledger")'), f("gone", '(at "amount" 0 "by-date" "nowhere")')],
      [{ id: "x" }],
    );
    const counted = same(edn, { ledger, reader }, "places");
    assert.equal(counted.host, 0);
  });
}
