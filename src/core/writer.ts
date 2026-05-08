import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "./types.js";
import { TABLE_FORMAT_VERSION } from "./types.js";

export interface WriteTableInput {
  schema: TableSchema;
  rows: Row[];
  views?: View[];
  meta?: TableMeta;
}

export async function writeTable(dir: string, input: WriteTableInput | ParsedTable): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "attachments"), { recursive: true });

  const meta: TableMeta = {
    format: "table",
    formatVersion: TABLE_FORMAT_VERSION,
    ...(input.meta ?? {}),
  };

  await writeFile(join(dir, "schema.json"), pretty(input.schema));
  await writeFile(join(dir, "rows.ndjson"), serializeNdjson(input.rows));
  await writeFile(join(dir, "views.json"), pretty(input.views ?? []));
  await writeFile(join(dir, "meta.json"), pretty(meta));
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function serializeNdjson(rows: Row[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
