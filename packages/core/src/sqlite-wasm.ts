import type { SqlDriver, SqlValue } from "./indexer.js";

/** The parts of @sqlite.org/sqlite-wasm's `oo1.Database` and `Statement` the driver uses, so core takes no dependency on the package. */
export interface Oo1Statement {
  bind(values: SqlValue[]): Oo1Statement;
  step(): boolean;
  stepReset(): Oo1Statement;
  // The real `get` is overloaded (column, array or object); this asks for the object form.
  get(target: any): any;
  reset(): Oo1Statement;
  finalize(): void;
}
export interface Oo1Database {
  exec(sql: string): unknown;
  prepare(sql: string): Oo1Statement;
}

const CACHED = 64;

/** A SqlDriver over a SQLite WASM database, in a worker or in Node. Synchronous underneath; async only to fit the interface. */
export function oo1Driver(db: Oo1Database): SqlDriver {
  // Filters of different arity make different SQL text, so the cache is bounded; a statement left unfinalized stays in the WASM heap.
  const cache = new Map<string, Oo1Statement>();
  const prepared = (sql: string) => {
    let s = cache.get(sql);
    if (s) {
      cache.delete(sql);
    } else {
      s = db.prepare(sql);
      if (cache.size >= CACHED) {
        const oldest = cache.keys().next().value!;
        cache.get(oldest)!.finalize();
        cache.delete(oldest);
      }
    }
    cache.set(sql, s);
    return s;
  };
  const stepAll = (s: Oo1Statement, params: SqlValue[]) => {
    const out: Record<string, SqlValue>[] = [];
    try {
      if (params.length) s.bind(params);
      while (s.step()) out.push(s.get({}) as Record<string, SqlValue>);
    } finally {
      s.reset();
    }
    return out;
  };
  const stepOnce = (s: Oo1Statement, params: SqlValue[]) => {
    try {
      if (params.length) s.bind(params);
      s.stepReset();
    } finally {
      s.reset();
    }
  };
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      stepOnce(prepared(sql), params);
    },
    async all(sql, params = []) {
      return stepAll(prepared(sql), params);
    },
    async batch(sql, lists) {
      const s = prepared(sql);
      for (const params of lists) stepOnce(s, params);
    },
  };
}
