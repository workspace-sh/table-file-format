import { strFromU8, strToU8 } from "fflate";
import type {
  BundleMeta,
  ParsedBundle,
  ParsedTable,
  Row,
  TableMeta,
  TableSchema,
  UnreadLine,
  ValidationError,
  View,
} from "./types.js";
import type { CellFormula } from "./types.js";
import { CELLS_DIR, cellDiagnostics, layoutCells, parseCellsText } from "./cells.js";
import type { WriteBundleInput } from "./io.js";
import { parseRowsText, parseOptionalJsonText } from "./parse-text.js";
import { normaliseBody, pretty, rowLine, stampMeta, tableMetaOnly } from "./serialize.js";
import { estimateRows, FIRST_ROWS_FILE, isRowsFileName, LEGACY_ROWS_FILE, layoutRows, ROWS_DIR, rowsFileOrder } from "./rowFiles.js";

/** How much of a table's first rows file is read to judge how many rows it has. */
const ESTIMATE_HEAD = 64 * 1024;
import { isTableName, tableOrder } from "./bundle.js";
import { BODY_EXTENSION, BUNDLE_EXTENSION, BundleEntry, TableEntry, isArchivedRowsFile, tableNameIn, tablePath } from "./layout.js";
import { readZip, writeZip, type LazyZipEntry } from "./zip.js";

/**
 * `.table.zip` archive transport (SPEC section 13). Portable — Node,
 * browsers, React Native — because a shared archive arrives on every
 * platform (mail on a phone, upload in a browser, Finder on a Mac).
 * Callers hand in the archive BYTES; getting bytes from a path, a
 * fetch, or a document picker is the platform's one line, not this
 * module's concern. Canonical layout: the archive contains exactly
 * one root-level directory named `<name>.table/` with the bundle's
 * files inside it.
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
 * Read `.table.zip` archive bytes into the same `ParsedBundle` shape
 * `parseBundle` returns: the manifest, and every table under
 * `tables/<name>/` with its own skip-and-collect diagnostics (SPEC
 * section 3). A directory under `tables/` without a `schema.json` isn't
 * a table and is reported on the bundle's diagnostics, as on disk. A
 * malformed `schema.json` stays fatal. `path` on the result is the
 * root directory name from inside the archive.
 */
export interface ReadArchiveOptions {
  /**
   * Asked for each table, with its `rows.ndjson` as bytes: true leaves the
   * rows unparsed, for a table too large to hold, whose bytes the caller
   * has now taken to index. The table comes back with no rows and
   * `indexed` set, its count for the caller to fill in.
   */
  rowsElsewhere?: (name: string, table: { schema: TableSchema; views: View[]; bodies: Record<string, string>; cells?: CellFormula[] }, rows: Uint8Array) => boolean | Promise<boolean>;
  /**
   * The same question, asked before a table with a large rows file (of `lazyFrom`
   * bytes or more, 1 MB when left out) is inflated at all: it is handed
   * still compressed, to be read a piece at a time, so its start can be
   * shown while the rest is read. False inflates and parses it as usual.
   */
  rowsLazily?: (name: string, table: { schema: TableSchema; views: View[]; bodies: Record<string, string>; cells?: CellFormula[] }, rows: LazyZipEntry) => boolean | Promise<boolean>;
  lazyFrom?: number;
  /**
   * "later": every table without its rows, none of them inflated, for
   * drawing the document at once (as readBundle's `rows: "later"`): each
   * comes back with `loading` set, about how many rows it has. Its rows are
   * read after, from the folder the file is unpacked into.
   */
  rows?: "later";
}

function whole(entry: LazyZipEntry): Uint8Array {
  const all = new Uint8Array(entry.size);
  let at = 0;
  for (const piece of entry.chunks()) {
    all.set(piece, at);
    at += piece.length;
  }
  return all;
}

