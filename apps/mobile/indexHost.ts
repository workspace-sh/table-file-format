// The phone's indexes (SPEC section 8): a bundle with a large table is a
// real .table folder in the app's documents, with `index.sqlite` at its
// root and the table's `rows.ndjson` under `tables/<name>/`, which stays
// the truth. This is the phone's counterpart of the web's worker
// (apps/web/src/sqlite/worker.ts) and its client, in one place: SQLite
// here is expo-sqlite, whose statements run on its own queue, so nothing
// needs a worker of ours. The SQL is the indexer's, run by core's
// expoDriver.
//
// A large table never reaches the screen as rows. Its archive is read
// here: the table's rows.ndjson is left compressed, inflated a piece at a
// time into the index and into the file beside it. The screen gets the
// first rows to show meanwhile, and how far the reading is.
//
// The folder is the app's own: nothing else can change its files, so an
// index is fresh as long as the app says so (its key is "saved"), and what
// is recorded instead is that a rows file is whole, and its size (`_kept`):
// one cut short, by the app being ended while it was written, isn't taken
// for the table. Were these folders shown to other apps (the Files app),
// freshness would need the files' own content, or their size and date.

import { openDatabaseSync } from "expo-sqlite";
import { Directory, File, type FileHandle } from "expo-file-system";
import { INDEXED_FROM, buildIndexFromBytes, canBeIndexed, firstRowsInBytes, linesInBytes, openArchive, rowsInChunks, rowsServer, type OpenedBundle, type RowsRequest } from "@workspace.sh/table-app";
import {
  BUNDLE_EXTENSION,
  BundleEntry,
  TableEntry,
  buildSearchIndex,
  queryIndex,
  rowsBeingBuilt,
  setIndexKey,
  storedRows,
  type LazyZipEntry,
  type Row,
  type SqlDriver,
  type TableSchema,
} from "@workspace.sh/table-core";
import { joinPath, writeBundleTo } from "@workspace.sh/table-core/io";
import { expoDriver, type ExpoDriver } from "@workspace.sh/table-core/sqlite-expo";
import { expoFs, pathOfUri, tablesHome } from "./expoFs";
import { renameOver } from "./modules/table-files";

