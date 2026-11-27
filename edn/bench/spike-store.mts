// SPIKE (table-file-format#867): bytes of fixtures/large/big-1000000.table into the engine, against JavaScript.
// node spike.mts <root> <variant>: one variant per process, so its peak memory is its own.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [root, variant] = [process.argv[2]!, process.argv[3]!];
const file = `${root}/fixtures/large/big-1000000.table`;
const bytes = new Uint8Array(await readFile(file));
const base = process.resourceUsage().maxRSS;
const ms = (s: number) => Math.round(performance.now() - s);
const out: Record<string, unknown> = { variant };
if (variant === "js-open") {
  const { readTableArchive } = await import(`${root}/packages/core/src/archive.ts`);
  const s = performance.now();
  const b = await readTableArchive(bytes);
  out["open (ms)"] = ms(s);
  out.rows = Object.values(b.tables)[0]!.rows.length;
  (globalThis as any).keep = b;
} else if (variant === "js-stages") {
  const { readZip } = await import(`${root}/packages/core/src/zip.ts`);
  const { parseRowsText } = await import(`${root}/packages/core/src/parse-text.ts`);
  let s = performance.now();
  const entries = readZip(bytes);
  out["inflate (ms)"] = ms(s);
  const rowsFiles = entries.filter((e: any) => e.name.includes("/rows/")).sort((a: any, b: any) => (a.name < b.name ? -1 : 1));
  s = performance.now();
  const diagnostics: any[] = [];
  const seen = new Map();
  let n = 0;
  for (const e of rowsFiles) n += parseRowsText(new TextDecoder().decode(e.data), diagnostics, undefined, { seen }).length;
  out["parse (ms)"] = ms(s);
  out.rows = n;
} else {
  let api: any;
  let memory: () => number = () => 0;
  if (variant.startsWith("wasm")) {
    const w = await import(`${root}/edn/js/wasm/edn.js`);
    const exports = await w.default({ module_or_path: readFileSync(`${root}/edn/js/wasm/edn_bg.wasm`) });
    api = w;
    memory = () => exports.memory.buffer.byteLength;
  } else {
    api = createRequire(import.meta.url)(`${root}/edn/js/native/edn.darwin-arm64.node`);
  }
  if (variant.endsWith("-open")) {
    const s = performance.now();
    out.rows = api.spikeOpen(bytes);
    out["open (ms)"] = ms(s);
  } else {
    let s = performance.now();
    out["inflated MB"] = Math.round(api.spikeInflate(bytes) / 1e6);
    out["inflate (ms)"] = ms(s);
    const { readZip } = await import(`${root}/packages/core/src/zip.ts`);
    const entries = readZip(bytes);
    const schema = new TextDecoder().decode(entries.find((e: any) => e.name.endsWith("/schema.json"))!.data);
    const rowsFiles = entries.filter((e: any) => e.name.includes("/rows/")).sort((a: any, b: any) => (a.name < b.name ? -1 : 1));
    const all = new Uint8Array(rowsFiles.reduce((t: number, e: any) => t + e.data.length + 1, 0));
    let at = 0;
    for (const e of rowsFiles) { all.set(e.data, at); at += e.data.length; all[at++] = 10; }
    s = performance.now();
    out.rows = api.spikeParse(schema, all);
    out["parse (ms)"] = ms(s);
  }
  out["store MB"] = Math.round(api.spikeStoreBytes() / 1e6);
  if (variant.startsWith("wasm")) out["wasm memory MB"] = Math.round(memory() / 1e6);
}
const heap = process.memoryUsage();
out["JS heap MB"] = Math.round(heap.heapUsed / 1e6);
out["peak RSS MB"] = Math.round(process.resourceUsage().maxRSS / 1024);
out["peak RSS over the file read MB"] = Math.round((process.resourceUsage().maxRSS - base) / 1024);
console.log(JSON.stringify(out));