export async function readTableArchive(
  source: Uint8Array,
  options: ReadArchiveOptions = {},
): Promise<ParsedBundle> {
  const lazyFrom = options.lazyFrom ?? 1 << 20;
  const entries = readZip(source, {
    lazy: (name, size) => (options.rows === "later" || (!!options.rowsLazily && size >= lazyFrom)) && isArchivedRowsFile(name),
  }).filter((e) => !isJunk(e.name));
  if (entries.length === 0) {
    throw new Error("archive contains no table entries");
  }

  // Exactly one root directory, named *.table — the canonical layout.
  const roots = new Set(entries.map((e) => e.name.split("/")[0]!));
  if (roots.size !== 1) {
    throw new Error(
      `archive must contain exactly one root <name>${BUNDLE_EXTENSION} directory, found: ${[...roots].join(", ")}`,
    );
  }
  const root = [...roots][0]!;
  if (!root.endsWith(BUNDLE_EXTENSION) || entries.some((e) => !e.name.includes("/"))) {
    throw new Error(
      `archive root must be a <name>${BUNDLE_EXTENSION} directory, found: ${root}`,
    );
  }

  const files = new Map<string, Uint8Array>();
  // The large rows files, still compressed: read only when their table is.
  const compressed = new Map<string, LazyZipEntry>();
  for (const e of entries) {
    if ("data" in e) files.set(e.name.slice(root.length + 1), e.data);
    else compressed.set(e.name.slice(root.length + 1), e);
  }
  const text = (name: string): string | undefined => {
    const data = files.get(name);
    return data === undefined ? undefined : strFromU8(data);
  };

  const diagnostics: ValidationError[] = [];
  const meta =
    parseOptionalJsonText<BundleMeta>(BundleEntry.meta, text(BundleEntry.meta), diagnostics) ?? {};

  const names = new Set<string>();
  for (const name of [...files.keys(), ...compressed.keys()]) {
    const table = tableNameIn(name);
    if (table !== null && isTableName(table)) names.add(table);
  }

  const tables: Record<string, ParsedTable> = {};
  for (const name of [...names].sort()) {
    const prefix = `${tablePath(name)}/`;
    const schemaRaw = text(`${prefix}${TableEntry.schema}`);
    // Its rows files in order (D51), or formatVersion 1's rows.ndjson as 0001.
    const inRows = `${prefix}${TableEntry.rowsDir}/`;
    const shards = rowsFileOrder([...files.keys(), ...compressed.keys()].filter((p) => p.startsWith(inRows)).map((p) => p.slice(inRows.length)));
    const rowsFiles =
      shards.length > 0
        ? shards.map((n) => ({ name: n, path: `${inRows}${n}` }))
        : files.has(`${prefix}${TableEntry.rows}`) || compressed.has(`${prefix}${TableEntry.rows}`)
          ? [{ name: FIRST_ROWS_FILE, path: `${prefix}${TableEntry.rows}` }]
          : [];
    if (schemaRaw === undefined || rowsFiles.length === 0) {
      diagnostics.push({
        rowIndex: -1,
        message: `${tablePath(name)} isn't a table: it needs ${TableEntry.schema} and ${TableEntry.rowsDir}/`,
      });
      continue;
    }
    // Large rows, still compressed, handed over as they are: several files as one, in file order.
    const lazyRows = rowsFiles.some((f) => compressed.has(f.path))
      ? chained(rowsFiles.map((f) => ({ name: f.name, entry: compressed.get(f.path) ?? inflated(f.path, files.get(f.path)!) })))
      : undefined;
    const tableDiagnostics: ValidationError[] = [];
    // Fatal by design — do not wrap (same posture as parseTable).
    const schema = JSON.parse(schemaRaw) as TableSchema;
    const views =
      parseOptionalJsonText<View[]>(TableEntry.views, text(`${prefix}${TableEntry.views}`), tableDiagnostics) ?? [];
    const tableMeta =
      parseOptionalJsonText<TableMeta>(TableEntry.meta, text(`${prefix}${TableEntry.meta}`), tableDiagnostics) ?? {};

    const bodies: Record<string, string> = {};
    for (const file of files.keys()) {
      // Direct children of the table's bodies/ only, mirroring the directory parser.
      if (!file.startsWith(`${prefix}${TableEntry.bodies}/`) || !file.endsWith(BODY_EXTENSION)) continue;
      const inner = file.slice(`${prefix}${TableEntry.bodies}/`.length);
      if (inner.includes("/")) continue;
      bodies[inner.slice(0, -BODY_EXTENSION.length)] = strFromU8(files.get(file)!);
    }

    // Cells' own formulas (D52), from cells/ in name order; what doesn't apply is kept and said.
    const inCells = `${prefix}${CELLS_DIR}/`;
    const unreadCells: string[] = [];
    const cells: CellFormula[] = [];
    for (const n of rowsFileOrder([...files.keys(), ...compressed.keys()].filter((p) => p.startsWith(inCells) && !p.slice(inCells.length).includes("/")).map((p) => p.slice(inCells.length)))) {
      const path = `${inCells}${n}`;
      const raw = files.has(path) ? text(path) : strFromU8(whole(compressed.get(path)!));
      for (const c of parseCellsText(raw ?? "", tableDiagnostics, unreadCells, `${CELLS_DIR}/${n}`)) cells.push(c);
    }
    let elsewhere = false;
    const later = options.rows === "later";
    if (lazyRows && !later) {
      elsewhere = (await options.rowsLazily!(name, { schema, views, bodies, cells }, lazyRows)) === true;
      // Not taken: read as any other.
      if (!elsewhere) for (const f of rowsFiles) if (!files.has(f.path)) files.set(f.path, whole(compressed.get(f.path)!));
    }
    if (!elsewhere && !later) elsewhere = (await options.rowsElsewhere?.(name, { schema, views, bodies, cells }, joined(rowsFiles.map((f) => files.get(f.path)!)))) === true;
    const unread: UnreadLine[] = [];
    const rows: Row[] = [];
    const rowFiles: { name: string; ids: string[] }[] = [];
    if (!elsewhere && !later) {
      const seen = new Map<string, Row>();
      for (const f of rowsFiles) {
        const these = parseRowsText(text(f.path) ?? "", tableDiagnostics, unread, { file: f.path.endsWith(LEGACY_ROWS_FILE) ? LEGACY_ROWS_FILE : `${ROWS_DIR}/${f.name}`, after: rows.at(-1)?.id ?? null, seen });
        for (const r of these) rows.push(r);
        rowFiles.push({ name: f.name, ids: these.map((r) => r.id) });
      }
    }
    if (!elsewhere && !later) tableDiagnostics.push(...cellDiagnostics(schema, rows, cells));
    const table: ParsedTable = { schema, rows, views, meta: tableMeta, path: `${root}/${tablePath(name)}` };
    if (rowFiles.length > 0) table.rowFiles = rowFiles;
    if (cells.length > 0) table.cells = cells;
    if (unreadCells.length > 0) table.unreadCells = unreadCells;
    if (unread.length > 0) table.unread = unread;
    if (elsewhere) table.indexed = { count: 0, version: 0 };
    if (later) table.loading = { estimate: lazyRows ? estimateRows(lazyRows.size, lazyRows.head(ESTIMATE_HEAD)) : 0 };
    if (Object.keys(bodies).length > 0) table.bodies = bodies;
    // Its edit history travels with it, as it is: this reader doesn't judge its lines (section 14).
    const history = text(`${prefix}${TableEntry.history}`);
    if (history) table.history = history;
    if (tableDiagnostics.length > 0) table.diagnostics = tableDiagnostics;
    tables[name] = table;
  }

  const bundle: ParsedBundle = { meta, tables, path: root };
  if (diagnostics.length > 0) bundle.diagnostics = diagnostics;
  // Everything else it holds, as it is: a single-file save writes it back (section 13).
  const kept = Object.fromEntries([...files].filter(([path]) => !parsedHere(path, tables)));
  if (Object.keys(kept).length > 0) bundle.files = kept;
  return bundle;
}

