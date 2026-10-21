import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { evaluate, FormulaError, parseExpr, type Scope, type Value } from "../../../packages/core/src/expr.ts";
import { fieldsOf, loadEdn, type FormulaResult } from "./index.ts";

// Today's evaluator and the core, value for value, over the same rows: a formula's
// result is the same whichever computes it (empties compared as empties).

type Row = Record<string, unknown>;

function today(formula: string, rows: Row[]): Value[] {
  const parsed = parseExpr(formula);
  if (!parsed.ok) throw new Error(parsed.message);
  let row: Row = {};
  const scope = {
    field: (name: string) => row[name] as Value,
    values: (name: string) => rows.map((r) => r[name]) as Value,
  } as unknown as Scope;
  return rows.map((r) => {
    row = r;
    return evaluate(parsed.expr, scope);
  });
}

const plain = (v: unknown): unknown =>
  v instanceof FormulaError ? { code: v.code, message: v.message } : Array.isArray(v) ? v.map(plain) : v === "" || v === null ? undefined : v;

function check(edn: Awaited<ReturnType<typeof loadEdn>>, formula: string, rows: Row[]) {
  const expr = edn.formula(formula);
  const columns: Record<string, unknown[]> = {};
  for (const f of fieldsOf(expr)) columns[f] = rows.map((r) => r[f]);
  const got = edn.evaluateColumn(formula, columns, rows.length).map(plain);
  const want = today(formula, rows).map(plain);
  for (let i = 0; i < rows.length; i++) assert.deepEqual(got[i], want[i], `${formula} on row ${i} (${JSON.stringify(rows[i])})`);
}

function fixtureTables(): { rows: Row[]; formulas: string[] }[] {
  const out: { rows: Row[]; formulas: string[] }[] = [];
  const root = new URL("../../../fixtures/", import.meta.url);
  for (const bundle of readdirSync(root).filter((d) => d.endsWith(".table"))) {
    const tables = new URL(`${bundle}/tables/`, root);
    for (const t of readdirSync(tables)) {
      const schema = JSON.parse(readFileSync(new URL(`${t}/schema.json`, tables), "utf8")) as { fields: { computed?: { expr: string } }[] };
      const rows = readFileSync(new URL(`${t}/rows/0001.ndjson`, tables), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
      out.push({ rows, formulas: schema.fields.flatMap((f) => (f.computed ? [f.computed.expr] : [])) });
    }
  }
  return out;
}

// Rows meant to find differences: empties of every kind, text where numbers go, halves, huge and tiny numbers.
const hostile: Row[] = [
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

for (const binding of ["native", "wasm"] as const) {
  test(`${binding}: every fixture formula, over its own rows, gives today's results`, async () => {
    const edn = await loadEdn({ binding });
    let n = 0;
    let host = 0;
    for (const { rows, formulas } of fixtureTables()) {
      for (const f of formulas) {
        try {
          check(edn, f, rows);
          n++;
        } catch (e) {
          // The host's, not the core's (yet): a relation or a Sheet place. Anything else is a failure.
          if (!(e instanceof Error && /needs the host/.test(e.message))) throw e;
          host++;
        }
      }
    }
    assert.ok(n >= 8, `${n} formulas checked by the core, ${host} left to the host`);
  });

  test(`${binding}: awkward values give today's results, error messages included`, async () => {
    const edn = await loadEdn({ binding });
    for (const f of hostileFormulas) check(edn, f, hostile);
  });

  test(`${binding}: a formula that follows a relation is left to the host`, async () => {
    const edn = await loadEdn({ binding });
    assert.throws(() => edn.evaluateColumn('(related "company" "name")', {}, 1), /needs the host/);
  });
}

// Keep the type honest: a FormulaResult is what plain() gives for today's values.
const _check: FormulaResult = undefined;
void _check;
