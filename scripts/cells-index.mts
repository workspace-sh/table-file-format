// A large table with many cells' own formulas, through the index as Linux
// holds it (#640, D52): build, read a sorted view, give a cell a formula,
// and save, each timed, with the peak resident size.
//
//   npx tsx scripts/cells-index.mts <bundle.table> <table> <how many cells>
//
// Writes <table>/cells/0001.ndjson first: every nth row's computed field
// `weighted` given a formula of its own, each different.

import { mkdirSync, readFileSync, writeFileSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openIndexHost } from "../packages/app/src/nodeIndex.ts";
import { indexedViewRows, makeIndexEdits } from "../packages/app/src/indexed.ts";
import { readBundle } from "../packages/core/src/io.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";
import { rowsFileOrder } from "../packages/core/src/rowFiles.ts";
import { readdirSync } from "node:fs";

const [bundle, name, want] = process.argv.slice(2) as [string, string, string];
const dir = join(bundle, "tables", name);
const count = Number(want);
const ids: string[] = [];
for (const file of rowsFileOrder(readdirSync(join(dir, "rows")))) {
  for await (const line of createInterface({ input: createReadStream(join(dir, "rows", file)) })) {
    if (line.trim()) ids.push(JSON.parse(line).id as string);
  }
}
const every = Math.max(1, Math.floor(ids.length / count));
let text = "";
let made = 0;
for (let i = 0; i < ids.length && made < count; i += every, made++) text += `${JSON.stringify({ id: ids[i], field: "weighted", expr: `(* amount ${(made % 997) / 1000 + 0.001})` })}\n`;
mkdirSync(join(dir, "cells"), { recursive: true });
writeFileSync(join(dir, "cells", "0001.ndjson"), text);
console.log(`${ids.length} rows, ${made} cells' formulas (${Math.round(text.length / 1e6)} MB)`);

const mb = () => `${Math.round(process.resourceUsage().maxRSS / 1024)} MB peak`;
const time = async <T,>(what: string, work: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  const out = await work();
  console.log(`${what}: ${((performance.now() - t) / 1000).toFixed(2)} s, ${mb()}`);
  return out;
};
const held = (await readBundle(nodeFs, bundle, { rowsElsewhere: (d) => d === dir })).tables[name]!;
const host = openIndexHost(bundle);
await time("build", () => host.ensure(name, dir));
const view = { ...held.views[0]!, sort: [{ field: "weighted", direction: "desc" as const }] };
const top = await time("sorted by weighted, first 200", async () => (await indexedViewRows(host, name, held, view, "")).rows(0, 200));
console.log(`  top: ${top.slice(0, 3).map((r) => `${r.id} ${r.weighted}`).join(", ")}`);
await time("a cell given a formula", () => makeIndexEdits(host, name, held, [{ kind: "formula", rowId: ids[1]!, field: "weighted", expr: "(* amount 9)" }]));
await time("save (rows and cells/)", () => host.save(name, dir, true));
console.log(`cells/ after: ${readFileSync(join(dir, "cells", "0001.ndjson"), "utf8").split("\n").filter(Boolean).length} lines`);
await host.close();
