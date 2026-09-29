// Reading and writing `.table` folders over any file system. The reader's
// skip-and-collect contract (SPEC section 3, D25) and the writer's staged
// commit (SPEC section 1, D24) live here once. `./parser` and `./writer`
// run them over node:fs; a React Native app passes its own `TableFs`. Nothing
// here imports Node, so Metro and browsers can load it.

import type { BundleMeta, ParsedBundle, ParsedTable, Row, TableMeta, TableSchema, ValidationError, View } from "./types.js";
import { parseOptionalJsonText, parseRowsText } from "./parse-text.js";
import { normaliseBody, pretty, serializeRows, stampMeta, tableMetaOnly } from "./serialize.js";
import { isTableName, tableOrder } from "./bundle.js";

/**
 * The file operations a `.table` folder needs. Paths are `/`-separated, as
 * `joinPath` builds them. Every method is async; each rejects on a failure
 * other than the absence it reports as a value.
 */
export interface TableFs {
  /** A file's text as UTF-8, or null when there's no such file. */
  readText(path: string): Promise<string | null>;
  /** Write `content` as UTF-8, replacing any file there. The directory exists. */
  writeText(path: string, content: string): Promise<void>;
  /**
   * Move a file over another, replacing an existing target atomically, as
   * POSIX rename(2) does: a reader sees the old file or the new one, never
   * neither. The writer only ever renames files (a staged `*.tmp` over its
   * target, in the same directory), never directories. An adapter whose
   * platform call removes the target and then moves (two steps) doesn't
   * meet this: a crash between them loses the file.
   */
  rename(from: string, to: string): Promise<void>;
  /** Make a directory and any missing parents. Not an error if it exists. */
  mkdir(path: string): Promise<void>;
  /** A directory's entries, or null when there's no such directory. */
  list(path: string): Promise<{ name: string; directory: boolean }[] | null>;
  /** Remove a file, or a directory and everything in it. Not an error if absent. */
  remove(path: string): Promise<void>;
}

/** `/`-joined path parts, without doubled separators. */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

/**
 * A `TableFs` held in memory: for tests, and for an app with no disk (a
 * browser demo). `files` and `dirs` are its contents, `renames` how many
 * renames it has done. Paths are `/`-separated from the root, "".
 */
export function memoryFs(): TableFs & { files: Map<string, string>; dirs: Set<string>; renames: number } {
  const files = new Map<string, string>();
  const dirs = new Set<string>([""]);
  const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const fs = {
    files,
    dirs,
    renames: 0,
    async readText(p: string) {
      return files.get(p) ?? null;
    },
    async writeText(p: string, content: string) {
      if (!dirs.has(parent(p))) throw new Error(`ENOENT: no directory for ${p}`);
      files.set(p, content);
    },
    async rename(from: string, to: string) {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, content);
      fs.renames++;
    },
    async mkdir(p: string) {
      for (let d = p; d !== "" && !dirs.has(d); d = parent(d)) dirs.add(d);
    },
    async list(p: string) {
      if (!dirs.has(p)) return null;
      const names = new Map<string, boolean>();
      for (const d of dirs) if (d !== p && parent(d) === p) names.set(d.slice(p.length + 1), true);
      for (const f of files.keys()) if (parent(f) === p) names.set(f.slice(p.length + 1), false);
      return [...names].map(([name, directory]) => ({ name, directory }));
    },
    async remove(p: string) {
      for (const f of [...files.keys()]) if (f === p || f.startsWith(p + "/")) files.delete(f);
      for (const d of [...dirs]) if (d === p || d.startsWith(p + "/")) dirs.delete(d);
    },
  };
  return fs;
}

// ─── Reading ───────────────────────────────────────────────────────────

/**
 * Read a `.table` bundle: its manifest and every table under
 * `tables/<name>/` (SPEC section 1, D37).
 *
 * Each table is read by `readTable`, with its own skip-and-collect
 * diagnostics. A directory under `tables/` without both `schema.json`
 * and `rows.ndjson` isn't a table: it's reported on the bundle's
 * diagnostics and otherwise ignored, as SPEC section 1 says. Hidden
 * entries (`.DS_Store` and the like) are ignored silently.
 */
