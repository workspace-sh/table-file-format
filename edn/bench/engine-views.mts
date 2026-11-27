// A view of a large table worked out by the engine from the rows it holds (table-file-format#867,
// step 2), against the same view worked out in memory (applyView, searchRows, memoryViewRows):
//
//   node --conditions=source --import tsx edn/bench/engine-views.mts <file.table> <wasm|native>
//
// Each view is timed from asking to having its window of 200 rows from the middle, its totals and
// its groups: what a screen needs to draw it. The table's formula fields are left out on both
// sides, since a held table doesn't work formulas out yet (step 4).

import { readFileSync } from "node:fs";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { call, callBytes, setFormulaEngine } from "../../packages/core/src/engine.ts";
import { heldViewRows, type HeldRows } from "../../packages/core/src/engineViews.ts";
import { applyView, searchRows } from "../../packages/core/src/query.ts";
import { memoryViewRows, type ViewRows } from "../../packages/core/src/row-source.ts";
import { readZip, type RawZipEntry } from "../../packages/core/src/zip.ts";
import type { IndexQuery } from "../../packages/core/src/indexer.ts";
import type { ParsedTable, View } from "../../packages/core/src/types.ts";

const [file, binding] = process.argv.slice(2) as [string, "wasm" | "native"];
setFormulaEngine((await loadEdn({ binding })) as never);
const bytes = new Uint8Array(readFileSync(file));

const read = Object.values((await readTableArchive(bytes)).tables)[0]!;
const table: ParsedTable = { ...read, schema: { ...read.schema, fields: read.schema.fields.filter((f) => !f.computed) } };
const fields = table.schema.fields.map((f) => f.name);

// The engine's own read, from the archive's compressed rows files.
const raws = new Map<string, RawZipEntry>();
readZip(bytes, { lazy: (name) => name.includes("/rows/"), raw: (e) => void raws.set(e.name, e) });
const handle = call<number>("rows.new", { fields });
for (const e of [...raws.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) callBytes("rows.read", { handle, file: e.name, method: e.method, size: e.size, crc: e.crc }, e.raw);
const held: HeldRows = { handle, fields };

const views: [string, IndexQuery][] = [
  ["file order", {}],
  ["sort by amount, desc", { sort: [{ field: "amount", direction: "desc" }] }],
  ["sort by title", { sort: [{ field: "title", direction: "asc" }] }],
  ["won, by close date", { filter: [{ field: "stage", operator: "eq", value: "won" }], sort: [{ field: "close_date", direction: "asc" }] }],
  ["grouped by stage, with totals", { group: "stage", totals: { amount: "sum", probability: "average", title: "count" } }],
  ["search", { search: "orbit audit 1" }],
  ["amount over 10,000, won or lost", { filter: [{ field: "amount", operator: "gt", value: 10000 }, { field: "stage", operator: "in", value: ["won", "lost"] }] }],
];

/** What a screen reads to draw a view. */
async function draw(v: ViewRows): Promise<number> {
  const middle = Math.max(0, Math.floor(v.count / 2) - 100);
  const rows = await v.rows(middle, middle + 200);
  await v.totals();
  await v.groups();
  return rows.length;
}

function memory(q: IndexQuery): ViewRows {
  const view: View = { id: "v", name: "v", layout: "table", ...(q.filter ? { filter: q.filter } : {}), ...(q.sort ? { sort: q.sort } : {}) };
  const inView = applyView(table, view);
  const shown = q.search ? searchRows(inView, q.search, { schema: table.schema }) : inView;
  return memoryViewRows(shown, { inView: inView.length, schema: table.schema, ...(q.group ? { group: q.group } : {}), ...(q.totals ? { totals: q.totals } : {}) });
}

const median = async (f: () => Promise<unknown>) => {
  const times: number[] = [];
  for (let i = 0; i < 6; i++) {
    const s = performance.now();
    await f();
    if (i > 0) times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[2]! * 10) / 10;
};

const out: Record<string, unknown> = { file: file.split("/").pop(), binding, rows: table.rows.length };
for (const [name, q] of views) {
  const engine = heldViewRows(held, table, q);
  if (!engine) throw new Error(`the engine didn't answer ${name}`);
  const [a, b] = [memory(q), engine];
  if (a.count !== b.count || JSON.stringify(await a.rows(0, 50)) !== JSON.stringify(await b.rows(0, 50))) throw new Error(`${name}: the engine and memory differ`);
  out[name] = { memory: await median(() => draw(memory(q))), engine: await median(() => draw(heldViewRows(held, table, q)!)) };
}
console.log(JSON.stringify(out));
