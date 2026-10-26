// A long table, not a large one: 1,000 books, the same every time (seeded),
// written as fixtures/library.table. Long enough to scroll past a screen or
// two, to see a long table's layout and how its header scrolls, and small
// enough to sit with the other fixtures and load instantly. A large table
// (10,000 rows and up) is scripts/big-table.mts.
//
//   node --conditions=source --import tsx scripts/long-table.mts
//
// Then `npm run fixtures:generate` bundles it for the apps.

import { rmSync } from "node:fs";
import { join } from "node:path";
import { fixtureId } from "./fixture-ids.mts";
import { writeBundleTo } from "../packages/core/src/io.ts";
import { nodeFs } from "../packages/core/src/node-fs.ts";
import type { Row, TableSchema, View } from "../packages/core/src/types.ts";

const ROWS = 1000;
const out = join(import.meta.dirname, "..", "fixtures", "library.table");

// mulberry32: small, seeded, the same on every run.
let seed = 0x11b7a7;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
const between = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));

const adjectives = ["Quiet", "Distant", "Silver", "Northern", "Hidden", "Paper", "Last", "Open", "Burning", "Patient", "Salt", "Winter", "Glass", "Second", "Long", "Small", "Golden", "Late", "Wild", "Common"];
const nouns = ["Harbour", "Garden", "Archive", "Mountain", "River", "Engine", "Library", "Season", "Atlas", "Bridge", "Signal", "Orchard", "Lantern", "Map", "Island", "Workshop", "Tide", "Field", "Machine", "Letter"];
const firsts = ["Ada", "Ben", "Chloe", "Dev", "Elif", "Femi", "Grace", "Hiro", "Ines", "Jonah", "Kemi", "Luca", "Maya", "Nils", "Oona", "Priya", "Quinn", "Rosa", "Sami", "Tomas"];
const lasts = ["Abara", "Brandt", "Costa", "Dube", "Eriksen", "Fong", "Garcia", "Haddad", "Ito", "Jensen", "Kovac", "Laine", "Mensah", "Novak", "Okafor", "Petrov", "Quist", "Reyes", "Sato", "Tan"];
const genres = ["fiction", "history", "science", "poetry", "biography", "philosophy", "travel", "design"] as const;

function title(): string {
  switch (between(0, 2)) {
    case 0:
      return `The ${pick(adjectives)} ${pick(nouns)}`;
    case 1:
      return `${pick(nouns)} of the ${pick(adjectives)} ${pick(nouns)}`;
    default:
      return `${pick(adjectives)} ${pick(nouns)}s`;
  }
}

const rows: Row[] = [];
const seen = new Set<string>();
for (let i = 1; rows.length < ROWS; i++) {
  let name = title();
  // Titles are the primary key: a repeat gets a volume number.
  if (seen.has(name)) name = `${name}, volume ${between(2, 4)}`;
  if (seen.has(name)) continue;
  seen.add(name);
  const added = new Date(Date.UTC(2024, 0, 1) + between(0, 1000) * 86_400_000).toISOString().slice(0, 10);
  const row: Row = {
    id: fixtureId(`row/b${rows.length + 1}`),
    title: name,
    author: `${pick(firsts)} ${pick(lasts)}`,
    genre: pick(genres),
    year: between(1925, 2026),
    pages: between(96, 880),
    price: Math.round((6 + random() * 34) * 100) / 100,
    read: random() < 0.45,
    added,
  };
  // Some books are unrated: an empty cell, as a real list has.
  if (random() < 0.8) row.rating = between(1, 5);
  rows.push(row);
}

const schema: TableSchema = {
  fields: [
    { name: "title", type: "string", constraints: { required: true } },
    { name: "author", type: "string" },
    { name: "genre", type: "string", constraints: { enum: [...genres] } },
    { name: "year", type: "integer", constraints: { minimum: 1900, maximum: 2100 } },
    { name: "pages", type: "integer", constraints: { minimum: 1 } },
    { name: "price", type: "number", format: "currency:GBP" },
    { name: "rating", type: "integer", constraints: { minimum: 1, maximum: 5 } },
    { name: "read", type: "boolean" },
    { name: "added", type: "date" },
  ],
  primaryKey: ["title"],
  "schema-version": 1,
};

const views: View[] = [
  { id: fixtureId("view/all"), name: "All books", layout: "table", sort: [{ field: "title", direction: "asc" }] },
  { id: fixtureId("view/genre"), name: "By genre", layout: "board", board_field: "genre", fields: ["title", "author", "year"] },
  { id: fixtureId("view/unread"), name: "To read", layout: "table", filter: [{ field: "read", operator: "eq", value: false }], sort: [{ field: "added", direction: "desc" }] },
  { id: fixtureId("view/recent"), name: "Recently added", layout: "table", sort: [{ field: "added", direction: "desc" }] },
];

// Written by core, as an app saves a table: field ids (D62), the rows files (D51), the canonical form.
rmSync(out, { recursive: true, force: true });
await writeBundleTo(nodeFs, out, {
  meta: {
    title: "Library",
    description: "A long list: 1,000 books, for scrolling a long table and its header.",
    tables: ["books"],
    created_at: "2026-10-14T00:00:00Z",
    modified_at: "2026-10-14T00:00:00Z",
  },
  tables: { books: { schema, rows, views, meta: { title: "Books" } } },
});
console.log(`wrote ${rows.length} rows to ${out}`);
