// Rows read by the engine (#867, step 1) are the rows the TypeScript reader reads: for every
// fixture, as a folder and as a single file, and for lines written to trip a reader up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTableArchive } from "./archive.js";
import { formulaEngine, rowsThroughEngine, setFormulaEngine, setRowsThroughEngine } from "./engine.js";
import { readBundle } from "./io.js";
import { nodeFs } from "./node-fs.js";
import { writeZip } from "./zip.js";
import type { FormulaEngine } from "./workbook.js";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;

/** What `read` gives with the switch off, and with it on; and how many files the engine was handed. */
async function bothWays<T>(read: () => Promise<T>): Promise<{ typescript: T; engine: T; handed: number }> {
  const engine = formulaEngine();
  assert.ok(engine, "these tests need the engine (edn/js/src/node-engine.ts)");
  const was = rowsThroughEngine();
  let handed = 0;
  try {
    setRowsThroughEngine(false);
    const typescript = await read();
    setFormulaEngine({ ...engine, callBytes: (op, input, bytes) => (handed++, engine.callBytes(op, input, bytes)) } as FormulaEngine);
    setRowsThroughEngine(true);
    const through = await read();
    return { typescript, engine: through, handed };
  } finally {
    setFormulaEngine(engine);
    setRowsThroughEngine(was);
  }
}

const folders = readdirSync(FIXTURES).filter((d) => d.endsWith(".table"));
const singles = readdirSync(join(FIXTURES, "single-file")).filter((d) => d.endsWith(".table"));

test("every fixture folder gives the same bundle, rows and all, read by the engine", async () => {
  for (const name of folders) {
    const got = await bothWays(() => readBundle(nodeFs, join(FIXTURES, name)));
    assert.deepEqual(got.engine, got.typescript, name);
    assert.ok(got.handed > 0, `${name}: the engine read its rows`);
  }
});

test("every single-file fixture, and a large one, gives the same bundle read by the engine", async () => {
  for (const path of [...singles.map((s) => join(FIXTURES, "single-file", s)), join(FIXTURES, "large", "big-10000.table")]) {
    const bytes = new Uint8Array(readFileSync(path));
    const got = await bothWays(() => readTableArchive(bytes));
    assert.deepEqual(got.engine, got.typescript, path);
    assert.ok(got.handed > 0, `${path}: the engine read its rows`);
  }
});

/** Rows files written to trip a reader up: each line is one way a line can be. */
const AWKWARD = [
  '{"id":"a","name":"Ada","n":1.50,"ok":true,"tags":["x", "y"],"extra":{"k":null}}',
  "",
  "    \t",
  "not json at all",
  "<<<<<<< ours",
  "=======",
  ">>>>>>> theirs",
  "[1, 2]",
  "null",
  '"a string"',
  '{"name":"no id"}',
  '{"id":""}',
  '{"id":7}',
  '{"id":"a","name":"Ada","n":1.50,"ok":true,"tags":["x", "y"],"extra":{"k":null}}',
  '{"id":"a","name":"Ada again, different"}',
  '{"id":"b","name":"Esc\\u00e9 \\"quoted\\" \\\\ back","n":-0,"n2":1e400,"big":12345678901234567890}\r',
  '{"id":"c","__proto__":{"polluted":true},"name":"one","name":"two","id":"c2"}',
  '{"id":"d","name":"🙂 ünïcödé","ok":false,"nothing":null}',
  '{"id":"e"} trailing',
  '{"id":"f",}',
];

/** A table whose rows files are `files`, as a folder and as a single file. */
function awkwardBundle(files: Record<string, Uint8Array>): { dir: string; archive: Uint8Array } {
  const dir = mkdtempSync(join(tmpdir(), "engine-rows-"));
  const root = join(dir, "awkward.table");
  const t = join(root, "tables", "things");
  mkdirSync(join(t, "rows"), { recursive: true });
  const schema = JSON.stringify({ fields: [{ name: "name", type: "string" }, { name: "n", type: "number" }, { name: "ok", type: "boolean" }, { name: "tags", type: "array" }] });
  writeFileSync(join(root, "meta.json"), "{}");
  writeFileSync(join(t, "schema.json"), schema);
  for (const [name, data] of Object.entries(files)) writeFileSync(join(t, "rows", name), data);
  const enc = new TextEncoder();
  const archive = writeZip([
    { name: "awkward.table/meta.json", data: enc.encode("{}") },
    { name: "awkward.table/tables/things/schema.json", data: enc.encode(schema) },
    ...Object.entries(files).map(([name, data]) => ({ name: `awkward.table/tables/things/rows/${name}`, data })),
  ]);
  return { dir: root, archive };
}

test("lines that aren't rows are said and kept in the same words, in the same order, and rows across files are one table", async () => {
  const enc = new TextEncoder();
  const files = {
    "0001.ndjson": enc.encode(AWKWARD.join("\n")),
    // A second file: a repeat of a row in the first, a byte order mark, and bytes that aren't UTF-8.
    "0002.ndjson": new Uint8Array([...enc.encode("﻿"), ...enc.encode('{"id":"b","name":"from the second file"}\n{"id":"g","name":"bad '), 0xff, 0xfe, ...enc.encode('"}\n{"id":"h"}\n')]),
  };
  const { dir, archive } = awkwardBundle(files);
  try {
    for (const [form, read] of [["folder", () => readBundle(nodeFs, dir)], ["single file", () => readTableArchive(archive)]] as const) {
      const got = await bothWays(read);
      assert.ok(got.handed > 0, form);
      assert.deepEqual(got.engine, got.typescript, form);
      const t = got.engine.tables["things"]!;
      // What the reader gives, so the comparison above has something to compare.
      assert.ok(t.rows.length >= 5, `${form}: ${t.rows.length} rows`);
      assert.ok((t.diagnostics?.length ?? 0) >= 10, form);
      assert.ok((t.unread?.length ?? 0) >= 9, form);
      assert.equal(Object.getPrototypeOf(t.rows.find((r) => r.id === "c2")), Object.prototype, `${form}: "__proto__" stays a key`);
    }
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});
