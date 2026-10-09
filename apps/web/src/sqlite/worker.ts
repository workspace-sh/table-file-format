// Owns the page's indexes in one worker: a SQLite database for each bundle
// in the browser's own file storage (OPFS, through the opfs-sahpool VFS,
// which needs no special headers and runs in Safari, Firefox and Chromium),
// or in memory when the browser gives none. One worker for every bundle,
// because the storage's pool of files belongs to whoever opens it first: a
// second worker (or a second tab) gets memory only. The page talks to it through client.ts; the
// SQL is the indexer's, run by core's oo1Driver.
//
// A large table never reaches the page as rows. Its archive is read here:
// the table's rows.ndjson is taken as bytes, streamed into the index, and
// kept as a file beside it, which stays the truth (SPEC section 8). The
// page gets the first rows to show meanwhile, and how far the reading is.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { INDEXED_FROM, buildIndexFromBytes, canBeIndexed, firstRowsInBytes, linesInBytes, openArchive, rowsServer, type OpenedBundle, type RowsRequest } from "@workspace.sh/table-app";
import {
  buildSearchIndex,
  oo1Driver,
  queryIndex,
  setIndexKey,
  storedRows,
  type LazyZipEntry,
  type Row,
  type SqlDriver,
  type SqlValue,
  type TableSchema,
} from "@workspace.sh/table-core";

export type Request = { id: number } & (
  | { op: "openZip"; bytes: Uint8Array; taken: string[]; from?: number }
  | { op: "timings" }
  | ({ bundle: string } & (
      | { op: "open" }
      | { op: "exec"; sql: string }
      | { op: "run"; sql: string; params: SqlValue[] }
      | { op: "all"; sql: string; params: SqlValue[] }
      | { op: "batch"; sql: string; params: SqlValue[][] }
      | { op: "ensure"; name: string; schema: TableSchema }
      | { op: "build"; name: string; schema: TableSchema }
      | { op: "save"; name: string; schema: TableSchema; rows: boolean; omit?: string[] }
      | { op: "search"; name: string }
      | { op: "rows"; request: RowsRequest }
      | { op: "persistent" }
      | { op: "close" }
    ))
);

/** What reading an archive here gives the page. */
export interface OpenedLarge {
  opened: OpenedBundle;
  /** Each large table's first rows, to show while the rest are read. */
  first: Record<string, Row[]>;
}

export type Response =
  | { id: number; ok: true; value?: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: [done: number, total: number] };

/** Rows a step of the search index takes: small enough that what the page asks between steps isn't kept waiting. */
const SEARCH_STEP = 5000;

/** How long the page must have asked for nothing before a step of the search index is taken. */
const QUIET_MS = 250;

/** Rows shown from the head of a table while it is read. */
const FIRST_ROWS = 200;

/** One bundle's database, open. */
interface Held {
  db: { close(): void };
  driver: SqlDriver;
  serve: (request: RowsRequest) => Promise<unknown>;
  persistent: boolean;
}
const held = new Map<string, Held>();
// Each bundle's database on its way open: an archive's first rows don't wait for it.
const opening = new Map<string, Promise<Held>>();
// The bundle the request in hand is for. Requests run one at a time, so these are its own.
let bundle = "";
let driver: SqlDriver | null = null;
let persistent = false;
let serve: ((request: RowsRequest) => Promise<unknown>) | null = null;
// When the page last asked for something: the search index's steps wait for a quiet moment.
let lastAsked = 0;
const timings: { what: string; ms: number; waited: number }[] = [];
// Large tables read from an archive and not yet in the index, by `bundle/table`: their rows.ndjson, still compressed.
const waiting = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();

const post = (response: Response) => (self as unknown as Worker).postMessage(response);

type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite["installOpfsSAHPoolVfs"]>>;
let engine: Promise<{ sqlite3: Sqlite; pool: Pool | null }> | null = null;
/** SQLite, and the browser's file storage for it when it gives any: asked for once. */
function started(): Promise<{ sqlite3: Sqlite; pool: Pool | null }> {
  return (engine ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    try {
      return { sqlite3, pool: await sqlite3.installOpfsSAHPoolVfs({ name: "table-index", initialCapacity: 6 }) };
    } catch {
      return { sqlite3, pool: null };
    }
  })());
}

