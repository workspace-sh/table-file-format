import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "./types.js";

export async function parseTable(dir: string): Promise<ParsedTable> {
  const schema = await readJson<TableSchema>(join(dir, "schema.json"));
  const rows = await readNdjson(join(dir, "rows.ndjson"));
  const views = (await readJsonOptional<View[]>(join(dir, "views.json"))) ?? [];
  const meta = (await readJsonOptional<TableMeta>(join(dir, "meta.json"))) ?? {};

  return { schema, rows, views, meta, path: dir };
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
