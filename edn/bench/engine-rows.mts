// Reading a table's rows through the engine (table-file-format#867, step 1), against the
// TypeScript reader, on one binding, one variant per process so its peak memory is its own:
//
//   node --conditions=source --import tsx edn/bench/engine-rows.mts <file.table> <wasm|native> <variant>
//
// Variants:
//   typescript  readTableArchive as today
//   engine      readTableArchive with the switch on: the engine reads, and the rows come back as objects
//   held        the engine reads the rows files and holds them; nothing comes back
//   window      held, then 200 rows from the middle, crossing back as typed arrays, made rows

import { readFileSync } from "node:fs";
import { loadEdn } from "../js/src/index.ts";
import { readTableArchive } from "../../packages/core/src/archive.ts";
import { call, callBytes, callWindow, setFormulaEngine, setRowsThroughEngine } from "../../packages/core/src/engine.ts";
import { rowsOf } from "../../packages/core/src/engineRows.ts";
import { readZip, type RawZipEntry } from "../../packages/core/src/zip.ts";
import { memoryViewRows } from "../../packages/core/src/row-source.ts";
import type { Row } from "../../packages/core/src/types.ts";

const [file, binding, variant] = process.argv.slice(2) as [string, "wasm" | "native", string];
const engine = await loadEdn({ binding });
setFormulaEngine(engine as never);
const bytes = new Uint8Array(readFileSync(file));
const base = process.resourceUsage().maxRSS;
const out: Record<string, unknown> = { file: file.split("/").pop(), binding, variant };
const ms = (start: number) => Math.round((performance.now() - start) * 10) / 10;

/** The engine holding the archive's first table's rows, its schema's fields as columns: its handle, and how many. */
function held(): { handle: number; count: number; fields: string[] } {
  const raws = new Map<string, RawZipEntry>();
  const entries = readZip(bytes, { lazy: (name) => name.includes("/rows/"), raw: (e) => void raws.set(e.name, e) });
  const schema = entries.find((e) => e.name.endsWith("/schema.json"));
  const fields = schema && "data" in schema ? (JSON.parse(new TextDecoder().decode(schema.data)) as { fields: { name: string }[] }).fields.map((f) => f.name) : [];
  const handle = call<number>("rows.new", { fields });
  for (const e of [...raws.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    callBytes("rows.read", { handle, file: e.name, method: e.method, size: e.size, crc: e.crc }, e.raw);
  }
  return { handle, count: call<number>("rows.count", { handle }), fields };
}

if (variant === "typescript" || variant === "engine") {
  setRowsThroughEngine(variant === "engine");
  const start = performance.now();
  const bundle = await readTableArchive(bytes);
  out["open (ms)"] = ms(start);
  const rows = Object.values(bundle.tables)[0]!.rows;
  out.rows = rows.length;
  (globalThis as { keep?: unknown }).keep = bundle;
  // Today's window: the rows are already objects, so it's a slice.
  const source = memoryViewRows(rows);
  const times: number[] = [];
  for (let i = 0; i < 101; i++) {
    const from = Math.floor(rows.length / 2) - 100 + (i % 7);
    const s = performance.now();
    void source.rows(from, from + 200);
    if (i > 0) times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  out["200 rows, as today (ms, median of 100)"] = Math.round(times[50]! * 1000) / 1000;
} else {
  const start = performance.now();
  const h = held();
  out["read and held (ms)"] = ms(start);
  out.rows = h.count;
  out["held (MB)"] = Math.round(call<number>("rows.bytes", { handle: h.handle }) / 1e6);
  if (variant === "window") {
    const times: number[] = [];
    let made: Row[] = [];
    for (let i = 0; i < 101; i++) {
      const from = Math.floor(h.count / 2) - 100 + (i % 7);
      const s = performance.now();
      made = [];
      rowsOf(callWindow("rows.window", { handle: h.handle, from, to: from + 200 }), h.fields, made);
      if (i > 0) times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    out["200 rows across, made rows (ms, median of 100)"] = Math.round(times[50]! * 1000) / 1000;
    out.made = made.length;
  }
}
const heap = process.memoryUsage();
out["JS heap (MB)"] = Math.round(heap.heapUsed / 1e6);
out["peak RSS over reading the file (MB)"] = Math.round((process.resourceUsage().maxRSS - base) / 1024);
console.log(JSON.stringify(out));
