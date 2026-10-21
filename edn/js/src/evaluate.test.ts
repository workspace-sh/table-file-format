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
function today(tables: Record<string, ParsedTable>): Record<string, Record<string, unknown[]>> {
  const out: Record<string, Record<string, unknown[]>> = {};
  for (const [name, t] of Object.entries(tables)) {
    const { rows } = computeRows(t.schema, t.rows, { tables, self: name, views: t.views });
    out[name] = Object.fromEntries(t.schema.fields.filter((f) => f.computed).map((f) => [f.name, rows.map((r) => r[f.name])]));
  }
  return out;
}

function same(edn: Edn, tables: Record<string, ParsedTable>, label: string): { core: number; host: number } {
  const want = today(tables);
  const got = edn.computeTables(tables as never);
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

  test(`${binding}: a table whose formulas read a Sheet place is left to the host`, async () => {
    const edn = await loadEdn({ binding });
    const table = { schema: { fields: [{ name: "x", type: "number", computed: { expr: '(at "x" -1 "v")', dialect: "table-expr-v1" } }] }, rows: [{ id: "r1" }] };
    assert.equal(edn.computeTables({ t: table })["t"], "host");
  });
}
