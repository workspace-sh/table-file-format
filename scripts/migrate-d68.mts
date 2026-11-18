// Rewrites every .table under a folder into D68's form, in place: a field's
// display token moves from `format` to `display` (`url` becomes `format:
// "uri"`), and its choices from `constraints.enum` to `categories`. Nothing
// else changes, and a table already in that form is left alone.
//
//   node --conditions=source --import tsx scripts/migrate-d68.mts <folder> [--check]
//
// A .table folder has each of its schema.json files rewritten, and only
// those. A single-file .table is read and written again whole. --check
// changes nothing and lists what would change; it exits 1 when anything
// would. Readers take the old form too, so a table this misses still opens,
// and is written in the new form the next time it's saved.
import { readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { strFromU8 } from "fflate";
import { canonicalSchema, readTableArchive, writeTableArchive, type TableSchema } from "../packages/core/src/index.ts";
import { readZip } from "../packages/core/src/zip.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const root = args.find((a) => !a.startsWith("--"));
if (!root) {
  console.error("usage: migrate-d68.mts <folder> [--check]");
  process.exit(1);
}

const SKIP = new Set(["node_modules", ".git", ".Trash"]);
const changed: string[] = [];
const failed: string[] = [];

function writeAtomically(path: string, data: string | Uint8Array): void {
  const temp = `${path}.d68-${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

function migrateFolder(dir: string): void {
  const tables = join(dir, "tables");
  let names: string[];
  try {
    names = readdirSync(tables);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(tables, name, "schema.json");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    try {
      const schema = JSON.parse(text) as TableSchema;
      const next = canonicalSchema(schema);
      if (next === schema) continue;
      changed.push(path);
      if (!check) writeAtomically(path, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      failed.push(`${path}: ${String(error)}`);
    }
  }
}

async function migrateFile(path: string): Promise<void> {
  try {
    const bytes = new Uint8Array(readFileSync(path));
    // Reading puts a schema in the new form, so look at the schemas as stored.
    const old = readZip(bytes).some((e) => {
      if (!e.name.endsWith("/schema.json")) return false;
      const schema = JSON.parse(strFromU8(e.data)) as TableSchema;
      return canonicalSchema(schema) !== schema;
    });
    if (!old) return;
    const bundle = await readTableArchive(bytes);
    const written = await writeTableArchive(basename(path), bundle);
    changed.push(path);
    if (!check) writeAtomically(path, written);
  } catch (error) {
    failed.push(`${path}: ${String(error)}`);
  }
}

async function walk(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (entry.endsWith(".table")) {
      if (isDir) migrateFolder(path);
      else await migrateFile(path);
    } else if (isDir) {
      await walk(path);
    }
  }
}

await walk(root);
for (const path of changed) console.log(`${check ? "would change" : "changed"} ${path}`);
for (const line of failed) console.error(`could not read ${line}`);
console.log(`${changed.length} ${check ? "to change" : "changed"}, ${failed.length} unreadable`);
process.exit(check && changed.length > 0 ? 1 : failed.length > 0 ? 2 : 0);
