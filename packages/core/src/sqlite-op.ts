import type { SqlDriver, SqlValue } from "./indexer.js";
import { manyRowInserts } from "./sqlite-batch.js";

/**
 * The parts of op-sqlite's database (`@op-engineering/op-sqlite`, `open()`)
 * the driver uses, so core takes no dependency on the package. `execute`
 * runs every statement in its text. (Its `executeBatch` isn't used: it
 * opens a transaction of its own, which the indexer's own can't hold.)
 */
export interface OpDatabase {
  execute(query: string, params?: SqlValue[]): Promise<{ rows: Record<string, unknown>[] }>;
  close(): void;
}

/** A driver that can also close its database. */
export interface OpDriver extends SqlDriver {
  close(): Promise<void>;
}

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
  const run = (sql: string, params: SqlValue[]) => inTurn(async () => void (await db.execute(sql, params)));
  return {
    exec: (sql) => inTurn(async () => void (await db.execute(sql))),
    run: (sql, params = []) => run(sql, params),
    all: (sql, params = []) => inTurn(async () => (await db.execute(sql, params)).rows as Record<string, SqlValue>[]),
    // A one-row insert is run for many rows at once, as the expo driver does: a crossing per few
    // hundred rows, not per row. Each statement takes its own turn, so a read asked during a
    // build waits for one statement, not the batch.
    batch: async (sql, lists) => {
      const many = manyRowInserts(sql, lists);
      if (!many) {
        for (const params of lists) await run(sql, params);
        return;
      }
      for (const statement of many) await run(statement.sql, statement.params);
    },
    close: () => inTurn(async () => db.close()),
  };
}
