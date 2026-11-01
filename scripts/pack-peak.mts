// The memory a single-file save takes (#622): packs a .table folder into a
// single file with packTableFileFrom, as iOS, the Mac and Linux save one,
// and prints the peak resident size (BENCHMARKING.md).
//
//   npx tsx scripts/pack-peak.mts <folder> <target>
//
// With no file at <target>, every file is compressed: the whole pack. With
// one there (packed from the same folder), only the files that changed
// since are: the save after an edit. Run each in its own process, so the
// peak is that pack's alone.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { packTableFileFrom } from "../packages/core/src/document.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";

const [folder, target] = process.argv.slice(2);
if (!folder || !target) {
  console.error("usage: npx tsx scripts/pack-peak.mts <folder> <target>");
  process.exit(1);
}
const kind = existsSync(target) ? "after an edit" : "whole";
const before = process.resourceUsage().maxRSS;
const t = performance.now();
await packTableFileFrom(nodeFs, resolve(folder), resolve(target));
const ms = performance.now() - t;
const mb = (kb: number) => `${Math.round(kb / 1024)} MB`;
console.log(`pack (${kind}): ${(ms / 1000).toFixed(1)} s, peak resident ${mb(process.resourceUsage().maxRSS)} (${mb(before)} before packing)`);
