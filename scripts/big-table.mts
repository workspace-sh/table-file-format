// A large .table for measuring (LARGE-TABLES.md, #126): one "deals" table
// of N rows, the same every time (seeded), written as a .table folder and
// as a .table.zip packed by table-app, as an app would open it.
//
//   npx tsx scripts/big-table.mts <rows> <out-dir>
//
// Writes <out-dir>/big-<rows>.table/ and <out-dir>/big-<rows>.table.zip.
// The rows are deal-shaped (about 200 bytes each): a title, a stage from
// six choices, an amount, a probability, an owner, a close date, a short
// note, and one formula column (weighted = amount × probability), so the
// formula engine is part of what's measured.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBundle } from "../packages/core/src/parser.ts";
import { bundleToArchive } from "../packages/app/src/tableFiles.ts";

const n = Number(process.argv[2]);
const out = process.argv[3];
if (!Number.isInteger(n) || n <= 0 || !out) {
  console.error("usage: npx tsx scripts/big-table.mts <rows> <out-dir>");
  process.exit(1);
}

// mulberry32: small, seeded, the same on every run.
let seed = 0x7ab1e;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;

const stages = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
const owners = ["leslie", "sam", "claude", "maya", "jonas", "priya", "ada", "kofi"];
const words = ["Atlas", "Northwind", "Lumen", "Tidal", "Quill", "Fern", "Harbor", "Summit", "Cedar", "Orbit", "Delta", "Echo"];
const kinds = ["renewal", "expansion", "pilot", "migration", "audit", "rollout", "support plan", "licence"];
const notes = ["Follow up next week.", "Waiting on procurement.", "Champion is keen.", "Needs a security review.", "Budget confirmed.", ""];

const name = `big-${n}`;
const dir = join(out, `${name}.table`);
const tableDir = join(dir, "tables", "deals");
await mkdir(tableDir, { recursive: true });

const now = "2026-10-02T00:00:00Z";
await writeFile(
  join(dir, "meta.json"),
  JSON.stringify({ format: "table", formatVersion: 1, title: `Big (${n.toLocaleString("en")} rows)`, tables: ["deals"], created_at: now, modified_at: now, generator: "scripts/big-table.ts" }, null, 2) + "\n",
);
await writeFile(join(tableDir, "meta.json"), JSON.stringify({ title: "Deals", created_at: now, modified_at: now }, null, 2) + "\n");
await writeFile(
  join(tableDir, "schema.json"),
  JSON.stringify(
    {
      fields: [
        { name: "title", type: "string", constraints: { required: true } },
        {
          name: "stage",
          type: "string",
          constraints: {
            enum: [
              { value: "lead", color: "gray" },
              { value: "qualified", color: "blue" },
              { value: "proposal", color: "purple" },
              { value: "negotiation", color: "orange" },
              { value: "won", color: "green" },
              { value: "lost", color: "red" },
            ],
          },
        },
        { name: "amount", type: "number", format: "currency" },
        { name: "probability", type: "number" },
        { name: "owner", type: "string" },
        { name: "close_date", type: "date" },
        { name: "note", type: "string" },
        { name: "weighted", type: "number", format: "currency", computed: { expr: "(round (* amount probability) 0)", dialect: "table-expr-v1" } },
      ],
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  join(tableDir, "views.json"),
  JSON.stringify([{ id: "all", name: "All deals", layout: "table" }], null, 2) + "\n",
);

// Rows in chunks, so a million is never one huge string in memory.
const lines: string[] = [];
let rows = "";
for (let i = 0; i < n; i++) {
  const month = 1 + Math.floor(random() * 12);
  const day = 1 + Math.floor(random() * 28);
  const row: Record<string, unknown> = {
    id: `d${i.toString(36)}`,
    title: `${pick(words)} ${pick(kinds)} ${i + 1}`,
    stage: pick(stages),
    amount: Math.round(random() * 200) * 500,
    probability: Math.round(random() * 100) / 100,
    owner: pick(owners),
    close_date: `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
  const note = pick(notes);
  if (note) row.note = note;
  lines.push(JSON.stringify(row));
  if (lines.length === 10_000) {
    rows += lines.join("\n") + "\n";
    lines.length = 0;
  }
}
if (lines.length) rows += lines.join("\n") + "\n";
await writeFile(join(tableDir, "rows.ndjson"), rows);

const bundle = await parseBundle(dir);
await writeFile(join(out, `${name}.table.zip`), await bundleToArchive(name, bundle));
console.log(`${name}: ${(Buffer.byteLength(rows) / 1e6).toFixed(1)} MB rows.ndjson`);
