// One cell edited, and a row added, removed and moved, in a large table (table-file-format#867,
// step 3a), each of the ways a table is edited today and through the engine:
//
//   node --expose-gc --conditions=source --import tsx edn/bench/engine-apply.mts <file.table> <wasm|native> [edits]
//
// - engine: the rows held by the engine, the change applied there (rows.apply), as a held table
//   will be once the switch is on (step 3d).
// - index: the rows in the SQLite index, the edited row written there (putRows), as a large table
//   is edited today.
// - memory: the rows in JavaScript, the change applied as the app does (withCell) and as a merge
//   does (applyChanges), as a held table is edited today.
//
// Each edit is timed alone, `edits` times (20 by default); the first, the median and the slowest
// are said. The tables are made first and not timed, and garbage is collected before each edit.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { applyChanges, type BundleChange } from "../../packages/core/src/changes.ts";
import { setFormulaEngine } from "../../packages/core/src/engine.ts";
import { applyToHeld } from "../../packages/core/src/engineEdits.ts";
import { holdRows } from "../../packages/core/src/engineViews.ts";
import { putRows, removeRows } from "../../packages/core/src/indexer.ts";
import { readZip, type LazyZipEntry } from "../../packages/core/src/zip.ts";
import { openNodeDatabase } from "../../packages/core/src/sqlite-node.ts";
import { buildIndexFromBytes } from "../../packages/app/src/indexed.ts";
import { withCell } from "../../packages/app/src/edits.ts";
import { enumValues, type ParsedBundle, type ParsedTable, type Row } from "../../packages/core/src/types.ts";
import { problemsOf } from "../../packages/core/src/problems.ts";

const [file, binding, times, which] = process.argv.slice(2) as [string, "wasm" | "native", string | undefined, string | undefined];
const N = Number(times ?? 20);
setFormulaEngine((await loadEdn({ binding })) as never);

const bytes = new Uint8Array(readFileSync(file));
const read = Object.values((await readTableArchive(bytes, { rows: "later" })).tables)[0]!;
// "strict": constraints most rows break (as engine-check.mts), the most problems there are to compare.
const strict = which === "strict";
const schema = !strict
  ? read.schema
  : {
      ...read.schema,
      fields: read.schema.fields.map((f) =>
        f.name === "amount" ? { ...f, constraints: { ...f.constraints, maximum: 50000 } } : f.name === "title" ? { ...f, constraints: { ...f.constraints, unique: true } } : f.name === "note" ? { ...f, constraints: { ...f.constraints, maxLength: 10 } } : f,
      ),
    };
const parts = readZip(bytes, { lazy: (name) => name.includes("/rows/") })
  .filter((e) => e.name.includes("/rows/"))
  .sort((a, b) => (a.name < b.name ? -1 : 1)) as unknown as (LazyZipEntry & { name: string })[];
// The rows in memory, as a table read whole holds them.
const rows: Row[] = [];
const decoder = new TextDecoder();
for (const p of parts) {
  let text = "";
  for await (const c of p.chunks()) text += decoder.decode(c, { stream: true });
  for (const line of text.split("\n")) if (line.trim()) rows.push(JSON.parse(line) as Row);
}
const table: ParsedTable = { ...read, schema, rows, indexed: undefined, loading: undefined } as ParsedTable;
const ids = rows.map((r) => r.id);
const field = schema.fields.find((f) => f.type === "string" && !f.computed)!.name;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const say = (way: string, edit: string, ms: number[]) =>
  console.log(JSON.stringify({ binding, way, edit, rows: rows.length, first: +ms[0]!.toFixed(2), median: +median(ms).toFixed(2), slowest: +Math.max(...ms).toFixed(2) }));
const timed = async (f: (i: number) => unknown): Promise<number[]> => {
  const ms: number[] = [];
  for (let i = 0; i < N; i++) {
    // Garbage from making the tables isn't any edit's.
    (globalThis as { gc?: () => void }).gc?.();
    const s = performance.now();
    await f(i);
    ms.push(performance.now() - s);
  }
  return ms;
};
// A row a long way in, a different one each time.
const at = (i: number) => Math.floor(rows.length / 2) + i * 997;

