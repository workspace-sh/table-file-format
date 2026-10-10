// Tables held in their bundle's index (SPEC section 8): the phone's side
// of it. A bundle with a large table is a folder in the app's documents,
// with its index and the table's rows beside it (indexHost.ts). The screen
// never holds such a table's rows: the view on screen reads a window of
// them from the index, queued edits are made in it, and a save writes them
// back to the rows file beside it.
//
// (This is the web's hook, apps/web/src/useIndexedTables.ts, with the
// phone's index host in place of the web's worker; Linux has the same over
// node:sqlite in apps/linux/src/useIndexedTables.ts. What differs is where
// a host comes from and what it's made from.)

import { bundleOf, remoteEdits, remoteViewRows, tableNameOf, type AppAction, type AppState, type IndexWork, type RemoteViewRows } from "@workspace.sh/table-app";
import type { ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openIndexDatabase, type IndexDatabase } from "./indexHost";

export interface IndexedTables {
  /** The table on screen is held in the index, and it's being read into it: how far along. */
  building: { done: number; total: number } | null;
  /**
   * While it's read: its rows as stored, as many as are in so far, to show
   * and scroll through meanwhile. They grow as the reading goes on.
   */
  reading: ViewRows | undefined;
  /** The view on screen's rows, once read; undefined for a table in memory, or while they're on their way. */
  source: ViewRows | undefined;
  /** The rows on screen are from before the last change to the view or the search: the new ones are on their way. */
  stale: boolean;
  /** The table on screen was held in the index, and this phone no longer has it. */
  lost: boolean;
  /** A bundle just read from an archive: its large tables' first rows by `bundle/table` key. */
  hold(first: Record<string, Row[]>): void;
  /** Every row of an indexed table, in file order: for what needs the whole table at once, like an archive. */
  everyRow(key: string, table: ParsedTable): Promise<Row[]>;
  /** After the rest is saved: the indexed tables' rows, to the files kept beside their indexes. */
  save(tables: Record<string, ParsedTable>): Promise<void>;
}

/** Rows a build puts in at a time: the last of them may not be in yet when its count is told. */
const BUILD_BATCH = 5000;

/** How long after a table is ready its search index is started: the view's first rows come first. */
const SEARCH_AFTER_MS = 1500;

/** What of a schema an index is made for: its fields' names and types, and their formulas, whose results it holds. */
const indexedFor = (schema: TableSchema) => JSON.stringify(schema.fields.map((f) => [f.name, f.type, f.computed ?? null]));

