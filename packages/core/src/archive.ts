import { strFromU8, strToU8 } from "fflate";
import type {
  BundleMeta,
  ParsedBundle,
  ParsedTable,
  TableMeta,
  TableSchema,
  ValidationError,
  View,
} from "./types.js";
import type { WriteBundleInput } from "./io.js";
import { parseRowsText, parseOptionalJsonText } from "./parse-text.js";
import { normaliseBody, pretty, serializeRows, stampMeta, tableMetaOnly } from "./serialize.js";
import { isTableName, tableOrder } from "./bundle.js";
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
  rowsElsewhere?: (name: string, table: { schema: TableSchema; views: View[]; bodies: Record<string, string> }, rows: Uint8Array) => boolean | Promise<boolean>;
  /**
   * The same question, asked before a large `rows.ndjson` (of `lazyFrom`
   * bytes or more, 1 MB when left out) is inflated at all: it is handed
   * still compressed, to be read a piece at a time, so its start can be
   * shown while the rest is read. False inflates and parses it as usual.
   */
  rowsLazily?: (name: string, table: { schema: TableSchema; views: View[]; bodies: Record<string, string> }, rows: LazyZipEntry) => boolean | Promise<boolean>;
  lazyFrom?: number;
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
    lazy: (name, size) => !!options.rowsLazily && size >= lazyFrom && /^[^/]+\/tables\/[^/]+\/rows\.ndjson$/.test(name),
  }).filter((e) => !isJunk(e.name));
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
    parseOptionalJsonText<BundleMeta>("meta.json", text("meta.json"), diagnostics) ?? {};

  const names = new Set<string>();
  for (const name of [...files.keys(), ...compressed.keys()]) {
    const m = /^tables\/([^/]+)\//.exec(name);
    if (m && isTableName(m[1]!)) names.add(m[1]!);
  }

  const tables: Record<string, ParsedTable> = {};
  for (const name of [...names].sort()) {
    const prefix = `tables/${name}/`;
    const schemaRaw = text(`${prefix}schema.json`);
    const lazyRows = compressed.get(`${prefix}rows.ndjson`);
    if (schemaRaw === undefined || (text(`${prefix}rows.ndjson`) === undefined && !lazyRows)) {
      diagnostics.push({
        rowIndex: -1,
        message: `tables/${name} isn't a table: it needs schema.json and rows.ndjson`,
      });
      continue;
    }
    const tableDiagnostics: ValidationError[] = [];
    // Fatal by design — do not wrap (same posture as parseTable).
    const schema = JSON.parse(schemaRaw) as TableSchema;
    const views =
      parseOptionalJsonText<View[]>("views.json", text(`${prefix}views.json`), tableDiagnostics) ?? [];
    const tableMeta =
      parseOptionalJsonText<TableMeta>("meta.json", text(`${prefix}meta.json`), tableDiagnostics) ?? {};

    const bodies: Record<string, string> = {};
    for (const file of files.keys()) {
      // Direct children of the table's bodies/ only, mirroring the directory parser.
      if (!file.startsWith(`${prefix}bodies/`) || !file.endsWith(".md")) continue;
      const inner = file.slice(`${prefix}bodies/`.length);
      if (inner.includes("/")) continue;
      bodies[inner.slice(0, -".md".length)] = strFromU8(files.get(file)!);
    }

    let elsewhere = false;
    if (lazyRows) {
      elsewhere = (await options.rowsLazily!(name, { schema, views, bodies }, lazyRows)) === true;
      // Not taken: read as any other.
      if (!elsewhere) files.set(`${prefix}rows.ndjson`, whole(lazyRows));
    }
    if (!elsewhere) elsewhere = (await options.rowsElsewhere?.(name, { schema, views, bodies }, files.get(`${prefix}rows.ndjson`)!)) === true;
    const rows = elsewhere ? [] : parseRowsText(text(`${prefix}rows.ndjson`) ?? "", tableDiagnostics);
    const table: ParsedTable = { schema, rows, views, meta: tableMeta, path: `${root}/tables/${name}` };
    if (elsewhere) table.indexed = { count: 0, version: 0 };
    if (Object.keys(bodies).length > 0) table.bodies = bodies;
    if (tableDiagnostics.length > 0) table.diagnostics = tableDiagnostics;
    tables[name] = table;
  }

  const bundle: ParsedBundle = { meta, tables, path: root };
  if (diagnostics.length > 0) bundle.diagnostics = diagnostics;
  return bundle;
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
 * `writeBundle`. The rebuildable `index.sqlite` cache and
 * `attachments/` are not carried by this writer (see SPEC section 13).
 */
export async function writeTableArchive(
  name: string,
  input: WriteBundleInput | ParsedBundle,
): Promise<Uint8Array> {
  const bare = name.endsWith(".table") ? name.slice(0, -".table".length) : name;
  if (bare.length === 0 || bare.includes("/") || bare.includes("\\")) {
    throw new Error(`invalid table name: ${JSON.stringify(name)}`);
  }
  const root = `${bare}.table`;
  return writeZip(
    // strToU8, not a global TextEncoder — portable across Hermes.
    bundleFiles(input).map((f) => ({ name: `${root}/${f.path}`, data: strToU8(f.content) })),
  );
}

/** One file of a bundle: its path inside `<name>.table/`, and its text. */
export interface BundleFile {
  path: string;
  content: string;
}

/**
 * Every file a bundle's text is written as, in the archive's canonical
 * order (manifest; per table schema, rows, views, meta, bodies sorted by
 * id), serialised exactly as `writeBundle` and the archive write them.
 * What a `.table` holds on disk, for showing or shipping. The rebuildable
 * `index.sqlite` and `attachments/` (bytes, not text) aren't included.
 */
export function bundleFiles(input: WriteBundleInput | ParsedBundle): BundleFile[] {
  const names = tableOrder(input);
  const files: BundleFile[] = [{ path: "meta.json", content: pretty(stampMeta({ ...(input.meta ?? {}), tables: names })) }];
  for (const tableName of names) {
    if (!isTableName(tableName)) throw new Error(`invalid table name: ${JSON.stringify(tableName)}`);
    const t = input.tables[tableName]!;
    const at = `tables/${tableName}/`;
    files.push(
      { path: `${at}schema.json`, content: pretty(t.schema) },
      { path: `${at}rows.ndjson`, content: serializeRows(t.rows, t.schema) },
      { path: `${at}views.json`, content: pretty(t.views ?? []) },
      { path: `${at}meta.json`, content: pretty(tableMetaOnly(t.meta)) },
    );
    const bodies = t.bodies ?? {};
    for (const id of Object.keys(bodies).sort()) {
      files.push({ path: `${at}bodies/${id}.md`, content: normaliseBody(bodies[id]!) });
    }
  }
  return files;
}