export async function readBundle(fs: TableFs, dir: string): Promise<ParsedBundle> {
  const diagnostics: ValidationError[] = [];
  const meta = parseOptionalJsonText<BundleMeta>("meta.json", (await fs.readText(joinPath(dir, "meta.json"))) ?? undefined, diagnostics) ?? {};
  const tables: Record<string, ParsedTable> = {};
  const tablesDir = joinPath(dir, "tables");
  const entries = ((await fs.list(tablesDir)) ?? [])
    .filter((e) => e.directory && isTableName(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const tableDir = joinPath(tablesDir, entry.name);
    const files = new Set(((await fs.list(tableDir)) ?? []).filter((e) => !e.directory).map((e) => e.name));
    if (!files.has("schema.json") || !files.has("rows.ndjson")) {
      diagnostics.push({ rowIndex: -1, message: `tables/${entry.name} isn't a table: it needs schema.json and rows.ndjson` });
      continue;
    }
    tables[entry.name] = await readTable(fs, tableDir);
  }
  const bundle: ParsedBundle = { meta, tables, path: dir };
  if (diagnostics.length > 0) bundle.diagnostics = diagnostics;
  return bundle;
}

/**
 * Read one table's directory, `tables/<name>/` inside a bundle.
 *
 * Reader posture is **skip-and-collect** (SPEC section 3, "Reader
 * error contract"; DECISIONS D25): a malformed NDJSON line, a row
 * without a system `id`, or a malformed optional file degrades to a
 * per-item diagnostic on `parsed.diagnostics` — valid rows still
 * load. One typo or merge-conflict marker must not make a
 * hand-editable, git-friendly file unreadable.
 *
 * The single fatal case: `schema.json` missing or malformed. A
 * directory without a readable schema is not a table: there is
 * nothing sound to degrade to.
 */
export async function readTable(fs: TableFs, dir: string): Promise<ParsedTable> {
  const diagnostics: ValidationError[] = [];

  // Fatal by design — do not wrap.
  const schemaPath = joinPath(dir, "schema.json");
  const schemaRaw = await fs.readText(schemaPath);
  if (schemaRaw === null) throw new Error(`${schemaPath}: no schema.json, so this isn't a table`);
  const schema = JSON.parse(schemaRaw) as TableSchema;

  const rows = parseRowsText((await fs.readText(joinPath(dir, "rows.ndjson"))) ?? "", diagnostics);
  const views = parseOptionalJsonText<View[]>("views.json", (await fs.readText(joinPath(dir, "views.json"))) ?? undefined, diagnostics) ?? [];
  const meta = parseOptionalJsonText<TableMeta>("meta.json", (await fs.readText(joinPath(dir, "meta.json"))) ?? undefined, diagnostics) ?? {};
  const bodies = await readBodies(fs, joinPath(dir, "bodies"));

  const parsed: ParsedTable = { schema, rows, views, meta, path: dir };
  if (bodies) parsed.bodies = bodies;
  if (diagnostics.length > 0) parsed.diagnostics = diagnostics;
  return parsed;
}

async function readBodies(fs: TableFs, dir: string): Promise<Record<string, string> | undefined> {
  const entries = await fs.list(dir);
  if (!entries) return undefined;
  const bodies: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.directory || !entry.name.endsWith(".md")) continue;
    const text = await fs.readText(joinPath(dir, entry.name));
    if (text !== null) bodies[entry.name.slice(0, -".md".length)] = text;
  }
  return Object.keys(bodies).length > 0 ? bodies : undefined;
}

// ─── Writing ───────────────────────────────────────────────────────────

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

export interface WriteBundleInput {
  meta?: BundleMeta;
  tables: Record<string, WriteTableInput | ParsedTable>;
}

/**
 * Write a `.table/` directory with a staged, near-atomic commit
 * (SPEC section 1, "Writer atomicity"; DECISIONS D24):
 *
 *   Stage    — every file's full content is written to a `<name>.tmp`
 *              sibling first. Any failure here (disk full, bad body
 *              id, crash) leaves the existing table byte-for-byte
 *              intact; at worst, ignorable `*.tmp` litter remains,
 *              which readers skip by contract (unknown root files are
 *              ignored; body readers only match `*.md`).
 *   Commit   — each temp is renamed over its target. rename(2) within
 *              a directory is atomic per file, so a reader never
 *              observes a partially-written file. The commit phase is
 *              a handful of renames — the torn-window shrinks from
 *              "the whole serialisation" to microseconds.
 *   Trim     — stale body files (and an emptied bodies/ dir) are
 *              removed only after every rename has landed, so a crash
 *              can never leave bodies deleted-but-not-rewritten.
 *
 * This is atomicity against readers and crashes, not durability —
 * no fsync is issued; power-loss durability is the platform's page
 * cache policy. Apps needing stronger guarantees can fsync the
 * directory afterwards. The per-file guarantee is `TableFs.rename`'s:
 * every adapter must replace atomically.
 */