export function useIndexedTables(input: {
  state: AppState;
  dispatch: (action: AppAction) => void;
  /** The view on screen as shown (arranged). */
  view: View;
  tell: (heading: string, body?: string) => void;
}): IndexedTables {
  const { state, dispatch, view, tell } = input;
  const hosts = useRef(new Map<string, IndexDatabase>());
  const [made, setMade] = useState<Record<string, "building" | "ready" | "lost">>({});
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [first, setFirst] = useState<Record<string, Row[]>>({});
  const asked = useRef(new Set<string>());
  const madeFor = useRef(new Map<string, TableSchema>());
  // Tables whose rows changed in the index since they were last written.
  const unsaved = useRef(new Set<string>());
  const latest = useRef({ tell, dispatch });
  latest.current = { tell, dispatch };

  /** A bundle's database: the one its archive was read into, or the one this phone kept from before. */
  const hostOf = useCallback((bundle: string): Promise<IndexDatabase> => {
    let host = hosts.current.get(bundle);
    if (!host) hosts.current.set(bundle, (host = openIndexDatabase(bundle)));
    return Promise.resolve(host);
  }, []);

  const hold = useCallback((rows: Record<string, Row[]>) => {
    setFirst((was) => ({ ...was, ...rows }));
  }, []);

  const ready = (key: string, schema: TableSchema, count: number, host: IndexDatabase) => {
    madeFor.current.set(key, schema);
    latest.current.dispatch({ type: "indexed", key, count });
    setMade((was) => ({ ...was, [key]: "ready" }));
    // The search's own index is made after the view has its first rows, behind whatever the screen asks for.
    setTimeout(() => void host.search(tableNameOf(key)).catch(() => {}), SEARCH_AFTER_MS);
  };

  // Make each indexed table's index ready, once, as it's first held.
  useEffect(() => {
    for (const [key, table] of Object.entries(state.tables)) {
      if (!table.indexed || asked.current.has(key)) continue;
      asked.current.add(key);
      setMade((was) => ({ ...was, [key]: "building" }));
      const schema = table.schema;
      void hostOf(bundleOf(key))
        .then(async (host) => ready(key, schema, await host.ensure(tableNameOf(key), schema, (done, total) => setProgress((was) => ({ ...was, [key]: { done, total } }))), host))
        .catch(async (error: unknown) => {
          // No index to be had (no space, say): while the archive it came in is still
          // held, the table is read from it into memory instead, and says so. With
          // nothing to read it from (the app was started again), or an archive that
          // turns out damaged, its rows are lost to this phone.
          let rows: Row[] | null = null;
          try {
            rows = (await hostOf(bundleOf(key))).heldRows(tableNameOf(key));
          } catch {
            rows = null;
          }
          if (!rows) return setMade((was) => ({ ...was, [key]: "lost" }));
          const { indexed: _indexed, ...rest } = table;
          asked.current.delete(key);
          setMade(({ [key]: _was, ...others }) => others);
          latest.current.dispatch({ type: "reloaded", key, table: { ...rest, rows } });
          latest.current.tell(
            "Opened without its index",
            `${tableNameOf(key)} is large, and its index couldn't be made (${error instanceof Error ? error.message : String(error)}). It's held in memory instead, and may be slow.`,
          );
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tables]);

  const active = state.tables[state.active];
  const isReady = !!active?.indexed && made[state.active] === "ready";
  const fits = (key: string, table: ParsedTable) => {
    const was = madeFor.current.get(key);
    return !!was && indexedFor(was) === indexedFor(table.schema);
  };

  // The view on screen's rows.
  const [source, setSource] = useState<{ key: string; asked: string; rows: RemoteViewRows } | undefined>(undefined);
  const askingOf = (version: number | string) =>
    `${state.active}\u0000${version}\u0000${JSON.stringify([view.filter, view.sort, view.order, view.group, view.totals])}\u0000${state.search}`;
  const asking = askingOf(active?.indexed?.version ?? "");
  const shownNow = useRef({ source, view, search: state.search, askingOf });
  shownNow.current = { source, view, search: state.search, askingOf };
  useEffect(() => {
    if (!isReady || !active || !fits(state.active, active)) return;
    // Already here: an edit brings the next snapshot's rows with it (below).
    if (source?.asked === asking) return;
    let current = true;
    void hostOf(bundleOf(state.active))
      .then((host) => remoteViewRows(host.rows, tableNameOf(state.active), active, view, state.search))
      .then(
        (rows) => current && setSource({ key: state.active, asked: asking, rows }),
        (error: unknown) => current && latest.current.tell("Couldn't read this table's rows", error instanceof Error ? error.message : String(error)),
      );
    return () => {
      current = false;
    };
    // `asking` stands for the table's snapshot, the view's query and the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, asking]);

  // Queued edits, made in order, one table's at a time.
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current) return;
    const next = state.indexWork.find((w) => made[w.key] === "ready");
    if (!next) return;
    const work: IndexWork[] = state.indexWork.filter((w) => w.key === next.key);
    const table = state.tables[next.key];
    if (!table || !fits(next.key, table)) return;
    busy.current = true;
    const done = work.at(-1)!.n;
    void hostOf(bundleOf(next.key))
      .then(async (host) => {
        const { count, back } = await remoteEdits(host.rows, tableNameOf(next.key), table, work);
        // The table on screen: its next snapshot is opened here, with the rows it is
        // showing read ahead, so the edit shows in one draw and not after three.
        const shown = shownNow.current;
        if (next.key !== state.active || !shown.source || shown.source.key !== next.key) return { count, back, then: undefined };
        const version = (table.indexed?.version ?? 0) + 1;
        const rows = await remoteViewRows(host.rows, tableNameOf(next.key), { ...table, indexed: { count, version } }, shown.view, shown.search);
        await rows.readAhead(shown.source.rows.recent());
        return { count, back, then: { key: next.key, asked: shown.askingOf(version), rows } };
      })
      .then(
        ({ count, back, then }) => {
          if (work.some((w) => w.kind !== "body")) unsaved.current.add(next.key);
          latest.current.dispatch({ type: "indexed", key: next.key, count, done, back });
          if (then) setSource(then);
        },
        (error: unknown) => {
          latest.current.tell("Couldn't make that change", error instanceof Error ? error.message : String(error));
          latest.current.dispatch({ type: "indexed", key: next.key, count: table.indexed?.count ?? 0, done });
        },
      )
      .finally(() => {
        busy.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.indexWork, made]);

  const save = useCallback(
    async (tables: Record<string, ParsedTable>) => {
      for (const [key, table] of Object.entries(tables)) {
        if (!table.indexed || !madeFor.current.has(key)) continue;
        const host = await hostOf(bundleOf(key));
        const was = madeFor.current.get(key)!;
        const gone = was.fields.filter((f) => !table.schema.fields.some((g) => g.name === f.name)).map((f) => f.name);
        const rows = unsaved.current.has(key) || gone.length > 0;
        // Its fields changed in a way the index holds: it's made again from the rows
        // saved here, so edits wait from now (they'd be lost between the two).
        const again = indexedFor(was) !== indexedFor(table.schema);
        if (again) setMade((m) => ({ ...m, [key]: "building" }));
        unsaved.current.delete(key);
        let saved: boolean;
        try {
          saved = await host.save(tableNameOf(key), was, rows, gone, again);
        } catch (error) {
          if (rows) unsaved.current.add(key);
          if (again) setMade((m) => ({ ...m, [key]: "ready" }));
          throw error;
        }
        if (!saved) {
          // An edit landed while it was written: it's saved again after that edit.
          if (rows) unsaved.current.add(key);
          // Never left waiting for a build that isn't coming.
          if (again) setMade((m) => ({ ...m, [key]: "ready" }));
          continue;
        }
        if (!again) {
          madeFor.current.set(key, table.schema);
          continue;
        }
        setProgress(({ [key]: _old, ...rest }) => rest);
        const schema = table.schema;
        void host
          .build(tableNameOf(key), schema, (done, total) => setProgress((p) => ({ ...p, [key]: { done, total } })))
          .then(
            (count) => ready(key, schema, count, host),
            (error: unknown) => latest.current.tell("Couldn't read this table again", error instanceof Error ? error.message : String(error)),
          );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const state_ = active?.indexed ? made[state.active] : undefined;
  // The rows read so far, as a source the table view can scroll through: the
  // first ones are here already, the rest are asked of the index, which sees
  // what its build has put in. One snapshot that only grows, so what the view
  // has read of it stays good.
  const firstHere = first[state.active];
  // (Kept past the end of the reading, until the view's own rows have arrived: nothing blanks between the two.)
  const stillReading = state_ === "building" || (state_ === "ready" && source?.key !== state.active);
  const readSoFar =
    active?.indexed && stillReading && firstHere
      ? state_ === "ready"
        ? active.indexed.count
        : Math.max(firstHere.length, (progress[state.active]?.done ?? 0) - BUILD_BATCH)
      : 0;
  const reading = useMemo((): ViewRows | undefined => {
    if (readSoFar === 0 || !firstHere) return undefined;
    const key = state.active;
    const rows = async (start: number, end: number): Promise<Row[]> => {
      const from = Math.max(0, start);
      const to = Math.min(end, readSoFar);
      if (to <= from) return [];
      if (to <= firstHere.length) return firstHere.slice(from, to);
      return (await hostOf(bundleOf(key))).peek(tableNameOf(key), from, to);
    };
    return {
      count: readSoFar,
      inView: readSoFar,
      version: `reading ${key}`,
      rows,
      peek: (start, end) => (Math.min(end, readSoFar) <= firstHere.length ? firstHere.slice(Math.max(0, start), Math.min(end, readSoFar)) : undefined),
      ids: async (start, end) => (await rows(start, end)).map((r) => r.id),
      placeOf: async (id) => firstHere.findIndex((r) => r.id === id),
      row: async (id) => firstHere.find((r) => r.id === id),
      totals: async () => ({}),
      groups: async () => [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, readSoFar, firstHere]);
  const everyRow = useCallback(
    async (key: string, table: ParsedTable): Promise<Row[]> => {
      const host = await hostOf(bundleOf(key));
      // The table as stored: no view's order, filters or search.
      const all = await remoteViewRows(host.rows, tableNameOf(key), table, { id: "", name: "", layout: "table" }, "");
      try {
        return await all.rows(0, all.count);
      } finally {
        all.release();
      }
    },
    [hostOf],
  );

  return {
    hold,
    save,
    everyRow,
    building: active?.indexed && state_ !== "ready" && state_ !== "lost" ? (progress[state.active] ?? { done: 0, total: active.indexed.count }) : null,
    reading,
    source: isReady && source?.key === state.active ? source.rows : undefined,
    lost: state_ === "lost",
    stale: isReady && source?.key === state.active && source.asked !== asking,
  };
}