/**
 * Whether a path inside a bundle is one the reader turns into the parsed
 * bundle (the manifest; a table's schema, rows, views, meta, history and
 * pages), so a writer writes it from that and not as a file. The index
 * is neither: it's never carried (section 13).
 */
/** Byte arrays one after another, as one (one is returned as it is). */
/** Whether a file's bytes need a line end before the next file's: they don't end in one. */
const unended = (bytes: Uint8Array): boolean => bytes.length > 0 && bytes[bytes.length - 1] !== 10;

/** A table's rows files' bytes as one, a line end between where a file had none. */
function joined(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let at = 0;
  parts.forEach((p, i) => {
    out.set(p, at);
    at += p.length;
    if (i < parts.length - 1 && unended(p)) out[at++] = 10;
  });
  return out.subarray(0, at);
}

/** A rows file already inflated (a small one), as an entry still to be read. */
function inflated(name: string, data: Uint8Array): LazyZipEntry {
  return { name, size: data.length, head: () => data, chunks: () => [data] };
}

/** A table's rows files as one entry: their bytes in file order, a line end between where a file had none; and each by its name. */
function chained(parts: { name: string; entry: LazyZipEntry }[]): LazyZipEntry {
  const entries = parts.map((p) => p.entry);
  return {
    parts,
    name: entries[0]!.name,
    size: entries.reduce((n, e) => n + e.size, 0),
    head(bytes) {
      const parts: Uint8Array[] = [];
      let have = 0;
      for (const e of entries) {
        if (have >= bytes) break;
        const part = e.head(bytes - have);
        parts.push(part);
        have += part.length;
        // Shorter than asked: that file is all there, and the next one follows it.
        if (part.length >= e.size) continue;
        break;
      }
      return joined(parts);
    },
    *chunks() {
      for (const e of entries) {
        let last: Uint8Array | null = null;
        for (const piece of e.chunks()) {
          if (piece.length > 0) last = piece;
          yield piece;
        }
        if (last && unended(last)) yield new Uint8Array([10]);
      }
    },
  };
}

