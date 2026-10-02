// Owns one SQLite database in a worker: the OPFS file when the browser has
// one (the opfs-sahpool VFS needs no special headers and runs in Safari,
// Firefox and Chromium), memory otherwise. The page talks to it through
// client.ts; the SQL is the indexer's, run by core's oo1Driver.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { oo1Driver, type SqlDriver, type SqlValue } from "@workspace.sh/table-core";

export type Request =
  | { id: number; op: "open"; name: string }
  | { id: number; op: "exec"; sql: string }
  | { id: number; op: "run"; sql: string; params: SqlValue[] }
  | { id: number; op: "all"; sql: string; params: SqlValue[] }
  | { id: number; op: "batch"; sql: string; params: SqlValue[][] }
  | { id: number; op: "close" };

export type Response = { id: number; ok: true; value?: unknown } | { id: number; ok: false; error: string };

let db: { close(): void } | null = null;
let driver: SqlDriver | null = null;

async function open(name: string): Promise<{ persistent: boolean }> {
  const sqlite3 = await sqlite3InitModule();
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "table-index", initialCapacity: 6 });
    const file = new pool.OpfsSAHPoolDb(`/${name}.sqlite`);
    db = file;
    driver = oo1Driver(file);
    await driver.exec("pragma page_size=32768; pragma journal_mode=memory; pragma synchronous=off; pragma temp_store=memory; pragma cache_size=-65536;");
    return { persistent: true };
  } catch {
    const memory = new sqlite3.oo1.DB(":memory:");
    db = memory;
    driver = oo1Driver(memory);
    return { persistent: false };
  }
}

async function handle(req: Request): Promise<unknown> {
  if (req.op === "open") return open(req.name);
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
    case "close":
      db?.close();
      db = driver = null;
  }
}

// Requests run one at a time, in the order they came: the indexer's begin/commit pairs depend on it.
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  queue = queue.then(async () => {
    try {
      (self as unknown as Worker).postMessage({ id: req.id, ok: true, value: await handle(req) } satisfies Response);
    } catch (err) {
      (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String(err instanceof Error ? err.message : err) } satisfies Response);
    }
  });
};
