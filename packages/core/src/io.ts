// Reading and writing `.table` folders over any file system. The reader's
// skip-and-collect contract (SPEC section 3, D25) and the writer's staged
// commit (SPEC section 1, D24) live here once. `./parser` and `./writer`
// run them over node:fs; a React Native app passes its own `TableFs`. Nothing
// here imports Node, so Metro and browsers can load it.

import type { BundleMeta, CellFormula, ParsedBundle, ParsedTable, Row, TableMeta, TableSchema, UnreadLine, ValidationError, View } from "./types.js";
import { CELLS_DIR, cellDiagnostics, layoutCells, parseCellsText } from "./cells.js";
import { parseOptionalJsonText, parseRowsText } from "./parse-text.js";
import { withFieldIds } from "./fieldIds.js";
import { normaliseBody, pretty, rowLine, stampMeta, tableMetaOnly } from "./serialize.js";
import { isTableName, tableOrder } from "./bundle.js";
import { BundleEntry, TableEntry, bodyFileName, rowIdOfBodyFile, rowTitleIn, tablePath } from "./layout.js";
import { FIRST_ROWS_FILE, LEGACY_ROWS_FILE, ROWS_DIR, estimateRows, layoutRows, rowsFileOrder } from "./rowFiles.js";

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
  /** A directory's entries, in any order (the reader sorts), or null when there's no such directory. */
  list(path: string): Promise<{ name: string; directory: boolean }[] | null>;
  /** Remove a file, or a directory and everything in it. Not an error if absent. */
  remove(path: string): Promise<void>;
  /** A file's bytes, or null when there's no such file (a directory isn't one). For single-file `.table`s and attachments. */
  readBytes?(path: string): Promise<Uint8Array | null>;
  /** Write bytes, replacing any file there. The directory exists. */
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
  /** A file's size in bytes, or null when there's no such file: for judging how many rows a table has before reading them. */
  size?(path: string): Promise<number | null>;
  /** A file's first `bytes` bytes (fewer when it's shorter), or null when there's no such file. */
  readHead?(path: string, bytes: number): Promise<Uint8Array | null>;
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
export function memoryFs(): TableFs & { files: Map<string, string>; bytes: Map<string, Uint8Array>; dirs: Set<string>; renames: number } {
  const files = new Map<string, string>();
  // Files written as bytes; a file is in one map or the other.
  const bytes = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const fs = {
    files,
    bytes,
    dirs,
    renames: 0,
    async readText(p: string) {
      const b = bytes.get(p);
      return files.get(p) ?? (b ? new TextDecoder().decode(b) : null);
    },
    async writeText(p: string, content: string) {
      if (!dirs.has(parent(p))) throw new Error(`ENOENT: no directory for ${p}`);
      bytes.delete(p);
      files.set(p, content);
    },
    async readBytes(p: string) {
      const t = files.get(p);
      return bytes.get(p) ?? (t === undefined ? null : new TextEncoder().encode(t));
    },
    async writeBytes(p: string, data: Uint8Array) {
      if (!dirs.has(parent(p))) throw new Error(`ENOENT: no directory for ${p}`);
      files.delete(p);
      bytes.set(p, data);
    },
    async rename(from: string, to: string) {
      const content = files.get(from);
      const data = bytes.get(from);
      if (content === undefined && data === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      bytes.delete(from);
      files.delete(to);
      bytes.delete(to);
      if (content !== undefined) files.set(to, content);
      else bytes.set(to, data!);
      fs.renames++;
    },
    async mkdir(p: string) {
      for (let d = p; d !== "" && !dirs.has(d); d = parent(d)) dirs.add(d);
    },
    async list(p: string) {
      if (!dirs.has(p)) return null;
      const names = new Map<string, boolean>();
      for (const d of dirs) if (d !== p && parent(d) === p) names.set(d.slice(p.length + 1), true);
      for (const f of [...files.keys(), ...bytes.keys()]) if (parent(f) === p) names.set(f.slice(p.length + 1), false);
      return [...names].map(([name, directory]) => ({ name, directory }));
    },
    async remove(p: string) {
      for (const f of [...files.keys()]) if (f === p || f.startsWith(p + "/")) files.delete(f);
      for (const f of [...bytes.keys()]) if (f === p || f.startsWith(p + "/")) bytes.delete(f);
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
export interface ReadOptions {
  /**
   * Asked for each table's directory: true leaves its `rows.ndjson`
   * unread, for a table too large to hold, whose rows the caller reads
   * through the index instead. The table comes back with no rows and
   * `indexed` set, its count for the caller to fill in.
   */
  rowsElsewhere?: (tableDir: string) => boolean | Promise<boolean>;
  /**
   * "later": every table is read without its rows, for drawing a document
   * at once from its small files (its name, tables, views and fields). Each
   * comes back with `loading` set, about how many rows it has; its rows
   * are read after, by `readTableRows`.
   */
  rows?: "later";
}

export async function readBundle(fs: TableFs, dir: string, options: ReadOptions = {}): Promise<ParsedBundle> {
  const diagnostics: ValidationError[] = [];
  const meta = parseOptionalJsonText<BundleMeta>(BundleEntry.meta, (await fs.readText(joinPath(dir, BundleEntry.meta))) ?? undefined, diagnostics) ?? {};
  const tables: Record<string, ParsedTable> = {};
  const tablesDir = joinPath(dir, BundleEntry.tables);
  const entries = ((await fs.list(tablesDir)) ?? [])
    .filter((e) => e.directory && isTableName(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const tableDir = joinPath(tablesDir, entry.name);
    const listed = (await fs.list(tableDir)) ?? [];
    const has = (name: string, directory: boolean) => listed.some((e) => e.name === name && e.directory === directory);
    if (!has(TableEntry.schema, false) || !(has(ROWS_DIR, true) || has(LEGACY_ROWS_FILE, false))) {
      diagnostics.push({ rowIndex: -1, message: `${tablePath(entry.name)} isn't a table: it needs ${TableEntry.schema} and ${ROWS_DIR}/` });
      continue;
    }
    tables[entry.name] = await readTable(fs, tableDir, options);
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
export async function readTable(fs: TableFs, dir: string, options: ReadOptions = {}): Promise<ParsedTable> {
  const diagnostics: ValidationError[] = [];

  // Fatal by design — do not wrap.
  const schemaPath = joinPath(dir, TableEntry.schema);
  const schemaRaw = await fs.readText(schemaPath);
  if (schemaRaw === null) throw new Error(`${schemaPath}: no ${TableEntry.schema}, so this isn't a table`);
  // Every field has its id (D62): one written without takes the id its name derives.
  const schema = withFieldIds(JSON.parse(schemaRaw) as TableSchema);

  const later = options.rows === "later";
  const elsewhere = !later && (await options.rowsElsewhere?.(dir)) === true;
  const unread: UnreadLine[] = [];
  const read = elsewhere || later ? { rows: [], rowFiles: [] } : await readRowsFiles(fs, dir, diagnostics, unread);
  const rows = read.rows;
  const views = parseOptionalJsonText<View[]>(TableEntry.views, (await fs.readText(joinPath(dir, TableEntry.views))) ?? undefined, diagnostics) ?? [];
  const meta = parseOptionalJsonText<TableMeta>(TableEntry.meta, (await fs.readText(joinPath(dir, TableEntry.meta))) ?? undefined, diagnostics) ?? {};
  const bodies = await readBodies(fs, joinPath(dir, TableEntry.bodies));
  // Cells' own formulas (D52): read whole, however the rows are; what doesn't apply is kept and said.
  const unreadCells: string[] = [];
  const cells = await readCellsFiles(fs, dir, diagnostics, unreadCells);
  if (!elsewhere && !later) diagnostics.push(...cellDiagnostics(schema, rows, cells));

  const parsed: ParsedTable = { schema, rows, views, meta, path: dir };
  // A table held in the index has its cells' formulas there, as its rows (D52).
  if (cells.length > 0 && !elsewhere) parsed.cells = cells;
  if (unreadCells.length > 0) parsed.unreadCells = unreadCells;
  if (read.rowFiles.length > 0) parsed.rowFiles = read.rowFiles;
  if (elsewhere) parsed.indexed = { count: 0, version: 0 };
  if (later) parsed.loading = { estimate: await estimateTableRows(fs, dir) };
  if (bodies) parsed.bodies = bodies;
  if (unread.length > 0) parsed.unread = unread;
  if (diagnostics.length > 0) parsed.diagnostics = diagnostics;
  return parsed;
}

/** Where a table's rows are: its `rows/` files in order (D51), or `formatVersion` 1's one `rows.ndjson` as `0001`. */
export async function rowsFilesOf(fs: TableFs, dir: string): Promise<{ name: string; path: string }[]> {
  const listed = await fs.list(joinPath(dir, ROWS_DIR));
  if (listed !== null) return rowsFileOrder(listed.filter((e) => !e.directory).map((e) => e.name)).map((name) => ({ name, path: joinPath(dir, ROWS_DIR, name) }));
  const legacy = joinPath(dir, LEGACY_ROWS_FILE);
  return (await fs.readText(legacy)) === null ? [] : [{ name: FIRST_ROWS_FILE, path: legacy }];
}

/** How much of the first rows file is read to judge how many rows a table has. */
const ESTIMATE_HEAD = 64 * 1024;

/** About how many rows a table's rows files hold, without reading them (estimateRows); 0 when the file system can't say a file's size. */
async function estimateTableRows(fs: TableFs, dir: string): Promise<number> {
  if (!fs.size) return 0;
  const files = await rowsFilesOf(fs, dir);
  let total = 0;
  for (const f of files) total += (await fs.size(f.path)) ?? 0;
  if (total === 0) return 0;
  const head = fs.readHead ? await fs.readHead(files[0]!.path, ESTIMATE_HEAD) : null;
  // Without a way to read a file's start: rows of about 150 bytes.
  return head ? estimateRows(total, head) : Math.max(1, Math.round(total / 150));
}

/**
 * A table's rows, read after the rest of it (a reader's `rows: "later"`):
 * from its rows files in file order, each file's rows handed to `onRows` as
 * it's read. Resolves with all of them and what the reader would have set
 * with them: which file held which rows, the lines it couldn't read, and
 * what it said about them.
 */
export async function readTableRows(
  fs: TableFs,
  dir: string,
  options: { onRows?: (rows: Row[]) => void } = {},
): Promise<{ rows: Row[]; rowFiles: { name: string; ids: string[] }[]; unread: UnreadLine[]; diagnostics: ValidationError[] }> {
  const diagnostics: ValidationError[] = [];
  const unread: UnreadLine[] = [];
  const read = await readRowsFiles(fs, dir, diagnostics, unread, options.onRows);
  return { ...read, unread, diagnostics };
}

/** A table's `cells/` lines, from its files in name order (D52). */
async function readCellsFiles(fs: TableFs, dir: string, diagnostics: ValidationError[], unread: string[]): Promise<CellFormula[]> {
  const listed = await fs.list(joinPath(dir, CELLS_DIR));
  if (listed === null) return [];
  const cells: CellFormula[] = [];
  for (const name of rowsFileOrder(listed.filter((e) => !e.directory).map((e) => e.name))) {
    for (const c of parseCellsText((await fs.readText(joinPath(dir, CELLS_DIR, name))) ?? "", diagnostics, unread, `${CELLS_DIR}/${name}`)) cells.push(c);
  }
  return cells;
}

/** A table's rows from its rows files, in file order, and which file held which rows (for writing them back). */
async function readRowsFiles(
  fs: TableFs,
  dir: string,
  diagnostics: ValidationError[],
  unread: UnreadLine[],
  onRows?: (rows: Row[]) => void,
): Promise<{ rows: Row[]; rowFiles: { name: string; ids: string[] }[] }> {
  const rows: Row[] = [];
  const rowFiles: { name: string; ids: string[] }[] = [];
  const seen = new Map<string, Row>();
  for (const file of await rowsFilesOf(fs, dir)) {
    const these = parseRowsText((await fs.readText(file.path)) ?? "", diagnostics, unread, { file: file.path.endsWith(LEGACY_ROWS_FILE) ? LEGACY_ROWS_FILE : `${ROWS_DIR}/${file.name}`, after: rows.at(-1)?.id ?? null, seen });
    for (const r of these) rows.push(r);
    rowFiles.push({ name: file.name, ids: these.map((r) => r.id) });
    onRows?.(these);
  }
  return { rows, rowFiles };
}

async function readBodies(fs: TableFs, dir: string): Promise<Record<string, string> | undefined> {
  const entries = await fs.list(dir);
  if (!entries) return undefined;
  const bodies: Record<string, string> = {};
  // By name, whatever order the file system lists them in, so a table
  // reads the same from every platform.
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    // Its row is the id in its name, whatever title is written beside it (D64).
    const id = entry.directory ? null : rowIdOfBodyFile(entry.name);
    if (id === null) continue;
    const text = await fs.readText(joinPath(dir, entry.name));
    if (text !== null) bodies[id] = text;
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
   * Each entry becomes a `bodies/{title}--{id}.md` file (D64).
   * On write, the bodies/ directory is wholesale-replaced — entries not
   * present in this map are deleted from disk. Use a future appendBody /
   * writeBody API for partial updates.
   */
  bodies?: Record<string, string>;
  /** Lines of `rows.ndjson` that couldn't be read as rows, put back where they were (ParsedTable.unread). */
  unread?: UnreadLine[];
  /** Cells' own formulas (ParsedTable.cells, D52). */
  cells?: CellFormula[];
  /** Lines of `cells/` that couldn't be read, put back (ParsedTable.unreadCells). */
  unreadCells?: string[];
  /** Which rows each rows file held (ParsedTable.rowFiles): written back to the same files. */
  rowFiles?: { name: string; ids: string[] }[];
  /**
   * The table's edit history as text (SPEC section 14), for a table that
   * arrived with one (from an archive). Written only when the table has
   * no `history.ndjson` yet: one that is there is never changed here.
   */
  history?: string;
}

export interface WriteBundleInput {
  meta?: BundleMeta;
  tables: Record<string, WriteTableInput | ParsedTable>;
  /** Files beyond the tables' text, by path inside the bundle, carried by a single-file save (ParsedBundle.files). */
  files?: Record<string, Uint8Array>;
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
 *   Unchanged files are left alone: a file whose canonical text is
 *              already on disk isn't staged, renamed or touched.
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
  // No attachments/: it's optional (SPEC section 6), and this writer puts
  // nothing in it. One that's there is left as it is.
  await fs.mkdir(dir);

  // A table's meta.json carries only its own title and description:
  // `format`, `formatVersion` and `tables` describe the bundle.
  const meta: TableMeta = tableMetaOnly(input.meta);

  const bodiesDir = joinPath(dir, TableEntry.bodies);
  const bodies = input.bodies ?? {};
  const haveBodies = Object.keys(bodies).length > 0;
  const bodiesWritten = new Set<string>();

  // ---- Stage: write everything to *.tmp; nothing existing is touched.
  // A file whose text wouldn't change isn't staged at all, so saving one
  // edit rewrites only the files it changed, and git sees only those.
  const staged: Array<{ tmp: string; target: string }> = [];
  const rowsDir = joinPath(dir, ROWS_DIR);
  let rowsWritten: { name: string; text: string }[] | null = null;
  const cellsDir = joinPath(dir, CELLS_DIR);
  let cellsWritten: { name: string; text: string }[] | null = null;
  const stage = async (target: string, content: string) => {
    if ((await fs.readText(target)) === content) return;
    const tmp = target + ".tmp";
    await fs.writeText(tmp, content);
    staged.push({ tmp, target });
  };

  try {
    await stage(joinPath(dir, TableEntry.schema), pretty(withFieldIds(input.schema)));
    // Rows held in the index aren't here to write: whoever holds them saves them.
    // Rows not read yet (`loading`) aren't here to write either.
    if (!("indexed" in input && input.indexed) && !("loading" in input && input.loading)) {
      // Each row back in its file, and only the files that changed (D51).
      rowsWritten = layoutRows(input.rows, rowLine(input.schema), {
        ...(input.rowFiles ? { files: input.rowFiles } : {}),
        ...(input.unread ? { unread: input.unread } : {}),
      });
      await fs.mkdir(rowsDir);
      for (const file of rowsWritten) await stage(joinPath(rowsDir, file.name), file.text);
      // Cells' own formulas, beside the rows they follow (D52).
      cellsWritten = layoutCells(input.schema, input.rows, input.cells, input.unreadCells);
      if (cellsWritten.length > 0) await fs.mkdir(cellsDir);
      for (const file of cellsWritten) await stage(joinPath(cellsDir, file.name), file.text);
    }
    await stage(joinPath(dir, TableEntry.views), pretty(input.views ?? []));
    await stage(joinPath(dir, TableEntry.meta), pretty(meta));
    // A history that came with the table (an archive opened into a folder) is put there once. The file is
    // append-only and its writers' own: one already there is left exactly as it is.
    const historyPath = joinPath(dir, TableEntry.history);
    if (input.history && (await fs.readText(historyPath)) === null) await stage(historyPath, input.history);
    if (haveBodies) {
      await fs.mkdir(bodiesDir);
      // Each page named by its row's title as it is now (D64). A row not here to read (held in the
      // index, or not read yet) keeps the name its page has.
      const existing = new Map<string, string>();
      for (const entry of (await fs.list(bodiesDir)) ?? []) {
        const id = entry.directory ? null : rowIdOfBodyFile(entry.name);
        if (id !== null && !entry.name.endsWith(".tmp")) existing.set(id, entry.name);
      }
      const rowsById = new Map(input.rows.map((r) => [r.id, r]));
      for (const [id, content] of Object.entries(bodies)) {
        const row = rowsById.get(id);
        const name = row ? bodyFileName(id, rowTitleIn(input.schema.fields, row)) : (existing.get(id) ?? bodyFileName(id));
        bodiesWritten.add(name);
        await stage(joinPath(bodiesDir, name), normaliseBody(content));
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
  if (rowsWritten) {
    // Rows files no longer holding rows, and formatVersion 1's rows.ndjson, now in rows/.
    const kept = new Set(rowsWritten.map((f) => f.name));
    for (const name of rowsFileOrder(((await fs.list(rowsDir)) ?? []).map((e) => e.name))) if (!kept.has(name)) await fs.remove(joinPath(rowsDir, name));
    await fs.remove(joinPath(dir, LEGACY_ROWS_FILE));
  }
  if (cellsWritten) {
    const kept = new Set(cellsWritten.map((f) => f.name));
    for (const entry of (await fs.list(cellsDir)) ?? []) if (!entry.directory && !kept.has(entry.name)) await fs.remove(joinPath(cellsDir, entry.name));
    if (cellsWritten.length === 0 && (await fs.list(cellsDir))?.length === 0) await fs.remove(cellsDir);
  }
  if (haveBodies) {
    // A page whose row is gone, and one under its row's old title: it's been written under the new.
    for (const entry of (await fs.list(bodiesDir)) ?? []) {
      if (entry.directory || rowIdOfBodyFile(entry.name) === null) continue;
      if (!bodiesWritten.has(entry.name)) await fs.remove(joinPath(bodiesDir, entry.name));
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
  const tablesDir = joinPath(dir, BundleEntry.tables);
  await fs.mkdir(tablesDir);
  for (const name of names) {
    await writeTableTo(fs, joinPath(tablesDir, name), input.tables[name]!);
  }

  const manifest = joinPath(dir, BundleEntry.meta);
  const manifestText = pretty(stampMeta({ ...(input.meta ?? {}), tables: names }));
  if ((await fs.readText(manifest)) !== manifestText) {
    await fs.writeText(manifest + ".tmp", manifestText);
    await fs.rename(manifest + ".tmp", manifest);
  }

  for (const entry of (await fs.list(tablesDir)) ?? []) {
    if (!entry.directory || names.includes(entry.name)) continue;
    // Only what the reader would call a table: never an unknown directory.
    if ((await fs.readText(joinPath(tablesDir, entry.name, TableEntry.schema))) !== null) {
      await fs.remove(joinPath(tablesDir, entry.name));
    }
  }
}
