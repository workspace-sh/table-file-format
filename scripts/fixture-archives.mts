// The example tables as .table.zip files, for the fixtures repository (workspace-sh/workspace-fixtures,
// Fixtures/table/) and anyone who wants to open one as a file:
//
//   npx tsx scripts/fixture-archives.mts <folder holding crm.table, household-budget.table, projects.table, shop.table>
//
// Writes <name>.table.zip beside each folder. Each is the whole folder, attachments included (the
// reference archive writer leaves them out, SPEC section 13, and the CRM's logos are attachments), under
// one <name>.table/ root, entries in a fixed order (the manifest first) with a fixed time: the same
// folder always gives the same bytes. Each is then read back two ways, and says so: unzipped it is the
// folder byte for byte, and opened as an app opens an archive it is the same tables as the folder.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync, unzipSync } from "fflate";
import { readBundle } from "../packages/core/src/io.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";
import { openArchive } from "../packages/app/src/tableFiles.ts";

const dir = process.argv[2]!;
const names = ["crm", "household-budget", "projects", "shop"];
const FIXED = new Date(Date.UTC(2026, 9, 14, 0, 0, 0));
const walk = (at: string): string[] => readdirSync(at).flatMap((n) => (statSync(join(at, n)).isDirectory() ? walk(join(at, n)) : [join(at, n)]));
for (const name of names) {
  const folder = join(dir, `${name}.table`);
  const files = walk(folder).map((f) => relative(folder, f)).filter((p) => !p.endsWith("index.sqlite")).sort((a, b) => (a === "meta.json" ? -1 : b === "meta.json" ? 1 : a < b ? -1 : 1));
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const p of files) entries[`${name}.table/${p}`] = [new Uint8Array(readFileSync(join(folder, p))), { mtime: FIXED }];
  const zip = zipSync(entries, { level: 9 });
  const out = join(dir, `${name}.table.zip`);
  writeFileSync(out, zip);
  // 1. Unzipped, it is the folder, byte for byte.
  const back = unzipSync(zip);
  const same = files.every((p) => Buffer.compare(Buffer.from(back[`${name}.table/${p}`]!), readFileSync(join(folder, p))) === 0) && Object.keys(back).length === files.length;
  // 2. Opened as an app opens an archive, it is the same tables as the folder read from disk.
  const fromDisk = await readBundle(nodeFs, folder);
  const opened = (await openArchive(zip, [])).bundle;
  const tablesOf = (b: { tables: Record<string, { rows: unknown[]; views: unknown[]; schema: unknown; bodies?: unknown }> }) =>
    JSON.stringify(Object.fromEntries(Object.entries(b.tables).sort().map(([k, t]) => [k, { rows: t.rows, views: t.views, schema: t.schema, bodies: t.bodies ?? {} }])));
  const agree = tablesOf(fromDisk as never) === tablesOf(opened as never);
  console.log(`${name}.table.zip ${zip.length} bytes, ${files.length} files, unzips to the folder: ${same}, opens as the folder reads: ${agree}, sha256 ${createHash("sha256").update(zip).digest("hex")}`);
}
