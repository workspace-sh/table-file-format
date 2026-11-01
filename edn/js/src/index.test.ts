import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { EdnError, loadEdn, type Edn } from "./index.ts";
import { parseExpr } from "../../../packages/core/src/expr.ts";

// The shared corpus (edn/corpus/cases.json): the same cases the Rust core passes.
const corpus = JSON.parse(readFileSync(new URL("../../corpus/cases.json", import.meta.url), "utf8")) as {
  cases: { name: string; input: string; canonical?: string; error?: string }[];
};

const bindings = ["native", "wasm"] as const;

for (const binding of bindings) test(`${binding}: every corpus case reads to its canonical form, or fails as it should`, async () => {
  const edn = await loadEdn({ binding });
  assert.equal(edn.binding, binding);
  for (const c of corpus.cases) {
    if (c.canonical !== undefined) {
      assert.equal(edn.canonical(c.input), c.canonical, c.name);
      assert.equal(edn.canonical(c.canonical), c.canonical, `${c.name}: canonical reads back to itself`);
    } else {
      assert.throws(() => edn.canonical(c.input), (e: unknown) => e instanceof EdnError && e.message.includes(c.error!), c.name);
    }
  }
});

for (const binding of bindings) test(`${binding}: a value crosses into JavaScript without loss`, async () => {
  const edn = await loadEdn({ binding });
  assert.deepEqual(edn.read('[1 1.0 "a" :a a (a) #{1} {:k 9007199254740993} #inst "2026-10-21T00:00:00Z" nil]'), {
    t: "vec",
    v: [
      { t: "int", v: "1" },
      { t: "float", v: "1.0" },
      { t: "str", v: "a" },
      { t: "kw", v: "a" },
      { t: "sym", v: "a" },
      { t: "list", v: [{ t: "sym", v: "a" }] },
      { t: "set", v: [{ t: "int", v: "1" }] },
      { t: "map", v: [[{ t: "kw", v: "k" }, { t: "int", v: "9007199254740993" }]] },
      { t: "tag", tag: "inst", v: { t: "str", v: "2026-10-21T00:00:00Z" } },
      { t: "nil" },
    ],
  });
});

for (const binding of bindings) test(`${binding}: an error says where`, async () => {
  const edn = await loadEdn({ binding });
  assert.throws(
    () => edn.read("{:a 1\n :a 2}"),
    (e: unknown) => e instanceof EdnError && e.message.includes("same key twice"),
  );
  assert.throws(() => edn.read("[1\n 2] 3"), (e: unknown) => e instanceof EdnError && e.line === 2);
});

// Every formula the fixtures hold, read by today's reader and by the core: the same expression, to the last field.
const fixtureFormulas = (): string[] => {
  const out: string[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      if (typeof r.expr === "string") out.push(r.expr);
      Object.values(r).forEach(walk);
    }
  };
  for (const dir of readdirSync(new URL("../../../fixtures/", import.meta.url)).filter((d) => d.endsWith(".table"))) {
    const tables = new URL(`../../../fixtures/${dir}/tables/`, import.meta.url);
    for (const t of readdirSync(tables)) walk(JSON.parse(readFileSync(new URL(`${t}/schema.json`, tables), "utf8")));
  }
  return out;
};

const sameAsToday = (edn: Edn, f: string) => {
  const today = parseExpr(f);
  assert.ok(today.ok, f);
  assert.deepEqual(edn.formula(f), today.ok ? today.expr : null, f);
};

for (const binding of bindings) test(`${binding}: every fixture formula reads to the same expression as today's reader`, async () => {
  const edn = await loadEdn({ binding });
  const formulas = fixtureFormulas();
  assert.ok(formulas.length >= 20);
  for (const f of formulas) sameAsToday(edn, f);
  // Former names (D48) and case, as today's reader takes them.
  for (const f of ['(COLUMN "spend")', '(Lookup "company" "industry")', "(concat a b)", "(SUM 1 2.5 -3 1e3)", '(if nil "a" "b\\n\\"q\\"")']) sameAsToday(edn, f);
});
