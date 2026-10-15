// A device's indexes (SPEC section 8), for the apps that keep large tables
// as folders of their own: iOS (apps/mobile) and the Mac (apps/desktop). A
// bundle with a large table is a real .table folder in the app's own
// space, with `index.sqlite` at its root and the table's rows in one file,
// `tables/<name>/rows/0001.ndjson`, which stays the truth. Files and SQLite are the
// platform's, passed in (IndexHostPlatform); everything else is here, once.
// (The web's worker, apps/web/src/sqlite, and Linux's do the same over
// their own storage.)
//
// A large table never reaches the screen as rows. Its archive is read
// here: the table's rows are left compressed, inflated a piece at a
// time into the index and into the file beside it. The screen gets the
// first rows to show meanwhile, and how far the reading is.
//
// The folder is the app's own: nothing else can change its files, so an
// index is fresh as long as the app says so (its key is "saved"), and what
// is recorded instead is that a rows file is whole, and its size (`_kept`):
// one cut short, by the app being ended while it was written, isn't taken
// for the table. Were these folders shown to other apps (the Files app),
// freshness would need the files' own content, or their size and date.

import {
  BUNDLE_EXTENSION,
  BundleEntry,
  FIRST_ROWS_FILE,
  LEGACY_ROWS_FILE,
  ROWS_DIR,
  alterIndex,
  buildSearchIndex,
  fillIndex,
  queryIndex,
  indexKey,
  rowsBeingBuilt,
  setIndexKey,
  storedRows,
  type LazyZipEntry,
  type Row,
  type SqlDriver,
  type TableSchema,
} from "@workspace.sh/table-core";
import { joinPath, writeBundleTo, type TableFs } from "@workspace.sh/table-core/io";
import { INDEXED_FROM, buildIndexFromBytes, canBeIndexed, firstRowsInBytes, linesInBytes, rowsInChunks } from "./indexed.ts";
import { rowsServer, type RowsRequest } from "./remoteRows.ts";
import { openArchive, type OpenedBundle } from "./tableFiles.ts";

/** A database the host can close. */
export interface ClosableDriver extends SqlDriver {
  close(): Promise<void>;
}

/** A file being written, from empty, a piece at a time. */
export interface FileWriter {
  write(bytes: Uint8Array): unknown;
  close(): unknown;
}

/** What a platform gives the host: its files and its SQLite. Paths are as `fs` speaks them. */
export interface IndexHostPlatform {
  /** Core's TableFs: the bundles' folders are written and removed through it, and a staged file moved over its target. */
  fs: TableFs;
  /** The folder the app keeps its bundles' folders in. */
  home(): string;
  /** A file's size in bytes, or null when there's no such file. */
  size(path: string): Promise<number | null>;
  /** A file emptied (made if missing) and opened for writing to its end. Its folder exists. */
  writer(path: string): Promise<FileWriter>;
  /** A file's first `size` bytes, `step` at a time. */
  pieces(path: string, size: number, step: number): Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
  /**
   * The bundle's index database in its folder `dir`, opened (made if
   * missing) on a new connection: `main` is the one the screen is answered
   * on, `reader` one a save reads on, in a read transaction of its own.
   */
  openDatabase(dir: string, role: "main" | "reader"): Promise<ClosableDriver>;
  /** Rows per statement in a build, where a platform wants smaller ones (core's default otherwise). */
  batchSize?: number;
}

