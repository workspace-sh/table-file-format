// The JSI entry answers as the other bindings do. Node's native library
// stands in for the apps' JSI module: both are the same four calls over the
// same core, and both throw an error as an Error carrying its JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

import { EdnError, loadEdn } from "./index.ts";
import { jsiEdn } from "./jsi.ts";

const file = new URL(`../native/edn.${process.platform}-${process.arch}.node`, import.meta.url);

test("with no JSI module installed, there's no engine", () => {
  assert.equal(jsiEdn(), null);
});

test("an installed JSI module answers as WebAssembly does", { skip: !existsSync(file) && "no native library for this machine" }, async () => {
  const wasm = await loadEdn({ binding: "wasm" });
  (globalThis as { __workspaceEdn?: unknown }).__workspaceEdn = createRequire(import.meta.url)(file.pathname);
  try {
    const edn = jsiEdn()!;
    assert.equal(edn.binding, "native");
    assert.equal(edn.canonical("{:b 2 :a 1}"), wasm.canonical("{:b 2 :a 1}"));
    assert.deepEqual(edn.formula("(* n 2)"), wasm.formula("(* n 2)"));
    assert.throws(() => edn.read("{:a"), EdnError);
    const tables = {
      t: {
        schema: { fields: [{ name: "n", type: "number" }, { name: "twice", type: "number", computed: { dialect: "table-expr-v1", expr: "(* n 2)" } }] },
        rows: [{ id: "a", n: 3 }, { id: "b", n: 4.5 }],
      },
    };
    const clock = { now: new Date("2026-10-26T12:00:00Z"), seed: 1 };
    assert.deepEqual(edn.computeTables(tables, clock), wasm.computeTables(tables, clock));
    assert.deepEqual((edn.computeTables(tables, clock) as Record<string, Record<string, unknown>>).t!.twice, [6, 9]);
  } finally {
    delete (globalThis as { __workspaceEdn?: unknown }).__workspaceEdn;
  }
});
