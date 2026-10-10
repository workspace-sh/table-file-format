import type { SqlDriver, SqlValue } from "./indexer.js";

/** The parts of expo-sqlite's `SQLiteStatement` the driver uses, so core takes no dependency on the package. */
export interface ExpoStatement {
  executeAsync(params: SqlValue[]): Promise<{ getAllAsync(): Promise<unknown[]> }>;
  executeSync(params: SqlValue[]): { getAllSync(): unknown[] };
  finalizeAsync(): Promise<void>;
  finalizeSync(): void;
}
export interface ExpoDatabase {
  execAsync(sql: string): Promise<void>;
  execSync(sql: string): void;
  prepareAsync(sql: string): Promise<ExpoStatement>;
  prepareSync(sql: string): ExpoStatement;
  closeAsync(): Promise<void>;
}

/** A driver that can also close its database, finalizing its own statements first. */
export interface ExpoDriver extends SqlDriver {
  close(): Promise<void>;
}

const CACHED = 64;
/** Bound values per statement: SQLite's limit is 32,766; this keeps each statement's work short. */
const VALUES_PER_STATEMENT = 4_000;
/** `insert into t(a, b) values(?, ?)`: one row's insert, which a batch can repeat as `values(?, ?), (?, ?), …`. */
const ONE_ROW_INSERT = /^\s*insert\s+into\s+[^;]+?\bvalues\s*(\(\s*\?(?:\s*,\s*\?)*\s*\))\s*$/i;

/**
 * A SqlDriver over an expo-sqlite database (iOS, Android).
 *
 * "async" runs every statement on expo-sqlite's own queue, so the JS thread
 * is free while SQLite works but each call is a crossing; "sync" runs them
 * on the JS thread, a direct call each, and holds that thread for as long
 * as the statement takes. Calls are made one at a time in either mode:
 * expo-sqlite's queue is concurrent, and a cached statement can't run twice
 * at once.
 *
 * Open the database with `finalizeUnusedStatementsBeforeClosing: false` and
 * close it through `close()`. Otherwise expo-sqlite finalizes every
 * statement on the connection as it closes, FTS5's own included, and FTS5
 * finalizes them again: closing a database with a search index crashes.
 */
export function expoDriver(db: ExpoDatabase, mode: "async" | "sync" = "async"): ExpoDriver {
  const cache = new Map<string, ExpoStatement>();
  const prepared = async (sql: string) => {
    let s = cache.get(sql);
    if (s) {
      cache.delete(sql);
    } else {
      s = mode === "sync" ? db.prepareSync(sql) : await db.prepareAsync(sql);
      if (cache.size >= CACHED) {
        const oldest = cache.keys().next().value!;
        const gone = cache.get(oldest)!;
        cache.delete(oldest);
        if (mode === "sync") gone.finalizeSync();
        else await gone.finalizeAsync();
      }
    }
    cache.set(sql, s);
    return s;
  };
  const all = async (s: ExpoStatement, params: SqlValue[]) =>
    (mode === "sync" ? s.executeSync(params).getAllSync() : await (await s.executeAsync(params)).getAllAsync()) as Record<string, SqlValue>[];
  // A statement that returns nothing is done once it's run: no second crossing to read its rows. (The next run resets it.)
  const step = async (s: ExpoStatement, params: SqlValue[]) => {
    if (mode === "sync") s.executeSync(params);
    else await s.executeAsync(params);
  };

  // One call at a time, in the order asked.
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = last.then(work, work);
    last = next.catch(() => undefined);
    return next;
  };

  return {
    exec: (sql) => inTurn(async () => (mode === "sync" ? db.execSync(sql) : await db.execAsync(sql))),
    run: (sql, params = []) => inTurn(async () => step(await prepared(sql), params)),
    all: (sql, params = []) => inTurn(async () => all(await prepared(sql), params)),
    // A one-row insert is run for many rows at once, so a batch is a crossing per few hundred rows, not per row.
    // Each statement takes its own turn: a read asked mid-batch (rowsBeingBuilt) waits for one statement, not the batch.
    // So anything else asked of the driver during a build runs inside the build's transaction: a host must hold its
    // writes to this database until the build is done.
    batch: async (sql, lists) => {
      const tuple = ONE_ROW_INSERT.exec(sql)?.[1];
      const width = lists[0]?.length ?? 0;
      if (!tuple || width === 0 || lists.some((l) => l.length !== width)) {
        for (const params of lists) await inTurn(async () => step(await prepared(sql), params));
        return;
      }
      const per = Math.max(1, Math.floor(VALUES_PER_STATEMENT / width));
      for (let at = 0; at < lists.length; at += per) {
        const part = lists.slice(at, at + per);
        const many = sql.slice(0, sql.lastIndexOf(tuple)) + Array.from(part, () => tuple).join(", ");
        await inTurn(async () => step(await prepared(many), part.flat()));
      }
    },
    close: () =>
      inTurn(async () => {
        for (const s of cache.values()) {
          if (mode === "sync") s.finalizeSync();
          else await s.finalizeAsync();
        }
        cache.clear();
        await db.closeAsync();
      }),
  };
}
