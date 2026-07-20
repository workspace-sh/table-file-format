import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ParsedTable,
  TableMeta,
  TableSchema,
  ValidationError,
  View,
} from "./types.js";
import { parseNdjsonText, parseOptionalJsonText } from "./parse-text.js";

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
  const schemaRaw = await readFile(join(dir, "schema.json"), "utf8");
  const schema = JSON.parse(schemaRaw) as TableSchema;

  const rows = parseNdjsonText(
    (await readTextOptional(join(dir, "rows.ndjson"))) ?? "",
    diagnostics,
  );
  const views =
    parseOptionalJsonText<View[]>(
      "views.json",
      await readTextOptional(join(dir, "views.json")),
      diagnostics,
    ) ?? [];
  const meta =
    parseOptionalJsonText<TableMeta>(
      "meta.json",
      await readTextOptional(join(dir, "meta.json")),
      diagnostics,
    ) ?? {};
  const bodies = await readBodies(join(dir, "bodies"));

  const parsed: ParsedTable = { schema, rows, views, meta, path: dir };
  if (bodies) parsed.bodies = bodies;
  if (diagnostics.length > 0) parsed.diagnostics = diagnostics;
  return parsed;
}

async function readTextOptional(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  return readFile(path, "utf8");
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
