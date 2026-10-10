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
  indexKey,
  oo1Driver,
  queryIndex,
  rowsBeingBuilt,
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
      | { op: "save"; name: string; schema: TableSchema; rows: boolean; omit?: string[]; whole?: boolean }
      | { op: "search"; name: string }
      | { op: "rows"; request: RowsRequest }
      | { op: "peek"; name: string; start: number; end: number }
      | { op: "persistent" }
      | { op: "storage" }
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
/** Keep what a thing took: the last 500, so a long job's end isn't lost behind its beginning. */
const timed = (entry: { what: string; ms: number; waited: number }): void => {
  if (timings.length >= 500) timings.shift();
  timings.push(entry);
};
// Large tables read from an archive and not yet in the index, by `bundle/table`: their rows.ndjson, still compressed.
const waiting = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();

const post = (response: Response) => (self as unknown as Worker).postMessage(response);

type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite["installOpfsSAHPoolVfs"]>>;
let engine: Promise<{ sqlite3: Sqlite; pool: Pool | null }> | null = null;
/** Why the browser's storage couldn't be had, when it couldn't: another tab of the app holds it, or the browser gives none. */
let noStorage: "elsewhere" | "none" | null = null;
/** SQLite, and the browser's file storage for it when it gives any: asked for once. */
function started(): Promise<{ sqlite3: Sqlite; pool: Pool | null }> {
  return (engine ??= (async () => {
    const sqlite3 = await sqlite3InitModule();
    try {
      return { sqlite3, pool: await sqlite3.installOpfsSAHPoolVfs({ name: "table-index", initialCapacity: 6 }) };
    } catch (error) {
      // Another tab's worker has the storage's files open: a browser gives them to one at a time.
      noStorage = error instanceof Error && error.name === "NoModificationAllowedError" ? "elsewhere" : "none";
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

/** A bundle, and the database to ask: the one in hand, or a build's own way of asking (a statement at a time). */
interface On {
  bundle: string;
  db: SqlDriver;
  persistent: boolean;
}
const here = (): On => ({ bundle, db: driver!, persistent });

async function rowsFile(on: On, table: string, create: boolean): Promise<SyncHandle | null> {
  if (!on.persistent) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("table-rows", { create: true });
    const file = await dir.getFileHandle(`${on.bundle}--${table}.ndjson`, { create });
    return (await (file as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()) as SyncHandle;
  } catch {
    return null;
  }
}

/** Say a table's rows file is whole, at this many bytes: one cut short (the page closed while it was written) isn't taken for the table. */
async function kept(on: On, table: string, bytes: number): Promise<void> {
  await on.db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  await on.db.run("insert or replace into _kept(name, bytes) values(?, ?)", [table, bytes]);
}

/**
 * Write a table's rows file from its pieces. `stop` is asked before each
 * piece: true leaves the file cut short, which isn't taken for the table
 * (it's marked as not whole from the start), and gives false.
 */
async function writeRows(on: On, table: string, pieces: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, stop?: () => boolean): Promise<boolean> {
  const file = await rowsFile(on, table, true);
  if (!file) return true;
  let at = 0;
  try {
    await kept(on, table, -1);
    file.truncate(0);
    for await (const piece of pieces) {
      if (stop?.()) return false;
      at += file.write(piece, { at });
    }
    file.flush();
  } finally {
    file.close();
  }
  await kept(on, table, at);
  return true;
}

async function readRows(on: On, table: string): Promise<Uint8Array | null> {
  await on.db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  const whole = (await on.db.all("select bytes from _kept where name = ?", [table]))[0]?.bytes;
  const file = await rowsFile(on, table, false);
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
      // (To two figures, when judged: it is shown until the reading is done.)
      const judged = Math.round((linesInBytes(head) / head.length) * rows.size);
      const figures = 10 ** Math.max(0, String(judged).length - 2);
      const count = head.length >= rows.size ? linesInBytes(head) : Math.round(judged / figures) * figures;
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

/** Make a table's index: from an archive just read, kept from before, or again from its rows kept here. */
async function ensure(on: On, id: number, name: string, schema: TableSchema, again: boolean): Promise<number> {
  const progress = (done: number, total: number) => post({ id, progress: [done, total] });
  const fresh = again ? undefined : waiting.get(`${on.bundle}/${name}`);
  if (fresh) {
    // Read a piece at a time: into the index, and into the file kept beside it.
    const file = await rowsFile(on, name, true);
    let at = 0;
    file?.truncate(0);
    try {
      const count = await buildIndexFromBytes(on.db, {
        name,
        schema,
        rows: { chunks: fresh.rows.chunks(), size: fresh.rows.size, keep: (chunk) => file && (at += file.write(chunk, { at })) },
        bodies: fresh.bodies,
        key: "saved",
        onProgress: progress,
      });
      file?.flush();
      await kept(on, name, at);
      waiting.delete(`${on.bundle}/${name}`);
      return count;
    } catch (error) {
      // A damaged archive is found out at its end: nothing of it is kept.
      file?.truncate(0);
      throw error;
    } finally {
      file?.close();
    }
  }
  if (!again) {
    // Opened before: the index kept in this browser.
    const held = await queryIndex(on.db, { name, schema });
    if (held) return held.count;
  }
  const rows = await readRows(on, name);
  if (!rows) throw new Error("its rows are no longer in this browser's storage");
  return buildIndexFromBytes(on.db, { name, schema, rows, key: "saved", onProgress: progress });
}

async function handle(req: Request & { bundle: string }): Promise<unknown> {
  await use(req.bundle);
  if (req.op === "open") return undefined;
  if (req.op === "persistent") return persistent;
  if (req.op === "storage") return persistent ? "kept" : (noStorage ?? "none");
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
      if (req.request.ask === "edits") edited.set(`${bundle}/${req.request.name}`, (edited.get(`${bundle}/${req.request.name}`) ?? 0) + 1);
      return serve!(req.request);
    case "peek":
      return rowsBeingBuilt(driver, req.name, req.start, req.end);
    case "close":
      held.get(bundle)?.db.close();
      held.delete(bundle);
      opening.delete(bundle);
      driver = serve = null;
  }
}

// Requests run one at a time, in the order they came: the indexer's begin/commit pairs depend on it.
let queue: Promise<unknown> = Promise.resolve();
/** Take a turn in the queue. */
const inTurn = <T,>(run: () => Promise<T>): Promise<T> => {
  const turn = queue.then(run);
  queue = turn.catch(() => {});
  return turn;
};

// Bundles with a build under way, and when each is done. A build doesn't hold
// the queue: each of its statements takes a turn, so the page's reads are
// answered between them, and see the rows it has put in so far (they are on
// its connection). Anything that would write to that bundle waits for it:
// a build is one transaction, and would take the write with it if it failed.
const building = new Map<string, Promise<unknown>>();
const writes = (req: Request): boolean =>
  req.op === "ensure" || req.op === "build" || req.op === "save" || req.op === "search" || req.op === "run" || req.op === "exec" || req.op === "batch" || (req.op === "rows" && req.request.ask === "edits");

/** Resolves once the messages already sent to this worker have been taken in. (A channel to itself: a timer would be held back to 4 ms a time.) */
const turnstile = new MessageChannel();
const hearing: (() => void)[] = [];
turnstile.port1.onmessage = () => hearing.shift()?.();
const heard = (): Promise<void> =>
  new Promise((resolve) => {
    hearing.push(resolve);
    turnstile.port2.postMessage(0);
  });

/**
 * A database asked a statement at a time, each in its turn. Before each,
 * the worker hears what the page has sent: SQLite here answers without ever
 * waiting, so a long job would otherwise run from start to end with every
 * message from the page left unread.
 */
const steppedOver = (d: SqlDriver): SqlDriver => ({
  exec: (sql) => heard().then(() => inTurn(() => d.exec(sql))),
  run: (sql, params) => heard().then(() => inTurn(() => d.run(sql, params))),
  all: (sql, params) => heard().then(() => inTurn(() => d.all(sql, params))),
  batch: (sql, params) => heard().then(() => inTurn(() => d.batch!(sql, params))),
});

function build(req: Request & { op: "ensure" | "build" }): void {
  // A save under way has the rows file: the build reads it after.
  const after = Promise.all([building.get(req.bundle), saving.get(req.bundle)]);
  const done = after
    .then(() => open(req.bundle))
    .then((h) => {
      const stepped = steppedOver(h.driver);
      const from = performance.now();
      return ensure({ bundle: req.bundle, db: stepped, persistent: h.persistent }, req.id, req.name, req.schema, req.op === "build").then((count) => {
        timed({ what: req.op, ms: Math.round(performance.now() - from), waited: 0 });
        return count;
      });
    });
  building.set(
    req.bundle,
    done.then(
      () => {},
      () => {},
    ),
  );
  done.then(
    (value) => post({ id: req.id, ok: true, value }),
    (err: unknown) => post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) }),
  );
}

// How many edits each table (`bundle/table`) has had, for a save to know one was made while it wrote.
const edited = new Map<string, number>();
// Bundles with a save under way, and when each is done: one at a time has a table's rows file.
const saving = new Map<string, Promise<unknown>>();
let savesUnderWay = 0;

/**
 * A table's rows written out of the index to its rows file, and the index
 * stamped as saved. Like a build it doesn't hold the queue: each piece it
 * reads takes a turn, so the page's reads and edits are answered between
 * them (a million rows take some twelve seconds to write).
 *
 * An edit made meanwhile stops it: the file would be out of date as it was
 * finished, and the page saves again after the edit. It answers false then,
 * and the file is left marked as not whole. A save asked for `whole` is the
 * one a build is about to read: it runs to its end whatever happens.
 */
function save(req: Request & { op: "save" }): void {
  savesUnderWay++;
  const after = saving.get(req.bundle) ?? Promise.resolve();
  const done = after
    .then(() => open(req.bundle))
    .then(async (h) => {
      const from = performance.now();
      const on: On = { bundle: req.bundle, db: steppedOver(h.driver), persistent: h.persistent };
      const table = `${req.bundle}/${req.name}`;
      const had = edited.get(table) ?? 0;
      const editedSince = () => !req.whole && (edited.get(table) ?? 0) !== had;
      let saved = true;
      // Rows the file doesn't have yet are written whether or not the page knows of them:
      // the index says (edits made before a reload, whose save was stopped or never began).
      if (req.rows || (await indexKey(on.db, req.name)) !== "saved") {
        const encoder = new TextEncoder();
        const source = storedRows(on.db, { name: req.name, schema: req.schema, ...(req.omit ? { omit: req.omit } : {}) });
        saved = await writeRows(
          on,
          req.name,
          (async function* () {
            for await (const text of source) yield encoder.encode(text);
          })(),
          editedSince,
        );
      }
      // Stamped in one turn with the last look, so no edit comes between them.
      if (saved) {
        saved = await inTurn(async () => {
          if (editedSince()) return false;
          await setIndexKey(h.driver, req.name, "saved");
          return true;
        });
      }
      timed({ what: saved ? "save" : "save stopped", ms: Math.round(performance.now() - from), waited: 0 });
      return saved;
    })
    .finally(() => {
      savesUnderWay--;
    });
  saving.set(
    req.bundle,
    done.then(
      () => {},
      () => {},
    ),
  );
  done.then(
    (value) => post({ id: req.id, ok: true, value }),
    (err: unknown) => post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) }),
  );
}

