import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ParsedTable,
  Row,
  TableMeta,
  TableSchema,
  ValidationError,
  View,
} from "./types";

/**
 * Parse a `.table/` directory.
 *
 * Reader posture is **skip-and-collect** (SPEC section 3, "Reader
 * error contract"; DECISIONS D25): a malformed NDJSON line, a row
 * without a system `id`, or a malformed optional file degrades to a
 * per-item diagnostic on `parsed.diagnostics` — valid rows still
 * load. One typo or merge-conflict marker must not make a
 * hand-editable, git-friendly file unreadable.
 *
 * The single fatal case: `schema.json` missing or malformed. A
 * `.table/` without a readable schema is not a table — there is
 * nothing sound to degrade to.
 */
export async function parseTable(dir: string): Promise<ParsedTable> {
  const diagnostics: ValidationError[] = [];

  // Fatal by design — do not wrap.
  const schema = await readJson<TableSchema>(join(dir, "schema.json"));

  const rows = await readNdjson(join(dir, "rows.ndjson"), diagnostics);
  const views =
    (await readJsonOptional<View[]>(join(dir, "views.json"), diagnostics)) ?? [];
  const meta =
    (await readJsonOptional<TableMeta>(join(dir, "meta.json"), diagnostics)) ?? {};
  const bodies = await readBodies(join(dir, "bodies"));

  const parsed: ParsedTable = { schema, rows, views, meta, path: dir };
  if (bodies) parsed.bodies = bodies;
  if (diagnostics.length > 0) parsed.diagnostics = diagnostics;
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

/**
 * Optional JSON file: absent → undefined (silent, by spec); present
 * but malformed → undefined + a file-level diagnostic (rowIndex −1),
 * so a corrupted views.json degrades to "no saved views" instead of
 * sinking the whole table.
 */
async function readJsonOptional<T>(
  path: string,
  diagnostics: ValidationError[],
): Promise<T | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return await readJson<T>(path);
  } catch (err) {
    diagnostics.push({
      rowIndex: -1,
      message: `malformed ${basename(path)}: ${message(err)} — using defaults`,
    });
    return undefined;
  }
}

/**
 * NDJSON rows, skip-and-collect. `rowIndex` on a diagnostic is the
 * ZERO-BASED LINE NUMBER in rows.ndjson (not the index in the
 * returned array) so the report points at the actual line to fix.
 */
async function readNdjson(
  path: string,
  diagnostics: ValidationError[],
): Promise<Row[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  const rows: Row[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    let obj: Row;
    try {
      obj = JSON.parse(line) as Row;
    } catch (err) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped malformed line: ${message(err)} — ${line.slice(0, 60)}`,
      });
      continue;
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped non-object line: ${line.slice(0, 60)}`,
      });
      continue;
    }
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      diagnostics.push({
        rowIndex: i,
        message: `skipped row missing system id: ${line.slice(0, 60)}`,
      });
      continue;
    }
    rows.push(obj);
  }
  return rows;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
