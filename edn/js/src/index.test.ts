import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EdnError, loadEdn } from "./index.ts";

// The shared corpus (edn/corpus/cases.json): the same cases the Rust core passes.
const corpus = JSON.parse(readFileSync(new URL("../../corpus/cases.json", import.meta.url), "utf8")) as {
  cases: { name: string; input: string; canonical?: string; error?: string }[];
};

test("every corpus case reads to its canonical form, or fails as it should", async () => {
  const edn = await loadEdn();
  for (const c of corpus.cases) {
    if (c.canonical !== undefined) {
      assert.equal(edn.canonical(c.input), c.canonical, c.name);
      assert.equal(edn.canonical(c.canonical), c.canonical, `${c.name}: canonical reads back to itself`);
    } else {
      assert.throws(() => edn.canonical(c.input), (e: unknown) => e instanceof EdnError && e.message.includes(c.error!), c.name);
    }
  }
});

test("a value crosses into JavaScript without loss", async () => {
  const edn = await loadEdn();
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

test("an error says where", async () => {
  const edn = await loadEdn();
  assert.throws(
    () => edn.read("{:a 1\n :a 2}"),
    (e: unknown) => e instanceof EdnError && e.message.includes("same key twice"),
  );
  assert.throws(() => edn.read("[1\n 2] 3"), (e: unknown) => e instanceof EdnError && e.line === 2);
});
