// A large table's index made from its archive with its rows checked on the way (table-file-format#867,
// step 2c), against the same build with no check:
//
//   node --conditions=source --import tsx edn/bench/engine-check.mts <file.table> <wasm|native> <on|off> [strict]
//
// One build a run, into a new SQLite file, as an app makes one from a file just opened (the rows
// files inflated a piece at a time, as indexHost reads them). Run it under `/usr/bin/time -l` for
// the peak memory. "strict" adds constraints most rows break (as engine-problems.mts does): a
// unique title keeps every title met, the most a check holds across files.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { setFormulaEngine } from "../../packages/core/src/engine.ts";
import { checkOf } from "../../packages/core/src/indexer.ts";
import { readZip, type LazyZipEntry } from "../../packages/core/src/zip.ts";
import { openNodeDatabase } from "../../packages/core/src/sqlite-node.ts";
import { buildIndexFromBytes } from "../../packages/app/src/indexed.ts";

const [file, binding, mode, strict] = process.argv.slice(2) as [string, "wasm" | "native", "on" | "off", string | undefined];
const engine = (await loadEdn({ binding })) as never as { call(op: string, input: string): string; callBytes(op: string, input: string, bytes: Uint8Array): string };
// The time spent in the check's own calls, for its share of the build.
let inCheck = 0;
const timed = <A extends unknown[]>(f: (op: string, ...a: A) => string) => (op: string, ...a: A) => {
  if (!op.startsWith("check.")) return f(op, ...a);
  const s = performance.now();
  try {
    return f(op, ...a);
  } finally {
    inCheck += performance.now() - s;
  }
};
setFormulaEngine({ ...(engine as object), call: timed(engine.call.bind(engine)), callBytes: timed(engine.callBytes.bind(engine)) } as never);

const bytes = new Uint8Array(readFileSync(file));
const read = Object.values((await readTableArchive(bytes, { rows: "later" })).tables)[0]!;
const fields = read.schema.fields.map((f) =>
  !strict ? f
  : f.name === "amount" ? { ...f, constraints: { ...f.constraints, maximum: 50000 } }
  : f.name === "title" ? { ...f, constraints: { ...f.constraints, unique: true } }
  : f.name === "note" ? { ...f, constraints: { ...f.constraints, maxLength: 10 } }
  : f,
);
const schema = { ...read.schema, fields };
const parts = readZip(bytes, { lazy: (name) => name.includes("/rows/") })
  .filter((e) => e.name.includes("/rows/"))
  .sort((a, b) => (a.name < b.name ? -1 : 1)) as unknown as (LazyZipEntry & { name: string })[];
const size = parts.reduce((n, p) => n + p.size, 0);

const dir = mkdtempSync(join(tmpdir(), "engine-check-"));
try {
  const db = openNodeDatabase(join(dir, "index.sqlite"));
  const s = performance.now();
  const count = await buildIndexFromBytes(db, {
    name: "deals",
    schema,
    rows: { files: parts.map((p) => ({ name: p.name.split("/").pop()!, chunks: p.chunks() })), size },
    key: "k",
    commitEvery: 50_000,
    ...(mode === "off" ? { check: false as const } : {}),
  });
  const build = performance.now() - s;
  const check = await checkOf(db, "deals");
  if (mode === "on" && !check) throw new Error("no check was kept");
  console.log(
    JSON.stringify({
      file: file.split("/").pop(),
      binding,
      check: mode,
      strict: !!strict,
      rows: count,
      "build (ms)": Math.round(build),
      "in the check (ms)": Math.round(inCheck),
      ...(check ? { problems: check.total, "kept (bytes)": JSON.stringify(check).length } : {}),
      "heap after (MB)": Math.round(process.memoryUsage().heapUsed / 1e6),
    }),
  );
  await (db as unknown as { close?: () => Promise<void> }).close?.();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
