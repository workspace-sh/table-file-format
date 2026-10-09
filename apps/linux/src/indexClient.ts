// The window's end of the index worker: an IndexHost whose every call is a
// message, so a build or a slow query never holds up drawing.

import { Worker } from "node:worker_threads";
import type { IndexHost } from "@workspace.sh/table-app/node";
import type { SqlValue } from "@workspace.sh/table-core";
import type { IndexRequest, IndexResponse } from "./indexWorker.js";

type Call = IndexRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

/** The bundle at `bundleDir`'s index, in a worker of its own. */
export function openWorkerIndexHost(bundleDir: string): IndexHost {
  const worker = new Worker(new URL("./indexWorker.ts", import.meta.url), { workerData: { bundleDir } });
  // The app can quit with the worker idle.
  worker.unref();
  let next = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; progress?: (done: number, total: number) => void }>();
  worker.on("message", (response: IndexResponse) => {
    const p = pending.get(response.id);
    if (!p) return;
    if ("progress" in response) {
      p.progress?.(...response.progress);
      return;
    }
    pending.delete(response.id);
    if (response.ok) p.resolve(response.value);
    else p.reject(new Error(response.error));
  });
  const failed = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  worker.on("error", failed);
  worker.on("exit", () => failed(new Error("the index worker stopped")));
  const call = <T,>(request: Call, progress?: (done: number, total: number) => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, ...(progress ? { progress } : {}) });
      worker.postMessage({ ...request, id });
    });
  return {
    exec: (sql) => call({ op: "exec", sql }),
    run: (sql, params = []) => call({ op: "run", sql, params }),
    all: (sql, params = []) => call<Record<string, SqlValue>[]>({ op: "all", sql, params }),
    batch: (sql, params) => call({ op: "batch", sql, params }),
    ensure: (name, tableDir, onProgress) => call<number>({ op: "ensure", name, tableDir }, onProgress),
    search: (name) => call({ op: "search", name }),
    rows: (request) => call({ op: "rows", request }),
    build: (name, tableDir, onProgress) => call<number>({ op: "build", name, tableDir }, onProgress),
    save: (name, tableDir, rows, omit) => call({ op: "save", name, tableDir, rows, ...(omit ? { omit } : {}) }),
    close: async () => {
      await call({ op: "close" });
      await worker.terminate();
    },
  };
}
