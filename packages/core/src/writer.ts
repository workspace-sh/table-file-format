import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTable, Row, TableMeta, TableSchema, View } from "./types";
import { TABLE_FORMAT_VERSION } from "./types";

export interface WriteTableInput {
  schema: TableSchema;
  rows: Row[];
  views?: View[];
  meta?: TableMeta;
  /**
   * Long-form markdown bodies, keyed by row.id.
   * Each entry becomes a `bodies/{id}.md` file.
   * On write, the bodies/ directory is wholesale-replaced — entries not
   * present in this map are deleted from disk. Use a future appendBody /
   * writeBody API for partial updates.
   */
  bodies?: Record<string, string>;
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
  await writeBodies(join(dir, "bodies"), input.bodies);
}

async function writeBodies(dir: string, bodies: Record<string, string> | undefined): Promise<void> {
  const entries = bodies ?? {};
  const haveAny = Object.keys(entries).length > 0;
  if (!haveAny) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    return;
  }

  await mkdir(dir, { recursive: true });

  // Wholesale replace: drop any existing .md files not in the input.
  const existing = await readdir(dir).catch(() => [] as string[]);
  for (const name of existing) {
    if (!name.endsWith(".md")) continue;
    const id = name.slice(0, -".md".length);
    if (!(id in entries)) {
      await rm(join(dir, name), { force: true });
    }
  }

  for (const [id, content] of Object.entries(entries)) {
    const normalised = content.endsWith("\n") ? content : content + "\n";
    await writeFile(join(dir, `${id}.md`), normalised);
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function serializeNdjson(rows: Row[]): string {
  if (rows.length === 0) return "";
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}