function open(name: string): Promise<Held> {
  let on = opening.get(name);
  if (!on) {
    on = (async (): Promise<Held> => {
      const { sqlite3, pool } = await started();
      let made: Held | null = null;
      if (pool) {
        try {
          // A file each, and room for a few more.
          await pool.reserveMinimumCapacity(held.size + 4);
          const file = new pool.OpfsSAHPoolDb(`/${name}.sqlite`);
          const d = oo1Driver(file);
          await d.exec("pragma page_size=32768; pragma journal_mode=memory; pragma synchronous=off; pragma temp_store=memory; pragma cache_size=-65536;");
          made = { db: file, driver: d, serve: rowsServer(d), persistent: true };
        } catch {
          made = null;
        }
      }
      if (!made) {
        const memory = new sqlite3.oo1.DB(":memory:");
        const d = oo1Driver(memory);
        made = { db: memory, driver: d, serve: rowsServer(d), persistent: false };
      }
      held.set(name, made);
      return made;
    })();
    opening.set(name, on);
  }
  return on;
}

/** Make `name` the bundle the request in hand is for. */
async function use(name: string): Promise<void> {
  const h = await open(name);
  bundle = name;
  driver = h.driver;
  serve = h.serve;
  persistent = h.persistent;
}

// -- The rows files, beside the index ---------------------------------------

type SyncHandle = { getSize(): number; read(into: Uint8Array, at: { at: number }): number; write(from: Uint8Array, at: { at: number }): number; truncate(size: number): void; flush(): void; close(): void };

