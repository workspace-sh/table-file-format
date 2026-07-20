import { readFile } from "node:fs/promises";
import type {
  ParsedTable,
  TableMeta,
  TableSchema,
  ValidationError,
  View,
} from "./types.js";
import type { WriteTableInput } from "./writer.js";
import { parseNdjsonText, parseOptionalJsonText } from "./parse-text.js";
import { normaliseBody, pretty, serializeNdjson, stampMeta } from "./serialize.js";
import { readZip, writeZip, type ZipEntry } from "./zip.js";

/**
 * `.table.zip` archive transport (SPEC section 13). Node-only, like
 * parser/writer. Canonical layout: the archive contains exactly one
 * root-level directory named `<name>.table/` with the bundle's files
 * inside it.
 *
 * Reading happens entirely in memory — no extraction to disk, so the
 * zip-slip vulnerability class cannot arise here (entry names are
 * still validated and hostile ones rejected, defence in depth).
 * Attachments are not materialised (resolution is the app's concern,
 * SPEC section 6); a consumer that needs attachment bytes extracts
 * the archive itself under the section 13 security rules.
 */

/** Archiver junk that readers MUST ignore (SPEC section 13). */
function isJunk(name: string): boolean {
  if (name.startsWith("__MACOSX/")) return true;
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base === ".DS_Store" || base === "Thumbs.db";
}

/**
 * Read a `.table.zip` archive into the same `ParsedTable` shape
 * `parseTable` returns, including the skip-and-collect diagnostics
 * contract (SPEC section 3). Missing or malformed `schema.json`
 * inside the archive is fatal, exactly as for a directory.
 *
 * `source` is a path to the archive or its bytes. `path` on the
 * result is the archive path when one was given, otherwise the root
 * directory name from inside the archive.
 */
export async function readTableArchive(
  source: string | Uint8Array,
): Promise<ParsedTable> {
  const bytes = typeof source === "string" ? await readFile(source) : source;
  const entries = readZip(bytes).filter((e) => !isJunk(e.name));
  if (entries.length === 0) {
    throw new Error("archive contains no table entries");
  }

  // Exactly one root directory, named *.table — the canonical layout.
  const roots = new Set(entries.map((e) => e.name.split("/")[0]!));
  if (roots.size !== 1) {
    throw new Error(
      `archive must contain exactly one root <name>.table directory, found: ${[...roots].join(", ")}`,
    );
  }
  const root = [...roots][0]!;
  if (!root.endsWith(".table") || entries.some((e) => !e.name.includes("/"))) {
    throw new Error(
      `archive root must be a <name>.table directory, found: ${root}`,
    );
  }

  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    files.set(e.name.slice(root.length + 1), e.data);
  }
  const text = (name: string): string | undefined => {
    const data = files.get(name);
    return data === undefined ? undefined : decoder.decode(data);
  };

  const diagnostics: ValidationError[] = [];

  const schemaRaw = text("schema.json");
  if (schemaRaw === undefined) {
    throw new Error(`archive ${root} is missing schema.json`);
  }
  // Fatal by design — do not wrap (same posture as parseTable).
  const schema = JSON.parse(schemaRaw) as TableSchema;

  const rows = parseNdjsonText(text("rows.ndjson") ?? "", diagnostics);
  const views =
    parseOptionalJsonText<View[]>("views.json", text("views.json"), diagnostics) ?? [];
  const meta =
    parseOptionalJsonText<TableMeta>("meta.json", text("meta.json"), diagnostics) ?? {};

  const bodies: Record<string, string> = {};
  for (const name of files.keys()) {
    // Direct children of bodies/ only, mirroring the directory parser.
    if (!name.startsWith("bodies/") || !name.endsWith(".md")) continue;
    const inner = name.slice("bodies/".length);
    if (inner.includes("/")) continue;
    bodies[inner.slice(0, -".md".length)] = decoder.decode(files.get(name)!);
  }

  const parsed: ParsedTable = {
    schema,
    rows,
    views,
    meta,
    path: typeof source === "string" ? source : root,
  };
  if (Object.keys(bodies).length > 0) parsed.bodies = bodies;
  if (diagnostics.length > 0) parsed.diagnostics = diagnostics;
  return parsed;
}

/**
 * Serialise a table into `.table.zip` bytes in the canonical layout.
 * `name` is the table's name — "projects" and "projects.table" are
 * both accepted; the archive root is always `<name>.table/`.
 *
 * Output is byte-deterministic for identical input: fixed entry
 * order (schema, rows, views, meta, bodies sorted by id), fixed
 * timestamps, canonical serialisation shared with `writeTable`.
 * The rebuildable `index.sqlite` cache and `attachments/` are not
 * carried by this writer (see SPEC section 13).
 */
export async function writeTableArchive(
  name: string,
  input: WriteTableInput | ParsedTable,
): Promise<Uint8Array> {
  const bare = name.endsWith(".table") ? name.slice(0, -".table".length) : name;
  if (bare.length === 0 || bare.includes("/") || bare.includes("\\")) {
    throw new Error(`invalid table name: ${JSON.stringify(name)}`);
  }
  const root = `${bare}.table`;
  const encoder = new TextEncoder();
  const entry = (path: string, content: string): ZipEntry => ({
    name: `${root}/${path}`,
    data: encoder.encode(content),
  });

  const entries: ZipEntry[] = [
    entry("schema.json", pretty(input.schema)),
    entry("rows.ndjson", serializeNdjson(input.rows)),
    entry("views.json", pretty(input.views ?? [])),
    entry("meta.json", pretty(stampMeta(input.meta))),
  ];
  const bodies = input.bodies ?? {};
  for (const id of Object.keys(bodies).sort()) {
    entries.push(entry(`bodies/${id}.md`, normaliseBody(bodies[id]!)));
  }
  return writeZip(entries);
}