/** A search index is made a step at a time, each behind whatever the page asked meanwhile. */
function searchStep(req: Request & { op: "search" }): void {
  // The page comes first: a step waits until it has asked for nothing for a moment.
  // So does a save: its rows are the person's edits on their way to the file.
  if (savesUnderWay > 0 || Date.now() - lastAsked < QUIET_MS) return void setTimeout(() => searchStep(req), QUIET_MS / 2);
  inTurn(async () => {
    await use(req.bundle);
    const from = performance.now();
    const more = driver ? await buildSearchIndex(driver, req.name, SEARCH_STEP) : false;
    timed({ what: "search step", ms: Math.round((performance.now() - from) * 10) / 10, waited: 0 });
    return more;
  }).then(
    (more) => {
      if (more) setTimeout(() => searchStep(req), 0);
      else post({ id: req.id, ok: true });
    },
    (err: unknown) => post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) }),
  );
}

function take(req: Request): void {
  if (req.op === "ensure" || req.op === "build") return build(req);
  if (req.op === "search") return searchStep(req);
  if (req.op === "save") return save(req);
  lastAsked = Date.now();
  void inTurn(async () => {
    try {
      if (req.op === "timings") return post({ id: req.id, ok: true, value: timings.splice(0) });
      const waited = Date.now() - lastAsked;
      const from = performance.now();
      const value = req.op === "openZip" ? await openZip(req) : await handle(req);
      // What each thing asked took here, and how long it waited its turn: for measuring (BENCHMARKING.md).
      timed({ what: req.op === "rows" ? req.request.ask : req.op, ms: Math.round((performance.now() - from) * 10) / 10, waited });
      post({ id: req.id, ok: true, value });
    } catch (err) {
      post({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });
}

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  // A write to a bundle that is being built waits for the build.
  const busy = "bundle" in req && writes(req) ? building.get(req.bundle) : undefined;
  if (busy) void busy.then(() => take(req));
  else take(req);
};
