// The page's end of the SQLite worker: a SqlDriver for the indexer, so a
// build or a query never runs on the thread that draws.

import type { SqlDriver, SqlValue } from "@workspace.sh/table-core";
import type { Request, Response } from "./worker";

export interface WebDatabase extends SqlDriver {
  /** True when the file lives in OPFS and survives a reload; false when the browser gave memory only. */
  readonly persistent: boolean;
  close(): Promise<void>;
}

type Call = Request extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/** Opens (or creates) the bundle's index database, `<name>.sqlite`, in a worker of its own. */
export async function openWebDatabase(name: string): Promise<WebDatabase> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.value);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "the SQLite worker failed"));
    pending.clear();
  };
  const call = <T,>(req: Call): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...req, id });
    });

  const { persistent } = await call<{ persistent: boolean }>({ op: "open", name });
  return {
    persistent,
    exec: (sql) => call({ op: "exec", sql }),
    run: (sql, params = []) => call({ op: "run", sql, params }),
    all: (sql, params = []) => call<Record<string, SqlValue>[]>({ op: "all", sql, params }),
    batch: (sql, params) => call({ op: "batch", sql, params }),
    async close() {
      await call({ op: "close" });
      worker.terminate();
    },
  };
}
