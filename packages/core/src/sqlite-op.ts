import type { SqlDriver, SqlValue } from "./indexer.js";

/**
 * The parts of op-sqlite's database (`@op-engineering/op-sqlite`, `open()`)
 * the driver uses, so core takes no dependency on the package. `execute`
 * runs every statement in its text; `executeBatch` runs a statement once
 * for each list of values, inside whatever transaction is open (it opens
 * none of its own).
 */
export interface OpDatabase {
  execute(query: string, params?: SqlValue[]): Promise<{ rows: Record<string, unknown>[] }>;
  executeBatch(commands: ([string] | [string, SqlValue[]] | [string, SqlValue[][]])[]): Promise<unknown>;
  close(): void;
}

/** A driver that can also close its database. */
export interface OpDriver extends SqlDriver {
  close(): Promise<void>;
}

/**
 * Lists of values per batch call: a call is one crossing to native code,
 * and this keeps each short enough that a read asked meanwhile isn't kept
 * waiting long.
 */
const LISTS_PER_BATCH = 2_000;

/**
 * A SqlDriver over an op-sqlite database (the Mac, apps/desktop; op-sqlite
 * also runs on iOS and Android). Its calls run on op-sqlite's own thread,
 * so the JS thread is free while SQLite works. Calls are made one at a
 * time, in the order asked: the indexer's begin/commit pairs depend on it.
 */
export function opDriver(db: OpDatabase): OpDriver {
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = last.then(work, work);
    last = next.catch(() => undefined);
    return next;
  };
  return {
    exec: (sql) => inTurn(async () => void (await db.execute(sql))),
    run: (sql, params = []) => inTurn(async () => void (await db.execute(sql, params))),
    all: (sql, params = []) => inTurn(async () => (await db.execute(sql, params)).rows as Record<string, SqlValue>[]),
    // A statement for many lists of values, a part at a time, each part its own turn:
    // a read asked during a build waits for one part, not the whole batch.
    batch: async (sql, lists) => {
      for (let at = 0; at < lists.length; at += LISTS_PER_BATCH) {
        const part = lists.slice(at, at + LISTS_PER_BATCH);
        await inTurn(() => db.executeBatch([[sql, part]]));
      }
    },
    close: () => inTurn(async () => db.close()),
  };
}
