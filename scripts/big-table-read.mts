// The data side of opening a large table, without drawing it (#126):
// unzip and parse a big-<rows>.table.zip as the apps do (openArchive), then
// compute its view (formulas, filters, sort) as derive() does each render.
//
//   npx tsx scripts/big-table-read.mts <zip>

import { readFile } from "node:fs/promises";
import { openArchive } from "../packages/app/src/tableFiles.ts";
import { applyView } from "../packages/core/src/query.ts";

const bytes = new Uint8Array(await readFile(process.argv[2]!));
const t0 = performance.now();
const opened = await openArchive(bytes, []);
const t1 = performance.now();
const table = Object.values(opened.bundle.tables)[0]!;
const view = table.views[0]!;
const shown = applyView(table, view, {});
const t2 = performance.now();
const again = applyView(table, view, {});
const t3 = performance.now();
const heap = process.memoryUsage().heapUsed / 1e6;
console.log(JSON.stringify({ rows: table.rows.length, shown: shown.length + again.length * 0, readMs: Math.round(t1 - t0), viewMs: Math.round(t2 - t1), viewAgainMs: Math.round(t3 - t2), heapMB: Math.round(heap) }));