/** A bundle's index: what the screen asks of it. (The web's WebDatabase, without the statements themselves.) */
export interface IndexDatabase {
  /** Make table `name`'s index ready (built from an archive just read, kept from before, or made again from its rows kept here), and say how many rows it has. */
  ensure(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /** Make it again from the rows kept here: after a change to its fields it can't `alter`. */
  build(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /**
   * Write a table's rows out to its file and say the index is as the file
   * is. False when an edit landed meanwhile: nothing is said, and the next
   * save writes it. `whole`: the save a build is about to read, which runs
   * to its end whatever happens (the screen holds edits for it).
   */
  save(name: string, schema: TableSchema, rows: boolean, omit?: string[], whole?: boolean): Promise<boolean>;
  /** Rows of a table still being read, in file order, from those in so far. */
  peek(name: string, start: number, end: number): Promise<Row[]>;
  /** A view's rows, or edits to rows (table-app's remoteViewRows, remoteEdits). */
  rows(request: RowsRequest): Promise<unknown>;
  /** Make what's left of its search index, a step at a time behind whatever else is asked. */
  search(name: string): Promise<void>;
  /**
   * After a change to a table's fields from `from` to `to`: change its index
   * where it is (core's alterIndex), answering for `to` at once. False when
   * it can't, and it's to be built again.
   */
  alter(name: string, from: TableSchema, to: TableSchema, options?: { restore?: string[] }): Promise<boolean>;
  /**
   * Work out what a change of fields left to work out (core's fillIndex), a
   * step at a time behind whatever else is asked. Resolves when it's done;
   * safe to ask when there's nothing to do.
   */
  fill(name: string, schema: TableSchema): Promise<void>;
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

/** The host: reading archives into indexes, and each bundle's index. */
export interface IndexHost {
  /** Where a bundle's folder is. */
  bundleDir(bundle: string): string;
  /**
   * Read a single-file `.table`. Its large tables stay here, still compressed, on
   * their way into the index: they come back with no rows and `indexed` set,
   * with their first rows beside them. A bundle with such a table is written
   * as a folder in the app's own space, whole but for those tables' rows,
   * which `ensure` writes as it reads them.
   */
  openZip(bytes: Uint8Array, taken: Iterable<string>, from?: number): Promise<OpenedLarge>;
  /** A bundle's index here, opened (or made) in its folder. */
  openIndexDatabase(bundle: string): IndexDatabase;
  /** Forget one bundle kept as a folder here, as closing it does: its index is closed and its folder removed. Nothing when there's none. */
  removeFolder(bundle: string): Promise<void>;
  /** Forget every bundle kept as a folder here: their indexes are closed and their folders removed. */
  removeAllFolders(): Promise<void>;
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
/** The most of its write-ahead log an index keeps on disk once the log has been folded in, in bytes. */
const WAL_KEPT = 16 * 1024 * 1024;

/** One bundle's database, open. */
interface Held {
  driver: ClosableDriver;
  serve: (request: RowsRequest) => Promise<unknown>;
}

export function createIndexHost(platform: IndexHostPlatform): IndexHost {
  const { fs } = platform;
  const BATCH = platform.batchSize !== undefined ? { batchSize: platform.batchSize } : {};
  const bundleDir = (bundle: string): string => joinPath(platform.home(), `${bundle}${BUNDLE_EXTENSION}`);
  const tableDir = (bundle: string, table: string): string => joinPath(bundleDir(bundle), BundleEntry.tables, table);
  // One rows file, however large: the folder is the app's own, and git's limits aren't its.
  const rowsDir = (bundle: string, table: string): string => joinPath(tableDir(bundle, table), ROWS_DIR);
  const rowsPath = (bundle: string, table: string): string => joinPath(rowsDir(bundle, table), FIRST_ROWS_FILE);

  const held = new Map<string, Promise<Held>>();
  // When the screen last asked for something: the search index's steps wait for a quiet moment.
  let lastAsked = 0;
  // Large tables read from an archive and not yet in the index, by `bundle/table`: their rows, still compressed.
  const waiting = new Map<string, { rows: LazyZipEntry; bodies: Record<string, string> }>();

  function open(bundle: string): Promise<Held> {
    let on = held.get(bundle);
    if (!on) {
      on = (async (): Promise<Held> => {
        const dir = bundleDir(bundle);
        await fs.mkdir(dir);
        const driver = await platform.openDatabase(dir, "main");
        // The page size is set before the first table; the rows file is the truth, so the index needn't outlive a crash whole.
        await driver.exec(`pragma page_size = 32768; pragma journal_mode = wal; pragma synchronous = normal; pragma journal_size_limit = ${WAL_KEPT};`);
        return { driver, serve: rowsServer(driver) };
      })();
      held.set(bundle, on);
    }
    return on;
  }

  // Requests run one at a time, in the order they came: the indexer's begin/commit pairs depend on it.
  let queue: Promise<unknown> = Promise.resolve();
  /** Take a turn in the queue. */
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
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
  const afterBuild = <T>(bundle: string, run: () => Promise<T>): Promise<T> => (building.get(bundle) ?? Promise.resolve()).then(run);

  // -- The rows files, beside the index ---------------------------------------

  /** Say a table's rows file is whole, at this many bytes: one cut short isn't taken for the table. */
  async function kept(db: SqlDriver, table: string, bytes: number): Promise<void> {
    await db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
    await db.run("insert or replace into _kept(name, bytes) values(?, ?)", [table, bytes]);
  }

  /** A table's rows file, emptied and open for writing to its end. */
  async function emptied(bundle: string, table: string): Promise<FileWriter> {
    await fs.mkdir(rowsDir(bundle, table));
    return platform.writer(rowsPath(bundle, table));
  }

  /** A table's rows file in pieces, when it is whole; null when it's missing or was cut short. */
  async function keptRows(db: SqlDriver, bundle: string, table: string): Promise<{ chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>; size: number } | null> {
    await db.exec("create table if not exists _kept(name text primary key, bytes integer not null)");
    const whole = (await db.all("select bytes from _kept where name = ?", [table]))[0]?.bytes;
    // Kept before D51 as the table's rows.ndjson: moved into rows/.
    const legacy = joinPath(tableDir(bundle, table), LEGACY_ROWS_FILE);
    if ((await platform.size(rowsPath(bundle, table))) === null && (await platform.size(legacy)) !== null) {
      await fs.mkdir(rowsDir(bundle, table));
      await fs.rename(legacy, rowsPath(bundle, table));
    }
    const size = await platform.size(rowsPath(bundle, table));
    if (whole === undefined || size === null || size !== Number(whole)) return null;
    return { chunks: platform.pieces(rowsPath(bundle, table), size, READ_STEP), size };
  }

  // -- What the screen asks ---------------------------------------------------

  async function openZip(bytes: Uint8Array, taken: Iterable<string>, from: number = INDEXED_FROM): Promise<OpenedLarge> {
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
      await writeBundleTo(fs, bundleDir(opened.key), opened.bundle);
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
      const out = await emptied(bundle, name);
      let at = 0;
      try {
        const count = await buildIndexFromBytes(db, {
          name,
          schema,
          rows: {
            chunks: fresh.rows.chunks(),
            size: fresh.rows.size,
            keep: (chunk) => {
              at += chunk.length;
              return out.write(chunk);
            },
          },
          bodies: fresh.bodies,
          key: "saved",
          commitEvery: COMMIT_EVERY,
          ...BATCH,
          ...(onProgress ? { onProgress } : {}),
        });
        await out.close();
        await kept(db, name, at);
        waiting.delete(`${bundle}/${name}`);
        return count;
      } catch (error) {
        // A damaged archive is found out at its end: nothing of it is kept.
        try {
          await out.close();
        } catch {
          // Closed already.
        }
        await fs.remove(rowsPath(bundle, name));
        throw error;
      }
    }
    if (!again) {
      // Opened before: the index kept here.
      const before = await queryIndex(db, { name, schema });
      if (before) return before.count;
    }
    const rows = await keptRows(db, bundle, name);
    if (!rows) throw new Error("its rows are no longer on this device");
    return buildIndexFromBytes(db, { name, schema, rows, key: "saved", commitEvery: COMMIT_EVERY, ...BATCH, ...(onProgress ? { onProgress } : {}) });
  }

  function build(bundle: string, name: string, schema: TableSchema, again: boolean, onProgress?: (done: number, total: number) => void): Promise<number> {
    const done = afterBuild(bundle, () => open(bundle)).then(({ driver }) => {
      // The database, asked a statement at a time, each in its turn.
      const stepped: SqlDriver = {
        exec: (sql) => inTurn(() => driver.exec(sql)),
        run: (sql, params) => inTurn(() => driver.run(sql, params)),
        all: (sql, params) => inTurn(() => driver.all(sql, params)),
        ...(driver.batch ? { batch: (sql: string, params: Parameters<NonNullable<SqlDriver["batch"]>>[1]) => inTurn(() => driver.batch!(sql, params)) } : {}),
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
  async function writeRows(
    bundle: string,
    name: string,
    schema: TableSchema,
    omit: string[] | undefined,
    stop: () => boolean,
  ): Promise<{ bytes: number; key: string | null } | null> {
    await fs.mkdir(rowsDir(bundle, name));
    const stagedPath = `${rowsPath(bundle, name)}.tmp`;
    const out = await platform.writer(stagedPath);
    const encoder = new TextEncoder();
    // Read on a connection of its own, in one read transaction: the rows as
    // they stood when the save began, however long the writing takes, while
    // the bundle's own connection goes on answering the screen and taking
    // edits. (On that one connection a save held every read behind it.)
    const reader = await platform.openDatabase(bundleDir(bundle), "reader");
    let at = 0;
    let stopped = false;
    // The index's key as these rows have it: the file is this index and no later one.
    let key: string | null = null;
    try {
      // The reader's first look is what fixes what it sees, so it takes a turn of
      // the bundle's own queue: every edit asked before this save has had its
      // turn by then and is in the file, and none comes between.
      await inTurn(async () => {
        await reader.exec("begin");
        key = await indexKey(reader, name);
      });
      for await (const text of storedRows(reader, { name, schema, ...(omit ? { omit } : {}) })) {
        // An edit has landed: this file would be out of date as it was finished, and the next save writes it.
        if (stop()) {
          stopped = true;
          break;
        }
        const bytes = encoder.encode(text);
        await out.write(bytes);
        at += bytes.length;
      }
      await reader.exec("commit");
    } finally {
      await out.close();
      await reader.close().catch(() => {});
    }
    if (stopped) {
      // The file from the save before stays as it is, whole.
      await fs.remove(stagedPath);
      return null;
    }
    await fs.rename(stagedPath, rowsPath(bundle, name));
    return { bytes: at, key };
  }

  // A bundle's saves, one after another, and how many are under way.
  const saving = new Map<string, Promise<unknown>>();
  let savesUnderWay = 0;
  // Edits asked of each table (`bundle/table`), counted: a save looks before and after.
  const edited = new Map<string, number>();

  /**
   * Work made a step at a time (a search index, a fill), each behind
   * whatever the screen asked meanwhile. `take` resolves true while there's more.
   */
  function inSteps(bundle: string, take: (driver: SqlDriver) => Promise<boolean>): Promise<void> {
    return new Promise((resolve, reject) => {
      const step = (): void => {
        // The screen comes first: a step waits until it has asked for nothing for a moment.
        // So does a save: its rows are the person's edits on their way to the file.
        if (savesUnderWay > 0 || Date.now() - lastAsked < QUIET_MS) return void setTimeout(step, QUIET_MS / 2);
        afterBuild(bundle, () => inTurn(async () => take((await open(bundle)).driver))).then(
          (more) => (more ? void setTimeout(step, 0) : resolve()),
          reject,
        );
      };
      step();
    });
  }

  function openIndexDatabase(bundle: string): IndexDatabase {
    const asked = <T>(run: (h: Held) => Promise<T>): Promise<T> => {
      lastAsked = Date.now();
      return inTurn(async () => run(await open(bundle)));
    };
    return {
      ensure: (name, schema, onProgress) => build(bundle, name, schema, false, onProgress),
      build: (name, schema, onProgress) => build(bundle, name, schema, true, onProgress),
      save: (name, schema, rows, omit, whole) => {
        const run = async (): Promise<boolean> => {
          // After a build of its bundle; then the rows are written beside what the screen asks, not ahead of it.
          await afterBuild(bundle, () => Promise.resolve());
          const table = `${bundle}/${name}`;
          const had = edited.get(table) ?? 0;
          const editedSince = () => !whole && (edited.get(table) ?? 0) !== had;
          // Rows the file doesn't have yet are written whether or not the screen knows of them: the
          // index says (edits made before the app was ended, whose save was stopped or never began).
          const write = rows || (await asked(({ driver }) => indexKey(driver, name))) !== "saved";
          const written = write ? await writeRows(bundle, name, schema, omit, editedSince) : null;
          if (write && written === null) return false;
          // Said in one turn with the last look, so no edit comes between them.
          return asked(async ({ driver }) => {
            if (editedSince()) return false;
            // The file is the index as the reader saw it, and every edit gives the index a
            // new key: one that has moved on says the index holds something the file doesn't.
            // Not asked of the save a build is about to read: the screen holds edits for that
            // one, and it always ends saved.
            if (!whole && written !== null && (await indexKey(driver, name)) !== written.key) return false;
            if (written !== null) await kept(driver, name, written.bytes);
            await setIndexKey(driver, name, "saved");
            return true;
          });
        };
        savesUnderWay++;
        const done = (saving.get(bundle) ?? Promise.resolve()).then(run, run).finally(() => {
          savesUnderWay--;
        });
        saving.set(
          bundle,
          done.catch(() => {}),
        );
        return done;
      },
      peek: (name, start, end) => asked(({ driver }) => rowsBeingBuilt(driver, name, start, end)),
      // An edit waits for a build of its bundle; a read is answered between the build's statements.
      rows: (request) => {
        if (request.ask !== "edits") return asked(({ serve }) => serve(request));
        // Counted as it's asked, before its turn: a save under way sees it at once.
        const table = `${bundle}/${request.name}`;
        edited.set(table, (edited.get(table) ?? 0) + 1);
        return afterBuild(bundle, () => asked(({ serve }) => serve(request)));
      },
      search: (name) => inSteps(bundle, (driver) => buildSearchIndex(driver, name, SEARCH_STEP)),
      // One transaction, in one turn, after a build of its bundle.
      alter: (name, from, to, options = {}) => afterBuild(bundle, () => asked(({ driver }) => alterIndex(driver, name, from, to, options))),
      fill: (name, schema) => inSteps(bundle, (driver) => fillIndex(driver, name, schema, SEARCH_STEP)),
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

  async function removeFolder(bundle: string): Promise<void> {
    if (held.has(bundle)) await openIndexDatabase(bundle).close();
    for (const key of [...waiting.keys()]) if (key.startsWith(`${bundle}/`)) waiting.delete(key);
    await fs.remove(bundleDir(bundle));
  }

  async function removeAllFolders(): Promise<void> {
    for (const bundle of [...held.keys()]) await openIndexDatabase(bundle).close();
    waiting.clear();
    await fs.remove(platform.home());
  }

  return { bundleDir, openZip, openIndexDatabase, removeFolder, removeAllFolders };
}
