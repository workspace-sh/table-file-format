// What a long session of edits adds to a held table (table-file-format#867, step 3a): the engine's
// bytes for a large table (rows.bytes) after many one-cell edits, before and after the first row is
// moved (which makes an order, so an edit's row is a new slot), and after pastes of many rows.
//
//   node --conditions=source --import tsx edn/bench/engine-edit-memory.mts <file.table> <wasm|native>

import { readFileSync } from "node:fs";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { call, setFormulaEngine } from "../../packages/core/src/engine.ts";
import { applyToHeld } from "../../packages/core/src/engineEdits.ts";
import { holdRows } from "../../packages/core/src/engineViews.ts";
import { readZip, type LazyZipEntry } from "../../packages/core/src/zip.ts";
import type { ParsedTable, Row } from "../../packages/core/src/types.ts";

const [file, binding] = process.argv.slice(2) as [string, "wasm" | "native"];
setFormulaEngine((await loadEdn({ binding })) as never);
const bytes = new Uint8Array(readFileSync(file));
const read = Object.values((await readTableArchive(bytes, { rows: "later" })).tables)[0]!;
const parts = readZip(bytes, { lazy: (name) => name.includes("/rows/") })
  .filter((e) => e.name.includes("/rows/"))
  .sort((a, b) => (a.name < b.name ? -1 : 1)) as unknown as (LazyZipEntry & { name: string })[];
const rows: Row[] = [];
const decoder = new TextDecoder();
for (const p of parts) {
  let text = "";
  for await (const c of p.chunks()) text += decoder.decode(c, { stream: true });
  for (const line of text.split("\n")) if (line.trim()) rows.push(JSON.parse(line) as Row);
}
const table = { ...read, rows } as ParsedTable;
const field = read.schema.fields.find((f) => f.type === "string" && !f.computed)!.name;
const held = holdRows(
  read.schema.fields.map((f) => f.name),
  rows,
);
const mb = () => +(call<number>("rows.bytes", { handle: held.handle }) / 1e6).toFixed(1);
const say = (what: string, from: number) => console.log(JSON.stringify({ binding, after: what, "engine (MB)": mb(), "added (MB)": +(mb() - from).toFixed(1) }));
const start = mb();
console.log(JSON.stringify({ binding, after: "read", "engine (MB)": start }));
let r = 7;
const pick = () => (r = (r * 1103515245 + 12345) % 2 ** 31) % rows.length;
for (let i = 0; i < 10_000; i++) applyToHeld(held, table, [{ op: "set", table: "t", row: rows[pick()]!.id, field, to: `edit ${i}` }]);
say("10,000 one-cell edits, rows in their slots", start);
const ordered = mb();
applyToHeld(held, table, [{ op: "move", table: "t", row: rows[10]!.id, after: rows[20]!.id }]);
for (let i = 0; i < 10_000; i++) applyToHeld(held, table, [{ op: "set", table: "t", row: rows[pick()]!.id, field, to: `again ${i}` }]);
say("a row moved, then 10,000 more one-cell edits", ordered);
const pasted = mb();
for (let p = 0; p < 10; p++) {
  const changes = Array.from({ length: 100_000 }, (_, i) => ({ op: "insert" as const, table: "t", row: `paste-${p}-${i}`, values: { ...rows[i]!, id: `paste-${p}-${i}` }, after: i === 0 ? rows[500_000]!.id : `paste-${p}-${i - 1}` }));
  applyToHeld(held, table, changes);
}
say("ten pastes of 100,000 rows", pasted);
console.log(JSON.stringify({ binding, "rows now": call<number>("rows.count", { handle: held.handle }), "rss (MB)": Math.round(process.memoryUsage().rss / 1e6) }));
