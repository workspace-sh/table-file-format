// A SqlDriver over node:sqlite, which is built into Node (22.5 and later)
// and needs no native addon: what the index speaks to on Linux and in
// Node scripts. A subpath, `@workspace.sh/table-core/sqlite-node`, as the
// node:fs adapter is.

import { createRequire } from "node:module";
import type { SqlDriver, SqlValue } from "./indexer.js";

// node:sqlite is newer than this package's Node types, so what's used of it is said here.
interface StatementSync {
  run(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };

export interface NodeDatabase extends SqlDriver {
  close(): void;
}

/**
 * Open (or create) the index database at `path`. Pages are 32 KB, which a
 * scan reads far fewer of (LARGE-TABLES); the size is fixed when the file
 * is made and ignored after.
 */
export function openNodeDatabase(path: string): NodeDatabase {
  const db = new DatabaseSync(path);
  // The write-ahead log keeps whatever size it grows to; past 16 MB it is cut back when it is next emptied.
  db.exec("pragma page_size = 32768; pragma journal_mode = wal; pragma synchronous = normal; pragma journal_size_limit = 16777216;");
  const cache = new Map<string, StatementSync>();
  const prepared = (sql: string) => {
    let statement = cache.get(sql);
    if (!statement) cache.set(sql, (statement = db.prepare(sql)));
    return statement;
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      prepared(sql).run(...params);
    },
    async all(sql, params = []) {
      return prepared(sql).all(...params) as Record<string, SqlValue>[];
    },
    async batch(sql, params) {
      const statement = prepared(sql);
      for (const p of params) statement.run(...p);
    },
    close() {
      cache.clear();
      db.close();
    },
  };
}
