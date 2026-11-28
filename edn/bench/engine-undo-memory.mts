// What 100 edits kept to undo cost (table-file-format#867, step 3b): the engine's exact inverses
// (rows.undoDepth's bytes) against today's whole-table snapshots, as appState keeps them (each
// step the table as it was: a new list of every row, the rows not edited shared).
//
//   node --expose-gc --conditions=source --import tsx edn/bench/engine-undo-memory.mts <file.table> <wasm|native> [rows]

import { readFileSync } from "node:fs";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { setFormulaEngine } from "../../packages/core/src/engine.ts";
import { applyToHeld, undoDepth } from "../../packages/core/src/engineEdits.ts";
import { holdRows } from "../../packages/core/src/engineViews.ts";
import { readZip, type LazyZipEntry } from "../../packages/core/src/zip.ts";
import { withCell } from "../../packages/app/src/edits.ts";
import type { ParsedTable, Row } from "../../packages/core/src/types.ts";

const [file, binding, count] = process.argv.slice(2) as [string, "wasm" | "native", string | undefined];
const N = Number(count ?? 100_000);
setFormulaEngine((await loadEdn({ binding })) as never);
const bytes = new Uint8Array(readFileSync(file));
const read = Object.values((await readTableArchive(bytes, { rows: "later" })).tables)[0]!;
const parts = readZip(bytes, { lazy: (name) => name.includes("/rows/") })
  .filter((e) => e.name.includes("/rows/"))
  .sort((a, b) => (a.name < b.name ? -1 : 1)) as unknown as (LazyZipEntry & { name: string })[];
const rows: Row[] = [];
const decoder = new TextDecoder();
outer: for (const p of parts) {
  let text = "";
  for await (const c of p.chunks()) text += decoder.decode(c, { stream: true });
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as Row);
    if (rows.length === N) break outer;
  }
}
const field = read.schema.fields.find((f) => f.type === "string" && !f.computed)!.name;
const table = { ...read, rows } as ParsedTable;
const gc = () => (globalThis as { gc?: () => void }).gc?.();
const heap = () => (gc(), process.memoryUsage().heapUsed);

// Today: 100 one-cell edits, each step the table before it.
const before = heap();
const past: ParsedTable[] = [];
let now = table;
for (let i = 0; i < 100; i++) {
  past.push(now);
  now = withCell(now, rows[(i * 997) % N]!.id, field, `edited ${i}`);
}
const snapshots = heap() - before;
past.length = 0;

// The engine: the same edits, each kept to undo as its inverse.
const held = holdRows(
  read.schema.fields.map((f) => f.name),
  rows,
);
for (let i = 0; i < 100; i++) applyToHeld(held, table, [{ op: "set", table: "t", row: rows[(i * 997) % N]!.id, field, to: `edited ${i}` }]);
const one = undoDepth(held);
// And 100 that each take out a row.
for (let i = 0; i < 100; i++) {
  const r = rows[(i * 991 + 5) % N]!;
  applyToHeld(held, table, [{ op: "delete", table: "t", row: r.id, values: r }], { keep: 200 });
}
const both = undoDepth(held);
console.log(
  JSON.stringify({
    binding,
    rows: N,
    "today, 100 one-cell snapshots (MB)": +(snapshots / 1e6).toFixed(2),
    "engine, 100 one-cell inverses (KB)": +(one.bytes / 1e3).toFixed(1),
    "engine, and 100 rows removed (KB)": +(both.bytes / 1e3).toFixed(1),
    steps: both.undo,
  }),
);
