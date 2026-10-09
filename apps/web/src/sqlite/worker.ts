// Owns one bundle's index in a worker: a SQLite database in the browser's
// own file storage (OPFS, through the opfs-sahpool VFS, which needs no
// special headers and runs in Safari, Firefox and Chromium), or in memory
// when the browser gives none. The page talks to it through client.ts; the
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
  type Row,
  type SqlDriver,
  type SqlValue,
  type TableSchema,
} from "@workspace.sh/table-core";

export type Request = { id: number } & (
  | { op: "open"; name: string }
  | { op: "exec"; sql: string }
  | { op: "run"; sql: string; params: SqlValue[] }
  | { op: "all"; sql: string; params: SqlValue[] }
  | { op: "batch"; sql: string; params: SqlValue[][] }
  | { op: "openZip"; bytes: Uint8Array; taken: string[]; from?: number }
  | { op: "ensure"; name: string; schema: TableSchema }
  | { op: "build"; name: string; schema: TableSchema }
  | { op: "save"; name: string; schema: TableSchema; rows: boolean; omit?: string[] }
  | { op: "search"; name: string }
  | { op: "rows"; request: RowsRequest }
  | { op: "timings" }
  | { op: "close" }
);

/** What reading an archive here gives the page. */
export interface OpenedLarge {
  opened: OpenedBundle;
  /** Each large table's first rows, to show while the rest are read. */
  first: Record<string, Row[]>;
  /** False when the browser gave no file storage: the index is in memory, and gone with the page. */
  persistent: boolean;
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

let db: { close(): void } | null = null;
let driver: SqlDriver | null = null;
let bundle = "";
let persistent = false;
let serve: ((request: RowsRequest) => Promise<unknown>) | null = null;
// When the page last asked for something: the search index's steps wait for a quiet moment.
let lastAsked = 0;
const timings: { what: string; ms: number; waited: number }[] = [];
// Large tables read from an archive and not yet in the index: their rows.ndjson, as bytes.
const waiting = new Map<string, { rows: Uint8Array; bodies: Record<string, string> }>();

const post = (response: Response) => (self as unknown as Worker).postMessage(response);

async function open(name: string): Promise<{ persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule();
  bundle = name;
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "table-index", initialCapacity: 6 });
    const file = new pool.OpfsSAHPoolDb(`/${name}.sqlite`);
    db = file;
    driver = oo1Driver(file);
    serve = rowsServer(driver);
    await driver.exec("pragma page_size=32768; pragma journal_mode=memory; pragma synchronous=off; pragma temp_store=memory; pragma cache_size=-65536;");
    persistent = true;
  } catch {
    const memory = new sqlite3.oo1.DB(":memory:");
    db = memory;
    driver = oo1Driver(memory);
    serve = rowsServer(driver);
    persistent = false;
  }
  return { persistent };
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
  try {
    file.truncate(0);
    let at = 0;
    for await (const piece of pieces) at += file.write(piece, { at });
    file.flush();
  } finally {
    file.close();
  }
}

async function readRows(table: string): Promise<Uint8Array | null> {
  const file = await rowsFile(table, false);
  if (!file) return null;
  try {
    const bytes = new Uint8Array(file.getSize());
    file.read(bytes, { at: 0 });
    return bytes;
  } finally {
    file.close();
  }
}

// -- What the page asks -----------------------------------------------------

async function openZip(req: Request & { op: "openZip" }): Promise<OpenedLarge> {
  const from = req.from ?? INDEXED_FROM;
  const first: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  const opened = await openArchive(req.bytes, req.taken, {
    rowsElsewhere: (name, table, rows) => {
      if (!canBeIndexed(table)) return false;
      const count = linesInBytes(rows);
      if (count < from) return false;
      waiting.set(name, { rows, bodies: table.bodies });
      first[name] = firstRowsInBytes(rows, FIRST_ROWS);
      counts[name] = count;
      return true;
    },
  });
  for (const [name, count] of Object.entries(counts)) opened.bundle.tables[name]!.indexed = { count, version: 0 };
  if (waiting.size > 0) await open(opened.key);
  return { opened, first, persistent };
}

async function build(id: number, name: string, schema: TableSchema, rows: Uint8Array, bodies: Record<string, string> | undefined): Promise<number> {
  return buildIndexFromBytes(driver!, { name, schema, rows, ...(bodies ? { bodies } : {}), key: "saved", onProgress: (done, total) => post({ id, progress: [done, total] }) });
}

async function ensure(req: Request & { op: "ensure" }): Promise<number> {
  const fresh = waiting.get(req.name);
  if (fresh) {
    const count = await build(req.id, req.name, req.schema, fresh.rows, fresh.bodies);
    await writeRows(req.name, [fresh.rows]);
    waiting.delete(req.name);
    return count;
  }
  // Opened before: the index kept in this browser, or its rows to make it from again.
  const held = await queryIndex(driver!, { name: req.name, schema: req.schema });
  if (held) return held.count;
  const kept = await readRows(req.name);
  if (!kept) throw new Error("its rows are no longer in this browser's storage");
  return build(req.id, req.name, req.schema, kept, undefined);
}

async function handle(req: Request): Promise<unknown> {
  if (req.op === "open") return open(req.name);
  if (req.op === "openZip") return openZip(req);
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
      db?.close();
      db = driver = null;
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
      const value = await handle(req);
      // What each thing asked took here, and how long it waited its turn: for measuring (BENCHMARKING.md).
      if (timings.length < 500) timings.push({ what: req.op === "rows" ? req.request.ask : req.op, ms: Math.round((performance.now() - from) * 10) / 10, waited });
      post({ id: req.id, ok: true, value });
    } catch (err) {
      post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
};