function parsedHere(path: string, tables: Record<string, unknown>): boolean {
  if (path === BundleEntry.meta) return true;
  if (/(^|\/)index\.sqlite[^/]*$/.test(path)) return true;
  const table = tableNameIn(path);
  if (table === null || !(table in tables)) return false;
  const inside = path.slice(`${tablePath(table)}/`.length);
  if (([TableEntry.schema, TableEntry.rows, TableEntry.views, TableEntry.meta, TableEntry.history] as string[]).includes(inside)) return true;
  if (inside.startsWith(`${TableEntry.rowsDir}/`) && isRowsFileName(inside.slice(TableEntry.rowsDir.length + 1))) return true;
  if (inside.startsWith(`${CELLS_DIR}/`) && !inside.slice(CELLS_DIR.length + 1).includes("/")) return true;
  return inside.startsWith(`${TableEntry.bodies}/`) && inside.endsWith(BODY_EXTENSION) && !inside.slice(`${TableEntry.bodies}/`.length).includes("/");
}

/**
 * Serialise a bundle into `.table.zip` bytes in the canonical layout:
 * the manifest, then each table in display order under
 * `tables/<name>/`. `name` is the bundle's name — "crm" and
 * "crm.table" are both accepted; the archive root is always
 * `<name>.table/`.
 *
 * Output is byte-deterministic for identical input: fixed entry
 * order (manifest; per table schema, rows, views, meta, bodies sorted
 * by id), fixed timestamps, canonical serialisation shared with
 * `writeBundle`, then the bundle's other files (`files`: attachments,
 * histories, files no reader knows) by path. The rebuildable
 * `index.sqlite` cache is never carried (SPEC section 13).
 */
