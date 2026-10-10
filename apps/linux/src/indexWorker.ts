// The bundle's index, off the thread that draws: this worker owns
// `index.sqlite` (table-app's openIndexHost over node:sqlite) and does what
// the window asks of it, a message at a time. A build streams a table's
// rows in and says how far it has got; nothing here touches GTK.

import { parentPort, workerData } from "node:worker_threads";
import { openIndexHost } from "@workspace.sh/table-app/node";
import { buildSearchIndex } from "@workspace.sh/table-core";
import type { RowsRequest } from "@workspace.sh/table-app";
import type { SqlValue } from "@workspace.sh/table-core";

export type IndexRequest = { id: number } & (
  | { op: "exec"; sql: string }
  | { op: "run"; sql: string; params: SqlValue[] }
  | { op: "all"; sql: string; params: SqlValue[] }
  | { op: "batch"; sql: string; params: SqlValue[][] }
  | { op: "ensure"; name: string; tableDir: string }
  | { op: "build"; name: string; tableDir: string }
  | { op: "search"; name: string }
  | { op: "rows"; request: RowsRequest }
  | { op: "peek"; name: string; start: number; end: number }
  | { op: "save"; name: string; tableDir: string; rows: boolean; omit?: string[] }
  | { op: "close" }
);

export type IndexResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  | { id: number; progress: [done: number, total: number] };

// One at a time, in the order asked.
let last: Promise<unknown> = Promise.resolve();
let lastAsked = 0;
const inTurn = <T,>(run: () => Promise<T>): Promise<T> => {
  const turn = last.then(run);
  last = turn.catch(() => {});
  return turn;
};

// A build doesn't hold the worker: each of its statements takes a turn, after
// the messages already waiting have been heard, so the window's reads are
// answered between them and see the rows it has put in so far.
const host = openIndexHost((workerData as { bundleDir: string }).bundleDir, {
  turn: (run) => new Promise<void>((heard) => setImmediate(heard)).then(() => inTurn(run)),
});
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
    case "rows":
      return host.rows(request.request);
    case "peek":
      return host.peek(request.name, request.start, request.end);
    case "search":
      // Not reached: made a step at a time, below.
      return undefined;
    case "build":
      return host.build(request.name, request.tableDir, (done, total) => port.postMessage({ id: request.id, progress: [done, total] } satisfies IndexResponse));
    case "save":
      return host.save(request.name, request.tableDir, request.rows, request.omit);
    case "close":
      return host.close();
  }
}

// A build under way, and when it is done. Anything that would write waits for
// it: a build is one transaction, and would take the write with it if it failed.
let building: Promise<unknown> | null = null;
const writes = (request: IndexRequest): boolean =>
  request.op === "ensure" ||
  request.op === "build" ||
  request.op === "save" ||
  request.op === "search" ||
  request.op === "run" ||
  request.op === "exec" ||
  request.op === "batch" ||
  request.op === "close" ||
  (request.op === "rows" && request.request.ask === "edits");

function build(request: IndexRequest & { op: "ensure" | "build" }): void {
  const progress = (done: number, total: number) => port.postMessage({ id: request.id, progress: [done, total] } satisfies IndexResponse);
  const done = request.op === "ensure" ? host.ensure(request.name, request.tableDir, progress) : host.build(request.name, request.tableDir, progress);
  const settled = done.then(
    () => {},
    () => {},
  );
  building = settled;
  void settled.then(() => {
    if (building === settled) building = null;
  });
  done.then(
    (value) => port.postMessage({ id: request.id, ok: true, value } satisfies IndexResponse),
    (error: unknown) => port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies IndexResponse),
  );
}

/**
 * A search index is made a step at a time, each step taking its turn behind
 * whatever was asked meanwhile: the window's queries and edits are answered
 * between steps, not after the whole of it.
 */
function searchStep(request: IndexRequest & { op: "search" }): void {
  // The window comes first: a step waits until it has asked for nothing for a moment.
  if (Date.now() - lastAsked < 250) return void setTimeout(() => searchStep(request), 125);
  // Small steps: what the window asks between them isn't kept waiting.
  inTurn(() => buildSearchIndex(host, request.name, 5000)).then(
      async (more) => {
        // After the messages already waiting, which the event loop hands over first.
        if (more) setImmediate(() => searchStep(request));
        else {
          await host.exec("pragma wal_checkpoint(truncate)");
          port.postMessage({ id: request.id, ok: true, value: undefined } satisfies IndexResponse);
        }
      },
      (error: unknown) => port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies IndexResponse),
    );
}

function take(request: IndexRequest): void {
  if (request.op === "ensure" || request.op === "build") return build(request);
  if (request.op === "search") return searchStep(request);
  lastAsked = Date.now();
  inTurn(() => answer(request) as Promise<unknown>).then(
    (value) => port.postMessage({ id: request.id, ok: true, value } satisfies IndexResponse),
    (error: unknown) => port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies IndexResponse),
  );
}

port.on("message", (request: IndexRequest) => {
  // A write waits for a build under way.
  if (building && writes(request)) void building.then(() => take(request));
  else take(request);
});
