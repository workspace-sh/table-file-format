// A large table's problems found by the engine from the rows it holds (table-file-format#867,
// step 2b), against problemsOf in memory:
//
//   node --conditions=source --import tsx edn/bench/engine-problems.mts <file.table> <wasm|native> [strict]
//
// "strict" adds constraints most rows break (amount at most 50,000, a unique title, a note of at
// most 10 characters), for a table with many problems. Memory makes every problem (what an app
// does today for a table it holds); the engine says how many of each kind, then makes the first
// 200 into Problems, as a person opening the table sees them.

import { readFileSync } from "node:fs";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { call, callBytes, setFormulaEngine } from "../../packages/core/src/engine.ts";
import { heldProblems, type HeldRows } from "../../packages/core/src/engineViews.ts";
import { problemsOf } from "../../packages/core/src/problems.ts";
import { readZip, type RawZipEntry } from "../../packages/core/src/zip.ts";
import type { ParsedTable } from "../../packages/core/src/types.ts";

const [file, binding, strict] = process.argv.slice(2) as [string, "wasm" | "native", string | undefined];
setFormulaEngine((await loadEdn({ binding })) as never);
const bytes = new Uint8Array(readFileSync(file));
const read = Object.values((await readTableArchive(bytes)).tables)[0]!;
const fields = read.schema.fields.map((f) =>
  !strict ? f
  : f.name === "amount" ? { ...f, constraints: { ...f.constraints, maximum: 50000 } }
  : f.name === "title" ? { ...f, constraints: { ...f.constraints, unique: true } }
  : f.name === "note" ? { ...f, constraints: { ...f.constraints, maxLength: 10 } }
  : f,
);
const table: ParsedTable = { ...read, schema: { ...read.schema, fields } };

const raws = new Map<string, RawZipEntry>();
readZip(bytes, { lazy: (name) => name.includes("/rows/"), raw: (e) => void raws.set(e.name, e) });
const handle = call<number>("rows.new", { fields: fields.map((f) => f.name) });
for (const e of [...raws.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) callBytes("rows.read", { handle, file: e.name, method: e.method, size: e.size, crc: e.crc }, e.raw);
const held: HeldRows = { handle, fields: fields.map((f) => f.name) };

const time = <T,>(f: () => T): [T, number] => {
  const s = performance.now();
  const v = f();
  return [v, Math.round((performance.now() - s) * 10) / 10];
};
const [all, memory] = time(() => problemsOf(table, "deals"));
// Each time a new query, so nothing is kept from the time before.
let n = 0;
const fresh = () => heldProblems(held, { ...table, schema: { ...table.schema, fields: table.schema.fields.map((f) => ({ ...f, description: `run ${n++}` })) } }, "deals")!;
const [counted, counts] = time(fresh);
const [first] = time(() => counted.problems(0, 200));
const window = time(() => counted.problems(0, 200))[1];
if (counted.total !== all.length) throw new Error(`the engine found ${counted.total}, memory ${all.length}`);
if (JSON.stringify(first) !== JSON.stringify(all.slice(0, 200))) throw new Error("the first 200 differ");
console.log(JSON.stringify({ file: file.split("/").pop(), binding, strict: !!strict, problems: all.length, "memory, every problem (ms)": memory, "engine, counted (ms)": counts, "engine, 200 problems made (ms)": window }));