export async function writeTableArchive(
  name: string,
  input: WriteBundleInput | ParsedBundle,
): Promise<Uint8Array> {
  const bare = name.endsWith(BUNDLE_EXTENSION) ? name.slice(0, -BUNDLE_EXTENSION.length) : name;
  if (bare.length === 0 || bare.includes("/") || bare.includes("\\")) {
    throw new Error(`invalid table name: ${JSON.stringify(name)}`);
  }
  const root = `${bare}${BUNDLE_EXTENSION}`;
  const text = bundleFiles(input);
  const written = new Set(text.map((f) => f.path));
  // Its other files (attachments, histories, files no reader knows) after, by path; never the index.
  const files = Object.entries(input.files ?? {})
    .filter(([path]) => !written.has(path) && !/(^|\/)index\.sqlite[^/]*$/.test(path))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return writeZip([
    // strToU8, not a global TextEncoder — portable across Hermes.
    ...text.map((f) => ({ name: `${root}/${f.path}`, data: strToU8(f.content) })),
    ...files.map(([path, data]) => ({ name: `${root}/${path}`, data })),
  ]);
}

/** One file of a bundle: its path inside `<name>.table/`, and its text. */
export interface BundleFile {
  path: string;
  content: string;
}

/**
 * Every file a bundle's text is written as, in the archive's canonical
 * order (manifest; per table schema, rows, views, meta, its history when
 * it has one, bodies sorted by id), serialised exactly as `writeBundle` and the archive write them.
 * What a `.table` holds on disk, for showing or shipping. The rebuildable
 * `index.sqlite` and `attachments/` (bytes, not text) aren't included.
 */
export function bundleFiles(input: WriteBundleInput | ParsedBundle): BundleFile[] {
  const names = tableOrder(input);
  // A table whose rows haven't been read would be written without them.
  const loading = names.find((n) => "loading" in input.tables[n]! && (input.tables[n] as ParsedTable).loading);
  if (loading) throw new Error(`${loading}'s rows haven't been read yet, so it can't be written as an archive`);
  const files: BundleFile[] = [{ path: BundleEntry.meta, content: pretty(stampMeta({ ...(input.meta ?? {}), tables: names })) }];
  for (const tableName of names) {
    if (!isTableName(tableName)) throw new Error(`invalid table name: ${JSON.stringify(tableName)}`);
    const t = input.tables[tableName]!;
    const at = `${tablePath(tableName)}/`;
    files.push(
      { path: `${at}${TableEntry.schema}`, content: pretty(t.schema) },
      // Its rows, each in its file (D51).
      ...layoutRows(t.rows, rowLine(t.schema), { ...(t.rowFiles ? { files: t.rowFiles } : {}), ...(t.unread ? { unread: t.unread } : {}) }).map((f) => ({
        path: `${at}${TableEntry.rowsDir}/${f.name}`,
        content: f.text,
      })),
      // Its cells' own formulas (D52), beside the rows.
      ...layoutCells(t.schema, t.rows, t.cells, t.unreadCells).map((f) => ({ path: `${at}${CELLS_DIR}/${f.name}`, content: f.text })),
      { path: `${at}${TableEntry.views}`, content: pretty(t.views ?? []) },
      { path: `${at}${TableEntry.meta}`, content: pretty(tableMetaOnly(t.meta)) },
    );
    // Its edit history, byte for byte: it is the table's, and no writer's to rewrite.
    if (t.history) files.push({ path: `${at}${TableEntry.history}`, content: t.history });
    const bodies = t.bodies ?? {};
    for (const id of Object.keys(bodies).sort()) {
      files.push({ path: `${at}${TableEntry.bodies}/${id}${BODY_EXTENSION}`, content: normaliseBody(bodies[id]!) });
    }
  }
  return files;
}
