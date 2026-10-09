// A view's rows asked for across a thread: the index lives in a worker, and
// a page that ran the indexer itself would send it one message a statement,
// a dozen to open a view. Here the worker runs the indexer (`rowsServer`)
// and the page holds a ViewRows whose every answer is one message
// (`remoteViewRows`). Edits go the same way. No platform here: the web's
// worker and Linux's both serve it.

import type { ParsedTable, Row, RowGroup, SqlDriver, View, ViewRows } from "@workspace.sh/table-core";

import { indexedViewRows, makeIndexEdits, type IndexEdit } from "./indexed.ts";

/** What of a table a worker needs to answer for it: not its rows, which it holds. */
export type TableFacts = Pick<ParsedTable, "schema" | "bodies" | "indexed">;

export type RowsRequest =
  | { ask: "view"; name: string; table: TableFacts; view: View; search: string }
  | { ask: "rows" | "ids"; handle: number; start: number; end: number }
  | { ask: "placeOf" | "row"; handle: number; id: string }
  | { ask: "totals" | "groups" | "release"; handle: number }
  | { ask: "edits"; name: string; table: TableFacts; edits: IndexEdit[] };

interface Opened {
  handle: number;
  count: number;
  inView: number;
  version: string;
}

const whole = (table: TableFacts): ParsedTable => ({ rows: [], views: [], meta: {}, path: "", ...table });

/** The worker's side: answers RowsRequests over `db`, holding the last few views open. */
export function rowsServer(db: SqlDriver, keep = 6): (request: RowsRequest) => Promise<unknown> {
  const open = new Map<number, ViewRows>();
  let next = 1;
  const held = (handle: number): ViewRows => {
    const rows = open.get(handle);
    if (!rows) throw new Error("that view of the table is no longer open");
    return rows;
  };
  return async (request) => {
    switch (request.ask) {
      case "view": {
        const rows = await indexedViewRows(db, request.name, whole(request.table), request.view, request.search);
        const handle = next++;
        open.set(handle, rows);
        // The oldest go: a page asks only of the view on screen and the one before it.
        for (const old of open.keys()) {
          if (open.size <= keep) break;
          open.delete(old);
        }
        return { handle, count: rows.count, inView: rows.inView, version: rows.version } satisfies Opened;
      }
      case "rows":
        return held(request.handle).rows(request.start, request.end);
      case "ids":
        return held(request.handle).ids(request.start, request.end);
      case "placeOf":
        return held(request.handle).placeOf(request.id);
      case "row":
        return held(request.handle).row(request.id);
      case "totals":
        return held(request.handle).totals();
      case "groups":
        return held(request.handle).groups();
      case "release":
        open.delete(request.handle);
        return undefined;
      case "edits":
        return makeIndexEdits(db, request.name, whole(request.table), request.edits);
    }
  };
}

export interface RemoteViewRows extends ViewRows {
  /** The windows read of late, as [start, end]. */
  recent(): [number, number][];
  /** Read these windows now, so they are held (`peek`) when a list asks. */
  readAhead(windows: [number, number][]): Promise<void>;
  release(): void;
}

/** The page's side: the rows a view of an indexed table shows, each answer one message to the worker. */
export async function remoteViewRows(
  ask: (request: RowsRequest) => Promise<unknown>,
  name: string,
  table: TableFacts,
  view: View,
  search = "",
): Promise<RemoteViewRows> {
  const { schema, bodies, indexed } = table;
  const opened = (await ask({ ask: "view", name, table: { schema, ...(bodies ? { bodies } : {}), ...(indexed ? { indexed } : {}) }, view, search })) as Opened;
  const { handle } = opened;
  // The last few windows read, kept: what `peek` answers from, and what the next snapshot reads ahead.
  const kept = new Map<string, Row[]>();
  const keep = (start: number, end: number, rows: Row[]) => {
    kept.delete(`${start}:${end}`);
    kept.set(`${start}:${end}`, rows);
    for (const old of kept.keys()) {
      if (kept.size <= 6) break;
      kept.delete(old);
    }
    return rows;
  };
  const read = async (start: number, end: number) => keep(start, end, (await ask({ ask: "rows", handle, start, end })) as Row[]);
  return {
    peek: (start, end) => kept.get(`${start}:${end}`),
    recent: () => [...kept.keys()].map((k) => k.split(":").map(Number) as [number, number]),
    readAhead: async (windows) => {
      await Promise.all(windows.map(([start, end]) => read(start, end)));
    },
    count: opened.count,
    inView: opened.inView,
    version: opened.version,
    rows: (start, end) => (end <= Math.max(0, start) ? Promise.resolve([]) : read(start, end)),
    ids: (start, end) => (end <= Math.max(0, start) ? Promise.resolve([]) : (ask({ ask: "ids", handle, start, end }) as Promise<string[]>)),
    placeOf: (id) => ask({ ask: "placeOf", handle, id }) as Promise<number>,
    row: (id) => ask({ ask: "row", handle, id }) as Promise<Row | undefined>,
    totals: () => ask({ ask: "totals", handle }) as Promise<Record<string, number | undefined>>,
    groups: () => ask({ ask: "groups", handle }) as Promise<RowGroup[]>,
    release: () => void ask({ ask: "release", handle }).catch(() => {}),
  };
}

/** The page's side of an edit: made in the worker, which says how many rows the table has after. */
export function remoteEdits(ask: (request: RowsRequest) => Promise<unknown>, name: string, table: TableFacts, edits: readonly IndexEdit[]): Promise<number> {
  const { schema, bodies, indexed } = table;
  return ask({ ask: "edits", name, table: { schema, ...(bodies ? { bodies } : {}), ...(indexed ? { indexed } : {}) }, edits: [...edits] }) as Promise<number>;
}