async function rowsFile(table: string, create: boolean): Promise<SyncHandle | null> {
  if (!persistent) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("table-rows", { create: true });
    const file = await dir.getFileHandle(`${bundle}--${table}.ndjson`, { create });
    return (await (file as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
  } catch {
    return null;
  }
}

async function writeRows(table: string, pieces: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<void> {
  const file = await rowsFile(table, true);
  if (!file) return;
  let at = 0;
  try {
    file.truncate(0);
    for await (const piece of pieces) at += file.write(piece, { at });
    file.flush();
  } finally {
    file.close();
  }
  await kept(table, at);
}

/** Say a table's rows file is whole, at this many bytes: one cut short (the page closed while it was written) isn't taken for the table. */
async function kept(table: string, bytes: number): Promise<void> {
  await driver!.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  await driver!.run("insert or replace into _kept(name, bytes) values(?, ?)", [table, bytes]);
}

async function readRows(table: string): Promise<Uint8Array | null> {
  await driver!.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  const whole = (await driver!.all("select bytes from _kept where name = ?", [table]))[0]?.bytes;
  const file = await rowsFile(table, false);
  if (!file) return null;
  try {
    if (whole === undefined || file.getSize() !== Number(whole)) return null;
    const bytes = new Uint8Array(file.getSize());
    file.read(bytes, { at: 0 });
    return bytes;
  } finally {
    file.close();
  }
}

// -- What the page asks -----------------------------------------------------

/** How much of a large table's start is inflated for its first rows, and to judge how many rows it has. */
const HEAD_BYTES = 256 * 1024;

async function openZip(req: Request & { op: "openZip" }): Promise<OpenedLarge> {
  const from = req.from ?? INDEXED_FROM;
  const first: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  const large = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();
  const opened = await openArchive(req.bytes, req.taken, {
    // A large table's rows are left compressed: only their start is read here, so the
    // page has rows to show at once, however large the table. The rest is read by `ensure`.
    rowsLazily: (name, table, rows) => {
      if (!canBeIndexed(table)) return false;
      const head = rows.head(HEAD_BYTES);
      // How many rows it holds isn't known until it's all read: judged from how many its start holds.
      const count = head.length >= rows.size ? linesInBytes(head) : Math.round((linesInBytes(head) / head.length) * rows.size);
      if (count < from) return false;
      large.set(name, { rows, bodies: table.bodies });
      first[name] = firstRowsInBytes(head, FIRST_ROWS);
      counts[name] = count;
      return true;
    },
  });
  for (const [name, count] of Object.entries(counts)) opened.bundle.tables[name]!.indexed = { count, version: 0 };
  for (const [name, table] of large) waiting.set(`${opened.key}/${name}`, table);
  // Not waited for: whatever is asked of this bundle next is answered after it.
  if (large.size > 0) void open(opened.key);
  return { opened, first };
}

async function build(id: number, name: string, schema: TableSchema, rows: Uint8Array, bodies: Record<string, string> | undefined): Promise<number> {
  return buildIndexFromBytes(driver!, { name, schema, rows, ...(bodies ? { bodies } : {}), key: "saved", onProgress: (done, total) => post({ id, progress: [done, total] }) });
}

async function ensure(req: Request & { op: "ensure" }): Promise<number> {
  const fresh = waiting.get(`${bundle}/${req.name}`);
  if (fresh) {
    // Read a piece at a time: into the index, and into the file kept beside it.
    const file = await rowsFile(req.name, true);
    let at = 0;
    file?.truncate(0);
    try {
      const count = await buildIndexFromBytes(driver!, {
        name: req.name,
        schema: req.schema,
        rows: { chunks: fresh.rows.chunks(), size: fresh.rows.size, keep: (chunk) => file && (at += file.write(chunk, { at })) },
        bodies: fresh.bodies,
        key: "saved",
        onProgress: (done, total) => post({ id: req.id, progress: [done, total] }),
      });
      file?.flush();
      await kept(req.name, at);
      waiting.delete(`${bundle}/${req.name}`);
      return count;
    } catch (error) {
      // A damaged archive is found out at its end: nothing of it is kept.
      file?.truncate(0);
      throw error;
    } finally {
      file?.close();
    }
  }
  // Opened before: the index kept in this browser, or its rows to make it from again.
  const held = await queryIndex(driver!, { name: req.name, schema: req.schema });
  if (held) return held.count;
  const rows = await readRows(req.name);
  if (!rows) throw new Error("its rows are no longer in this browser's storage");
  return build(req.id, req.name, req.schema, rows, undefined);
}

async function handle(req: Request & { bundle: string }): Promise<unknown> {
  await use(req.bundle);
  if (req.op === "open") return undefined;
  if (req.op === "persistent") return persistent;
  if (!driver) throw new Error("the database is not open");
  switch (req.op) {
    case "exec":
      return driver.exec(req.sql);
    case "run":
      return driver.run(req.sql, req.params);
    case "all":
      return driver.all(req.sql, req.params);
    case "batch":
      return driver.batch!(req.sql, req.params);
    case "rows":
      return serve!(req.request);
    case "ensure":
      return ensure(req);
    case "build": {
      const kept = await readRows(req.name);
      if (!kept) throw new Error("its rows are no longer in this browser's storage");
      return build(req.id, req.name, req.schema, kept, undefined);
    }
    case "save": {
      if (req.rows) {
        const encoder = new TextEncoder();
        const source = storedRows(driver, { name: req.name, schema: req.schema, ...(req.omit ? { omit: req.omit } : {}) });
        await writeRows(
          req.name,
          (async function* () {
            for await (const text of source) yield encoder.encode(text);
          })(),
        );
      }
      return setIndexKey(driver, req.name, "saved");
    }
    case "close":
      held.get(bundle)?.db.close();
      held.delete(bundle);
      opening.delete(bundle);
      driver = serve = null;
  }
}

// Requests run one at a time, in the order they came: the indexer's begin/commit pairs depend on it.
let queue: Promise<unknown> = Promise.resolve();

/** A search index is made a step at a time, each behind whatever the page asked meanwhile. */
function searchStep(req: Request & { op: "search" }): void {
  // The page comes first: a step waits until it has asked for nothing for a moment.
  if (Date.now() - lastAsked < QUIET_MS) return void setTimeout(() => searchStep(req), QUIET_MS / 2);
  queue = queue
    .then(async () => {
      await use(req.bundle);
      const from = performance.now();
      const more = driver ? await buildSearchIndex(driver, req.name, SEARCH_STEP) : false;
      if (timings.length < 500) timings.push({ what: "search step", ms: Math.round((performance.now() - from) * 10) / 10, waited: 0 });
      return more;
    })
    .then(
      (more) => {
        if (more) setTimeout(() => searchStep(req), 0);
        else post({ id: req.id, ok: true });
      },
      (err: unknown) => post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) }),
    );
}

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  if (req.op === "search") return searchStep(req);
  lastAsked = Date.now();
  queue = queue.then(async () => {
    try {
      if (req.op === "timings") return post({ id: req.id, ok: true, value: timings.splice(0) });
      const waited = Date.now() - lastAsked;
      const from = performance.now();
      const value = req.op === "openZip" ? await openZip(req) : await handle(req);
      // What each thing asked took here, and how long it waited its turn: for measuring (BENCHMARKING.md).
      if (timings.length < 500) timings.push({ what: req.op === "rows" ? req.request.ask : req.op, ms: Math.round((performance.now() - from) * 10) / 10, waited });
      post({ id: req.id, ok: true, value });
    } catch (err) {
      post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
};