// The engine. Its code is made ready on a small table first (WebAssembly compiles a function the
// first time it's called), so the first edit timed is the first of this table, not of the code.
if (process.env.WARM) {
  const small = holdRows(["t"], [{ id: "a", t: "x" }, { id: "b" }]);
  applyToHeld(small, { schema: { fields: [{ name: "t", type: "string" }] } }, [{ op: "set", table: "t", row: "a", field: "t", to: "y" }, { op: "insert", table: "t", row: "c", values: { id: "c" }, after: "a" }, { op: "move", table: "t", row: "b", after: null }, { op: "delete", table: "t", row: "c", values: { id: "c" } }]);
}
const held = holdRows(
  schema.fields.map((f) => f.name),
  rows,
);
const one = (i: number): BundleChange => ({ op: "set", table: "t", row: ids[at(i)]!, field, to: `edited ${i}` });
say("engine", "one cell", await timed((i) => applyToHeld(held, table, [one(i) as never])));
say(
  "engine",
  "a row added",
  await timed((i) => applyToHeld(held, table, [{ op: "insert", table: "t", row: `new-${i}`, values: { id: `new-${i}`, [field]: "new" }, after: ids[at(i)]! }])),
);
say("engine", "a row moved", await timed((i) => applyToHeld(held, table, [{ op: "move", table: "t", row: ids[at(i) + 1]!, after: ids[100 + i]! }])));
say(
  "engine",
  "a row removed",
  await timed((i) => applyToHeld(held, table, [{ op: "delete", table: "t", row: ids[at(i) + 2]!, values: rows[at(i) + 2]! }])),
);

// With the problems the edit made and ended asked for, as an app asks on every edit.
const problemsInput = { schema: { ...schema, fields: schema.fields.map((f) => ({ ...f, choices: enumValues(f) })) }, bodies: [], attachments: null, targets: {} };
say("engine, with problems", "one cell", await timed((i) => applyToHeld(held, table, [{ ...one(i), row: ids[at(i) + 5]! } as never], { problems: problemsInput })));
// Memory with every problem found again: slow enough with strict rules to leave out (SKIP_MEMORY=1).
if (!process.env.SKIP_MEMORY) say("memory: withCell + problemsOf", "one cell", await timed((i) => problemsOf(withCell(table, ids[at(i)]!, field, `edited ${i}`), "t")));

// Memory, as today.
say("memory: withCell", "one cell", await timed((i) => withCell(table, ids[at(i)]!, field, `edited ${i}`)));
const bundle: ParsedBundle = { path: "", meta: {} as never, tables: { t: table } };
say("memory: applyChanges", "one cell", await timed((i) => applyChanges(bundle, [one(i)])));
say("memory: applyChanges", "a row added", await timed((i) => applyChanges(bundle, [{ op: "insert", table: "t", row: `new-${i}`, values: { id: `new-${i}`, [field]: "new" }, after: ids[at(i)]! }])));
say("memory: applyChanges", "a row moved", await timed((i) => applyChanges(bundle, [{ op: "move", table: "t", row: ids[at(i) + 1]!, after: ids[100 + i]! }])));
say("memory: applyChanges", "a row removed", await timed((i) => applyChanges(bundle, [{ op: "delete", table: "t", row: ids[at(i) + 2]!, values: rows[at(i) + 2]! }])));

// The index, as today.
const dir = mkdtempSync(join(tmpdir(), "engine-apply-"));
try {
  const db = openNodeDatabase(join(dir, "index.sqlite"));
  const size = parts.reduce((n, p) => n + p.size, 0);
  await buildIndexFromBytes(db, { name: "t", schema, rows: { files: parts.map((p) => ({ name: p.name.split("/").pop()!, chunks: p.chunks() })), size }, key: "k", commitEvery: 50_000 });
  say("index: putRows", "one cell", await timed((i) => putRows(db, { name: "t", schema, rows: [{ ...rows[at(i)]!, [field]: `edited ${i}` }], key: `k${i}` })));
  say("index: putRows", "a row added", await timed((i) => putRows(db, { name: "t", schema, rows: [{ id: `new-${i}`, [field]: "new" }], at: { [`new-${i}`]: at(i) + 1 }, key: `a${i}` })));
  say("index: removeRows", "a row removed", await timed((i) => removeRows(db, { name: "t", schema, ids: [ids[at(i) + 2]!], key: `r${i}` })));
  await (db as unknown as { close?: () => Promise<void> }).close?.();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
