import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "./types";

export async function parseTable(dir: string): Promise<ParsedTable> {
  const schema = await readJson<TableSchema>(join(dir, "schema.json"));
  const rows = await readNdjson(join(dir, "rows.ndjson"));
  const views = (await readJsonOptional<View[]>(join(dir, "views.json"))) ?? [];
  const meta = (await readJsonOptional<TableMeta>(join(dir, "meta.json"))) ?? {};
  const bodies = await readBodies(join(dir, "bodies"));

  const parsed: ParsedTable = { schema, rows, views, meta, path: dir };
  if (bodies) parsed.bodies = bodies;
  return parsed;
}

async function readBodies(dir: string): Promise<Record<string, string> | undefined> {
  if (!existsSync(dir)) return undefined;
  const entries = await readdir(dir, { withFileTypes: true });
  const bodies: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const id = entry.name.slice(0, -".md".length);
    bodies[id] = await readFile(join(dir, entry.name), "utf8");
  }
  return Object.keys(bodies).length > 0 ? bodies : undefined;
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonOptional<T>(path: string): Promise<T | undefined> {
  if (!existsSync(path)) return undefined;
  return readJson<T>(path);
}

async function readNdjson(path: string): Promise<Row[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const rows: Row[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    const obj = JSON.parse(line) as Row;
    if (typeof obj.id !== "string") {
      throw new Error(`row missing system id: ${line.slice(0, 80)}`);
    }
    rows.push(obj);
  }
  return rows;
}
