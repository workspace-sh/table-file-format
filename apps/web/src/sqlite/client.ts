// The page's end of the SQLite worker: a SqlDriver for the indexer, and the
// work on a large table's rows that goes with it, so a build or a query
// never runs on the thread that draws.

import type { RowsRequest } from "@workspace.sh/table-app";
import type { SqlDriver, SqlValue, TableSchema } from "@workspace.sh/table-core";
import type { OpenedLarge, Request, Response } from "./worker";

export interface WebDatabase extends SqlDriver {
  /** True when the file lives in OPFS and survives a reload; false when the browser gave memory only. */
  readonly persistent: boolean;
  /** Make table `name`'s index ready (built from an archive just read, kept from before, or made again from its rows kept here), and say how many rows it has. */
  ensure(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /** Make it again from the rows kept here: after a change to its fields. */
  build(name: string, schema: TableSchema, onProgress?: (done: number, total: number) => void): Promise<number>;
  /** After edits: write the rows out of the index to the file kept beside it (when `rows`), without the keys in `omit`. */
  save(name: string, schema: TableSchema, rows: boolean, omit?: string[]): Promise<void>;
  /** A view's rows, or edits to rows, asked of the worker in one message each (table-app's remoteViewRows, remoteEdits). */
  rows(request: RowsRequest): Promise<unknown>;
  /** What each thing asked of the worker took since this was last asked, for measuring. */
  timings(): Promise<{ what: string; ms: number; waited: number }[]>;
  /** Make what's left of its search index, a step at a time behind whatever else is asked. */
  search(name: string): Promise<void>;
  close(): Promise<void>;
}

type Call = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

function start() {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; progress?: (done: number, total: number) => void }>();
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if ("progress" in e.data) {
      p.progress?.(...e.data.progress);
      return;
    }
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.value);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "the SQLite worker failed"));
    pending.clear();
  };
  const call = <T,>(req: Call, progress?: (done: number, total: number) => void, transfer: Transferable[] = []): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, ...(progress ? { progress } : {}) });
      worker.postMessage({ ...req, id }, transfer);
    });
  const database = (persistent: boolean): WebDatabase => ({
    persistent,
    exec: (sql) => call({ op: "exec", sql }),
    run: (sql, params = []) => call({ op: "run", sql, params }),
    all: (sql, params = []) => call<Record<string, SqlValue>[]>({ op: "all", sql, params }),
    batch: (sql, params) => call({ op: "batch", sql, params }),
    ensure: (name, schema, onProgress) => call<number>({ op: "ensure", name, schema }, onProgress),
    build: (name, schema, onProgress) => call<number>({ op: "build", name, schema }, onProgress),
    save: (name, schema, rows, omit) => call({ op: "save", name, schema, rows, ...(omit ? { omit } : {}) }),
    search: (name) => call({ op: "search", name }),
    rows: (request) => call({ op: "rows", request }),
    timings: () => call({ op: "timings" }),
    async close() {
      await call({ op: "close" });
      worker.terminate();
    },
  });
  return { worker, call, database };
}

/** Opens (or creates) the bundle's index database, `<name>.sqlite`, in a worker of its own. */
export async function openWebDatabase(name: string): Promise<WebDatabase> {
  const { call, database } = start();
  const { persistent } = await call<{ persistent: boolean }>({ op: "open", name });
  return database(persistent);
}

/**
 * Read a `.table.zip` in a worker. Its large tables stay there, as bytes on
 * their way into the index: they come back with no rows and `indexed` set,
 * with their first rows beside them. `index` is the bundle's database when
 * it has such a table, and null (the worker gone) when it has none.
 */
export async function openArchiveInWorker(
  bytes: Uint8Array,
  taken: string[],
  from?: number,
): Promise<OpenedLarge & { index: WebDatabase | null }> {
  const { worker, call, database } = start();
  try {
    const read = await call<OpenedLarge>({ op: "openZip", bytes, taken, ...(from === undefined ? {} : { from }) }, undefined, [bytes.buffer as ArrayBuffer]);
    const large = Object.values(read.opened.bundle.tables).some((t) => t.indexed);
    if (!large) worker.terminate();
    return { ...read, index: large ? database(read.persistent) : null };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