export async function writeTableTo(fs: TableFs, dir: string, input: WriteTableInput | ParsedTable): Promise<void> {
  await fs.mkdir(dir);
  await fs.mkdir(joinPath(dir, "attachments"));

  // A table's meta.json carries only its own title and description:
  // `format`, `formatVersion` and `tables` describe the bundle.
  const meta: TableMeta = tableMetaOnly(input.meta);

  const bodiesDir = joinPath(dir, "bodies");
  const bodies = input.bodies ?? {};
  const haveBodies = Object.keys(bodies).length > 0;

  // ---- Stage: write everything to *.tmp; nothing existing is touched.
  const staged: Array<{ tmp: string; target: string }> = [];
  const stage = async (target: string, content: string) => {
    const tmp = target + ".tmp";
    await fs.writeText(tmp, content);
    staged.push({ tmp, target });
  };

  try {
    await stage(joinPath(dir, "schema.json"), pretty(input.schema));
    await stage(joinPath(dir, "rows.ndjson"), serializeRows(input.rows, input.schema));
    await stage(joinPath(dir, "views.json"), pretty(input.views ?? []));
    await stage(joinPath(dir, "meta.json"), pretty(meta));
    if (haveBodies) {
      await fs.mkdir(bodiesDir);
      for (const [id, content] of Object.entries(bodies)) {
        await stage(joinPath(bodiesDir, `${id}.md`), normaliseBody(content));
      }
    }
  } catch (err) {
    // Failed mid-stage: remove whatever temps we managed to write so
    // the directory returns to exactly its pre-call state, then
    // surface the original error. Cleanup failures are swallowed —
    // stray temps are inert by the reader contract.
    await Promise.allSettled(staged.map((s) => fs.remove(s.tmp)));
    throw err;
  }

  // ---- Commit: atomic per-file renames. No content writes happen here.
  for (const { tmp, target } of staged) {
    await fs.rename(tmp, target);
  }

  // ---- Trim: deletions strictly after every rename has landed.
  if (haveBodies) {
    for (const entry of (await fs.list(bodiesDir)) ?? []) {
      if (entry.directory || !entry.name.endsWith(".md")) continue;
      const id = entry.name.slice(0, -".md".length);
      if (!(id in bodies)) await fs.remove(joinPath(bodiesDir, entry.name));
    }
  } else if ((await fs.list(bodiesDir)) !== null) {
    await fs.remove(bodiesDir);
  }
}

/**
 * Write a `.table` bundle (SPEC section 1, D37): every table under
 * `tables/<name>/` by `writeTableTo`, then the manifest, with the
 * `tables` order the bundle is shown in. Each file keeps D24's
 * stage-then-rename discipline. Trim comes last, as there: a table
 * directory no longer in the bundle is removed only after everything
 * else has been written.
 */
export async function writeBundleTo(fs: TableFs, dir: string, input: WriteBundleInput | ParsedBundle): Promise<void> {
  const names = tableOrder(input);
  for (const name of names) {
    if (!isTableName(name)) throw new Error(`invalid table name: ${JSON.stringify(name)}`);
  }
  const tablesDir = joinPath(dir, "tables");
  await fs.mkdir(tablesDir);
  for (const name of names) {
    await writeTableTo(fs, joinPath(tablesDir, name), input.tables[name]!);
  }

  const manifest = joinPath(dir, "meta.json");
  await fs.writeText(manifest + ".tmp", pretty(stampMeta({ ...(input.meta ?? {}), tables: names })));
  await fs.rename(manifest + ".tmp", manifest);

  for (const entry of (await fs.list(tablesDir)) ?? []) {
    if (!entry.directory || names.includes(entry.name)) continue;
    // Only what the reader would call a table: never an unknown directory.
    if ((await fs.readText(joinPath(tablesDir, entry.name, "schema.json"))) !== null) {
      await fs.remove(joinPath(tablesDir, entry.name));
    }
  }
}
