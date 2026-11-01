import type { SqlDriver, SqlValue } from "./indexer.js";
import { manyRowInserts } from "./sqlite-batch.js";

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

export interface ExpoDriverOptions {
  /**
   * Wait for a macrotask before a statement once this many milliseconds have passed since the last
   * wait. Over expo-sqlite's async calls a build runs from one native callback to the next without
   * the event loop taking a turn, and on a phone React Native's timers (and so its frames) wait
   * seconds for it. A budget rather than a count: `setTimeout(0)` waits for the next frame in
   * React Native, so a wait per statement makes a build several times slower. Off by default.
   */
  yieldAfterMs?: number;
  /** How to wait; `setTimeout(0)` by default. */
  yieldTo?: () => Promise<void>;
}

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
export function expoDriver(db: ExpoDatabase, mode: "async" | "sync" = "async", options: ExpoDriverOptions = {}): ExpoDriver {
  const budget = options.yieldAfterMs ?? 0;
  const yieldTo = options.yieldTo ?? (() => new Promise<void>((go) => setTimeout(go, 0)));
  let waited = Date.now();
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
    const go = async () => {
      if (budget > 0 && Date.now() - waited >= budget) {
        await yieldTo();
        waited = Date.now();
      }
      return work();
    };
    const next = last.then(go, go);
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
      const many = manyRowInserts(sql, lists);
      if (!many) {
        for (const params of lists) await inTurn(async () => step(await prepared(sql), params));
        return;
      }
      for (const statement of many) await inTurn(async () => step(await prepared(statement.sql), statement.params));
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
