// The bundle's index, off the thread that draws: this worker owns
// `index.sqlite` (table-app's openIndexHost over node:sqlite) and does what
// the window asks of it, a message at a time. A build streams a table's
// rows in and says how far it has got; nothing here touches GTK.

import { parentPort, workerData } from "node:worker_threads";
import { openIndexHost } from "@workspace.sh/table-app/node";
import type { SqlValue } from "@workspace.sh/table-core";

export type IndexRequest = { id: number } & (
  | { op: "exec"; sql: string }
  | { op: "run"; sql: string; params: SqlValue[] }
  | { op: "all"; sql: string; params: SqlValue[] }
  | { op: "batch"; sql: string; params: SqlValue[][] }
  | { op: "ensure"; name: string; tableDir: string }
  | { op: "build"; name: string; tableDir: string }
  | { op: "save"; name: string; tableDir: string; rows: boolean; omit?: string[] }
  | { op: "close" }
);

export type IndexResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: [done: number, total: number] };

const host = openIndexHost((workerData as { bundleDir: string }).bundleDir);
const port = parentPort!;

async function answer(request: IndexRequest): Promise<unknown> {
  switch (request.op) {
    case "exec":
      return host.exec(request.sql);
    case "run":
      return host.run(request.sql, request.params);
    case "all":
      return host.all(request.sql, request.params);
    case "batch":
      return host.batch!(request.sql, request.params);
    case "ensure":
      return host.ensure(request.name, request.tableDir, (done, total) => port.postMessage({ id: request.id, progress: [done, total] } satisfies IndexResponse));
    case "build":
      return host.build(request.name, request.tableDir, (done, total) => port.postMessage({ id: request.id, progress: [done, total] } satisfies IndexResponse));
    case "save":
      return host.save(request.name, request.tableDir, request.rows, request.omit);
    case "close":
      return host.close();
  }
}

// One at a time, in the order asked: a query never lands in the middle of a build's transaction.
let last: Promise<unknown> = Promise.resolve();
port.on("message", (request: IndexRequest) => {
  last = last
    .then(() => answer(request))
    .then(
      (value) => port.postMessage({ id: request.id, ok: true, value } satisfies IndexResponse),
      (error: unknown) => port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies IndexResponse),
    );
});