/** A bundle's index: what the screen asks of it. (The web's WebDatabase, without the statements themselves.) */
export interface IndexDatabase {
  /** Make table `name`'s index ready (built from an archive just read, kept from before, or made again from its rows kept here), and say how many rows it has. */
  ensure(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /** Make it again from the rows kept here: after a change to its fields. */
  build(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /** After edits: write the rows out of the index to the file kept beside it (when `rows`), without the keys in `omit`. */
  save(name: string, schema: TableSchema, rows: boolean, omit?: string[]): Promise<void>;
  /** Rows of a table still being read, in file order, from those in so far. */
  peek(name: string, start: number, end: number): Promise<Row[]>;
  /** A view's rows, or edits to rows (table-app's remoteViewRows, remoteEdits). */
  rows(request: RowsRequest): Promise<unknown>;
  /** Make what's left of its search index, a step at a time behind whatever else is asked. */
  search(name: string): Promise<void>;
  /**
   * Every row of a table just read from an archive and not yet in the
   * index, inflated into memory: for holding the table there when no index
   * can be made of it. Null when its archive is no longer held (after a
   * relaunch); throws when the archive is damaged.
   */
  heldRows(name: string): Row[] | null;
  close(): Promise<void>;
}

/** What reading an archive here gives the screen. */
export interface OpenedLarge {
  opened: OpenedBundle;
  /** Each large table's first rows, to show while the rest are read. */
  first: Record<string, Row[]>;
}

/** Rows a step of the search index takes: small enough that what the screen asks between steps isn't kept waiting. */
const SEARCH_STEP = 5000;
/** How long the screen must have asked for nothing before a step of the search index is taken. */
const QUIET_MS = 250;
/** Rows shown from the head of a table while it is read. */
const FIRST_ROWS = 200;
/** How much of a large table's start is inflated for its first rows, and to judge how many rows it has. */
const HEAD_BYTES = 256 * 1024;
/** How much of a rows file is read at a time when an index is made again from it. */
const READ_STEP = 1 << 20;

// expo-sqlite would finalize FTS5's own statements as it closes, and FTS5 them again (core's sqlite-expo.ts).
const OPEN = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false };

/** Where a bundle's folder is. */
export const bundleDir = (bundle: string): string => joinPath(tablesHome(), `${bundle}${BUNDLE_EXTENSION}`);
const tableDir = (bundle: string, table: string): string => joinPath(bundleDir(bundle), BundleEntry.tables, table);
const rowsPath = (bundle: string, table: string): string => joinPath(tableDir(bundle, table), TableEntry.rows);

/** One bundle's database, open. */
interface Held {
  driver: ExpoDriver;
  serve: (request: RowsRequest) => Promise<unknown>;
}
const held = new Map<string, Promise<Held>>();
// When the screen last asked for something: the search index's steps wait for a quiet moment.
let lastAsked = 0;
// Large tables read from an archive and not yet in the index, by `bundle/table`: their rows.ndjson, still compressed.
const waiting = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();

/**
 * Rows per transaction in a build. One transaction for the whole build
 * leaves all of it in the write-ahead log until the end: at a million rows
 * the log was 445 MB beside a 444 MB index, and stayed that size. Committed
 * in steps, the log is folded into the index as the build goes. The step's
 * size doesn't change how long a build takes or how long the screen waits
 * during one (measured on an iPhone 16 Pro, Release, 100,000 rows: 11.3 s
 * at 20,000 against 11.4 s for one transaction; see docs/LARGE-TABLES.md).
 */
const COMMIT_EVERY = 20_000;
/**
 * How the index's statements are run, and how often a build lets the event
 * loop take a turn. On a phone a build over the async driver holds React
 * Native's timers and React's renders up for seconds, which the Simulator
 * doesn't show; a yield shortens the wait and lengthens the build
 * (docs/LARGE-TABLES.md, "on a phone"). Which mode and yield a phone should
 * have isn't measured yet, so these are the driver's defaults, and a build
 * made to measure can set them: EXPO_PUBLIC_TABLE_INDEX_MODE=sync,
 * EXPO_PUBLIC_TABLE_INDEX_YIELD_MS=30.
 */
const DRIVER_MODE: "async" | "sync" = process.env.EXPO_PUBLIC_TABLE_INDEX_MODE === "sync" ? "sync" : "async";
const YIELD_AFTER_MS = Number(process.env.EXPO_PUBLIC_TABLE_INDEX_YIELD_MS ?? 0) || 0;
/**
 * Rows per statement in a build. In sync mode a yield can only come between
 * statements, so the longest the screen waits is the longest statement: a
 * smaller batch shortens it at no cost to the build (0.22 s at 1,000 against
 * 0.35 s at core's 5,000, in the Simulator). In async mode it changes nothing.
 */
const BATCH = DRIVER_MODE === "sync" ? { batchSize: 1000 } : {};
/** The most of its write-ahead log an index keeps on disk once the log has been folded in, in bytes. */
const WAL_KEPT = 16 * 1024 * 1024;

function open(bundle: string): Promise<Held> {
  let on = held.get(bundle);
  if (!on) {
    on = (async (): Promise<Held> => {
      const dir = bundleDir(bundle);
      await expoFs.mkdir(dir);
      const db = openDatabaseSync(BundleEntry.index, OPEN, pathOfUri(dir));
      // The page size is set before the first table; the rows file is the truth, so the index needn't outlive a crash whole.
      db.execSync(`pragma page_size = 32768; pragma journal_mode = wal; pragma synchronous = normal; pragma journal_size_limit = ${WAL_KEPT};`);
      const driver = expoDriver(db, DRIVER_MODE, YIELD_AFTER_MS > 0 ? { yieldAfterMs: YIELD_AFTER_MS } : {});
      return { driver, serve: rowsServer(driver) };
    })();
    held.set(bundle, on);
  }
  return on;
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
// the queue: each of its statements takes a turn, so the screen's reads are
// answered between them, and see the rows it has put in so far (they are on
// its connection). Anything that would write to that bundle waits for it:
// a build is one transaction, and would take the write with it if it failed.
const building = new Map<string, Promise<unknown>>();
const afterBuild = <T,>(bundle: string, run: () => Promise<T>): Promise<T> => (building.get(bundle) ?? Promise.resolve()).then(run);

// -- The rows files, beside the index ---------------------------------------

/** Say a table's rows file is whole, at this many bytes: one cut short isn't taken for the table. */
async function kept(db: SqlDriver, table: string, bytes: number): Promise<void> {
  await db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  await db.run("insert or replace into _kept(name, bytes) values(?, ?)", [table, bytes]);
}

/** A table's rows file, emptied and open for writing to its end. */
async function emptied(bundle: string, table: string): Promise<{ file: File; handle: FileHandle }> {
  await expoFs.mkdir(tableDir(bundle, table));
  const file = new File(rowsPath(bundle, table));
  if (file.exists) file.delete();
  file.create();
  return { file, handle: file.open() };
}

/** A table's rows file in pieces, when it is whole; null when it's missing or was cut short. */
async function keptRows(db: SqlDriver, bundle: string, table: string): Promise<{ chunks: Iterable<Uint8Array>; size: number } | null> {
  await db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
  const whole = (await db.all("select bytes from _kept where name = ?", [table]))[0]?.bytes;
  const file = new File(rowsPath(bundle, table));
  if (whole === undefined || !file.exists || file.size !== Number(whole)) return null;
  const size = file.size;
  function* chunks(): Generator<Uint8Array> {
    const handle = file.open();
    try {
      for (let at = 0; at < size; at += READ_STEP) yield handle.readBytes(Math.min(READ_STEP, size - at));
    } finally {
      handle.close();
    }
  }
  return { chunks: chunks(), size };
}

// -- What the screen asks ---------------------------------------------------

/**
 * Read a `.table.zip`. Its large tables stay here, still compressed, on
 * their way into the index: they come back with no rows and `indexed` set,
 * with their first rows beside them. A bundle with such a table is written
 * as a folder in the app's documents, whole but for those tables' rows,
 * which `ensure` writes as it reads them.
 */
export async function openZip(bytes: Uint8Array, taken: Iterable<string>, from: number = INDEXED_FROM): Promise<OpenedLarge> {
  const first: Record<string, Row[]> = {};
  const counts: Record<string, number> = {};
  const large = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();
  const opened = await openArchive(bytes, taken, {
    // A large table's rows are left compressed: only their start is read here, so the
    // screen has rows to show at once, however large the table. The rest is read by `ensure`.
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
  if (large.size > 0) {
    // The folder, whole but for the large tables' rows (the writer leaves an indexed table's rows file alone).
    await writeBundleTo(expoFs, bundleDir(opened.key), opened.bundle);
    for (const [name, table] of large) waiting.set(`${opened.key}/${name}`, table);
    // Not waited for: whatever is asked of this bundle next is answered after it.
    void open(opened.key);
  }
  return { opened, first };
}

/** Make a table's index: from an archive just read, kept from before, or again from its rows kept here. */
async function ensure(
  bundle: string,
  db: SqlDriver,
  name: string,
  schema: TableSchema,
  again: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const fresh = again ? undefined : waiting.get(`${bundle}/${name}`);
  if (fresh) {
    // Read a piece at a time: into the index, and into the file kept beside it.
    const { file, handle } = await emptied(bundle, name);
    let at = 0;
    try {
      const count = await buildIndexFromBytes(db, {
        name,
        schema,
        rows: {
          chunks: fresh.rows.chunks(),
          size: fresh.rows.size,
          keep: (chunk) => {
            handle.writeBytes(chunk);
            at += chunk.length;
          },
        },
        bodies: fresh.bodies,
        key: "saved",
        commitEvery: COMMIT_EVERY,
        ...BATCH,
        ...(onProgress ? { onProgress } : {}),
      });
      handle.close();
      await kept(db, name, at);
      waiting.delete(`${bundle}/${name}`);
      return count;
    } catch (error) {
      // A damaged archive is found out at its end: nothing of it is kept.
      try {
        handle.close();
      } catch {
        // Closed already.
      }
      if (file.exists) file.delete();
      throw error;
    }
  }
  if (!again) {
    // Opened before: the index kept on this phone.
    const before = await queryIndex(db, { name, schema });
    if (before) return before.count;
  }
  const rows = await keptRows(db, bundle, name);
  if (!rows) throw new Error("its rows are no longer on this phone");
  return buildIndexFromBytes(db, { name, schema, rows, key: "saved", commitEvery: COMMIT_EVERY, ...BATCH, ...(onProgress ? { onProgress } : {}) });
}

function build(
  bundle: string,
  name: string,
  schema: TableSchema,
  again: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const done = afterBuild(bundle, () => open(bundle)).then(({ driver }) => {
    // The database, asked a statement at a time, each in its turn.
    const stepped: SqlDriver = {
      exec: (sql) => inTurn(() => driver.exec(sql)),
      run: (sql, params) => inTurn(() => driver.run(sql, params)),
      all: (sql, params) => inTurn(() => driver.all(sql, params)),
      batch: (sql, params) => inTurn(() => driver.batch!(sql, params)),
    };
    return ensure(bundle, stepped, name, schema, again, onProgress).then(async (count) => {
      // What a build left in the log goes into the index, and the log is emptied.
      await stepped.exec("pragma wal_checkpoint(truncate)").catch(() => {});
      return count;
    });
  });
  building.set(
    bundle,
    done.then(
      () => {},
      () => {},
    ),
  );
  return done;
}

/** Write a table's rows out of the index to the file beside it: staged, then moved over it in one step. */
async function writeRows(bundle: string, name: string, schema: TableSchema, omit?: string[]): Promise<number> {
  await expoFs.mkdir(tableDir(bundle, name));
  const staged = new File(`${rowsPath(bundle, name)}.tmp`);
  if (staged.exists) staged.delete();
  staged.create();
  const handle = staged.open();
  const encoder = new TextEncoder();
  // Read on a connection of its own, in one read transaction: the rows as
  // they stood when the save began, however long the writing takes, while
  // the bundle's own connection goes on answering the screen and taking
  // edits. (On that one connection a save held every read behind it: a
  // second at 50,000 rows, and longer in step with the table.)
  const reader = expoDriver(openDatabaseSync(BundleEntry.index, OPEN, pathOfUri(bundleDir(bundle))), "async");
  let at = 0;
  try {
    await reader.exec("begin");
    for await (const text of storedRows(reader, { name, schema, ...(omit ? { omit } : {}) })) {
      const bytes = encoder.encode(text);
      handle.writeBytes(bytes);
      at += bytes.length;
    }
    await reader.exec("commit");
  } finally {
    handle.close();
    await reader.close().catch(() => {});
  }
  renameOver(pathOfUri(staged.uri), pathOfUri(rowsPath(bundle, name)));
  return at;
}

// A bundle's saves, one after another.
const saving = new Map<string, Promise<unknown>>();

/** A search index is made a step at a time, each behind whatever the screen asked meanwhile. */
function searchSteps(bundle: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const step = (): void => {
      // The screen comes first: a step waits until it has asked for nothing for a moment.
      if (Date.now() - lastAsked < QUIET_MS) return void setTimeout(step, QUIET_MS / 2);
      afterBuild(bundle, () => inTurn(async () => buildSearchIndex((await open(bundle)).driver, name, SEARCH_STEP))).then(
        (more) => (more ? void setTimeout(step, 0) : resolve()),
        reject,
      );
    };
    step();
  });
}

/** A bundle's index on this phone, opened (or made) in its folder. */
export function openIndexDatabase(bundle: string): IndexDatabase {
  const asked = <T,>(run: (h: Held) => Promise<T>): Promise<T> => {
    lastAsked = Date.now();
    return inTurn(async () => run(await open(bundle)));
  };
  return {
    ensure: (name, schema, onProgress) => build(bundle, name, schema, false, onProgress),
    build: (name, schema, onProgress) => build(bundle, name, schema, true, onProgress),
    save: (name, schema, rows, omit) => {
      const run = async (): Promise<void> => {
        // After a build of its bundle; then the rows are written beside what the screen asks, not ahead of it.
        await afterBuild(bundle, () => Promise.resolve());
        const bytes = rows ? await writeRows(bundle, name, schema, omit) : null;
        await asked(async ({ driver }) => {
          if (bytes !== null) await kept(driver, name, bytes);
          await setIndexKey(driver, name, "saved");
        });
      };
      const done = (saving.get(bundle) ?? Promise.resolve()).then(run, run);
      saving.set(
        bundle,
        done.catch(() => {}),
      );
      return done;
    },
    peek: (name, start, end) => asked(({ driver }) => rowsBeingBuilt(driver, name, start, end)),
    // An edit waits for a build of its bundle; a read is answered between the build's statements.
    rows: (request) => (request.ask === "edits" ? afterBuild(bundle, () => asked(({ serve }) => serve(request))) : asked(({ serve }) => serve(request))),
    search: (name) => searchSteps(bundle, name),
    heldRows: (name) => {
      const entry = waiting.get(`${bundle}/${name}`);
      if (!entry) return null;
      const rows = [...rowsInChunks(entry.rows.chunks())];
      waiting.delete(`${bundle}/${name}`);
      return rows;
    },
    close: () =>
      afterBuild(bundle, async () => {
        await saving.get(bundle);
        return inTurn(async () => {
          const on = held.get(bundle);
          held.delete(bundle);
          if (on) await (await on).driver.close();
        });
      }),
  };
}

/** Forget every bundle kept as a folder here: their indexes are closed and their folders removed. */
export async function removeAllFolders(): Promise<void> {
  for (const bundle of [...held.keys()]) await openIndexDatabase(bundle).close();
  waiting.clear();
  const home = new Directory(tablesHome());
  if (home.exists) home.delete();
}
