// Tables held in their bundle's index (SPEC section 8): the screen's side of
// it, for every app. The screen never holds such a table's rows: the view on
// screen reads a window of them from the index, queued edits are made in it,
// and a save writes them back to the rows file beside it.
//
// What differs between the apps is only where a bundle's database comes from
// (`openIndexDatabase`): on iOS and the Mac the device's index host
// (indexHost.ts, given each platform's files and SQLite); on the web a worker
// over OPFS (apps/web/src/sqlite/client.ts); on Linux and in a document a
// worker over node:sqlite, beside the bundle's own folder
// (packages/gtk/src/indexed/useIndexedTables.ts adapts it).

import { isEditable, type AppAction, type AppState, type IndexWork } from "./appState.ts";
import { bundleOf, tableNameOf } from "./bundles.ts";
import { remoteEdits, remoteViewRows, type RemoteViewRows } from "./remoteRows.ts";
import { fieldChanges, type ParsedTable, type Row, type TableSchema, type View, type ViewRows } from "@workspace.sh/table-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IndexDatabase } from "./indexHost.ts";
import { heldText, withHeld, type HeldRows } from "./indexed.ts";

/**
 * A bundle's index, as this hook asks of it: the device's IndexDatabase,
 * the web's WebDatabase, or Linux's node:sqlite host behind an adapter.
 */
export interface IndexedTablesDatabase extends Omit<IndexDatabase, "heldRows"> {
  /**
   * Every row of a table whose index can't be made, read into memory: for
   * holding it there instead. Null when there's nothing to read it from
   * (its archive no longer held); throws when what there is can't be read.
   */
  heldRows(name: string): HeldRows | null | Promise<HeldRows | null>;
  /**
   * The head of a table's rows as stored, with their formulas worked out:
   * shown while its index is made. Only where nothing else gives them
   * (`hold`): Linux reads them from the table's own file.
   */
  firstRows?(name: string, schema: TableSchema): Promise<Row[]>;
  /** Where its storage is, when the platform can say: "elsewhere" when another window of the app holds it (the web's OPFS). */
  storage?(): Promise<string>;
}

export interface IndexedTables<D extends IndexedTablesDatabase = IndexedTablesDatabase> {
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
  /**
   * The table on screen was held in the index, and can't be read here: this
   * device no longer has it ("gone"), or another window of the app holds its
   * storage ("elsewhere", on the web).
   */
  lost: "gone" | "elsewhere" | null;
  /** Whether the table on screen can be edited yet: its rows read, into memory or into its index (isEditable). */
  editable: boolean;
  /**
   * A bundle just read from an archive: its large tables' first rows by
   * `bundle/table` key, and, where it was read straight into one, the
   * database each bundle's index is in.
   */
  hold(first: Record<string, Row[]>, databases?: Record<string, D>): void;
  /** A bundle's database, as `openIndexDatabase` gave it (the web asks it for timings). */
  databaseOf(bundle: string): Promise<D>;
  /** Every row of an indexed table, in file order: for what needs the whole table at once, like an archive. */
  everyRow(key: string, table: ParsedTable): Promise<Row[]>;
  /**
   * After the rest is saved: the indexed tables' rows, to the files kept beside their indexes.
   * `later`: a save of rows alone (no field changed) waits for `flush`, so the host decides
   * when (leaving the file, the app going to the background). A field's change is saved at once.
   * Says whether anything waits.
   */
  save(tables: Record<string, ParsedTable>, later?: boolean): Promise<boolean>;
  /** Save what waits (the rows of `save(…, true)`). */
  flush(): Promise<void>;
  /** A file closed: its database is let go of (closed, with `closeUnheld`), so its folder is no longer held open. */
  closeBundle(bundle: string): Promise<void>;
}

/** Rows a build puts in at a time: the last of them may not be in yet when its count is told. */
const BUILD_BATCH = 5000;

/** How long after a table is ready its search index is started: the view's first rows come first. */
const SEARCH_AFTER_MS = 1500;

/** What of a schema an index is made for: its fields' names and types, and their formulas, whose results it holds. */
const indexedFor = (schema: TableSchema) => JSON.stringify(schema.fields.map((f) => [f.name, f.type, f.computed ?? null]));

export function useIndexedTables<D extends IndexedTablesDatabase = IndexedTablesDatabase>(input: {
  state: AppState;
  dispatch: (action: AppAction) => void;
  /** The view on screen as shown (arranged). */
  view: View;
  tell: (heading: string, body?: string) => void;
  /**
   * A bundle's database, or one on its way (the web's worker). Undefined while
   * there's none to be had yet (Linux: the bundle has no folder yet): asked
   * again as the tables change.
   */
  openIndexDatabase: (bundle: string) => D | Promise<D> | undefined;
  /**
   * Close a bundle's database once none of its tables is held, and every one
   * when the screen goes. Off on a device, whose index host keeps them for
   * the next time the file is opened.
   */
  closeUnheld?: boolean;
}): IndexedTables<D> {
  const { state, dispatch, view, tell, openIndexDatabase, closeUnheld = false } = input;
  const hosts = useRef(new Map<string, Promise<D>>());
  const [made, setMade] = useState<Record<string, "building" | "ready" | "lost" | "elsewhere">>({});
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [first, setFirst] = useState<Record<string, Row[]>>({});
  const asked = useRef(new Set<string>());
  const madeFor = useRef(new Map<string, TableSchema>());
  // Tables whose rows changed in the index since they were last written.
  const unsaved = useRef(new Set<string>());
  // The screen has gone: what an index answers after isn't for anyone.
  const gone = useRef(false);
  const latest = useRef({ tell, dispatch, tables: state.tables, openIndexDatabase });
  latest.current = { tell, dispatch, tables: state.tables, openIndexDatabase };

  /** A bundle's database, if there is one yet: the one its archive was read into, or the one this device kept from before. */
  const hostIf = useCallback((bundle: string): Promise<D> | undefined => {
    let host = hosts.current.get(bundle);
    if (!host) {
      const opened = latest.current.openIndexDatabase(bundle);
      if (opened) hosts.current.set(bundle, (host = Promise.resolve(opened)));
    }
    return host;
  }, []);
  const hostOf = useCallback((bundle: string): Promise<D> => hostIf(bundle) ?? Promise.reject(new Error(`${bundle} has no index here`)), [hostIf]);

  const hold = useCallback((rows: Record<string, Row[]>, databases?: Record<string, D>) => {
    for (const [bundle, db] of Object.entries(databases ?? {})) hosts.current.set(bundle, Promise.resolve(db));
    setFirst((was) => ({ ...was, ...rows }));
  }, []);

  /** Its first rows, read from where they're stored, where the platform can and nothing gave them (hold). */
  const readFirst = (key: string, schema: TableSchema, host: D) => {
    void host.firstRows?.(tableNameOf(key), schema).then(
      (rows) => !gone.current && setFirst((was) => ({ ...was, [key]: rows })),
      () => {},
    );
  };

  const ready = (key: string, schema: TableSchema, count: number, host: D, after = SEARCH_AFTER_MS) => {
    madeFor.current.set(key, schema);
    latest.current.dispatch({ type: "indexed", key, count });
    setMade((was) => ({ ...was, [key]: "ready" }));
    // After the view has its first rows, behind whatever the screen asks for: what a change of fields
    // left to work out (IndexDatabase.fill), and then the search's own index. Once filled, the view
    // is asked again: what it sorts or filters by may now be the index's to answer.
    setTimeout(() => {
      if (gone.current) return;
      void host
        .fill(tableNameOf(key), schema)
        .then(() => {
          const table = latest.current.tables[key];
          if (!gone.current && table?.indexed && madeFor.current.get(key) === schema) latest.current.dispatch({ type: "indexed", key, count: table.indexed.count });
        })
        .then(() => (gone.current ? undefined : host.search(tableNameOf(key))))
        .catch(() => {});
    }, after);
  };

  /** Let go of a bundle's database: closed, where they're closed. */
  const release = (bundle: string) => {
    const host = hosts.current.get(bundle);
    hosts.current.delete(bundle);
    return closeUnheld && host ? host.then((h) => h.close()).catch(() => {}) : Promise.resolve();
  };

  // Make each indexed table's index ready, once, as it's first held.
  useEffect(() => {
    // A table no longer held (its file closed) is forgotten, so a file opened again under the
    // same name is read afresh rather than taken for the one that was here.
    const dropped = [...asked.current].filter((key) => !state.tables[key]);
    if (dropped.length > 0) {
      const drop = <T>(was: Record<string, T>) => Object.fromEntries(Object.entries(was).filter(([key]) => !dropped.includes(key)));
      for (const key of dropped) {
        asked.current.delete(key);
        madeFor.current.delete(key);
        unsaved.current.delete(key);
      }
      for (const bundle of new Set(dropped.map(bundleOf))) {
        if (!Object.keys(state.tables).some((key) => bundleOf(key) === bundle)) void release(bundle);
      }
      setMade(drop);
      setProgress(drop);
      setFirst(drop);
    }
    for (const [key, table] of Object.entries(state.tables)) {
      if (!table.indexed || asked.current.has(key)) continue;
      const opening = hostIf(bundleOf(key));
      // No database to be had yet: asked again as the tables change.
      if (!opening) continue;
      asked.current.add(key);
      // An index taken as it is (the same file opened again) isn't read: nothing says it is.
      if (!table.indexed.kept) setMade((was) => ({ ...was, [key]: "building" }));
      const schema = table.schema;
      void opening
        .then((host) => {
          // Something to look at meanwhile: the head of its rows.
          if (!table.indexed?.kept) readFirst(key, schema, host);
          return host.ensure(tableNameOf(key), schema, (done, total) => setProgress((was) => ({ ...was, [key]: { done, total } }))).then((count) => !gone.current && ready(key, schema, count, host));
        })
        .catch(async (error: unknown) => {
          // The screen has gone (its file closed) while the index was made: nothing is waiting for it.
          if (gone.current) return;
          // No index to be had (a line of its rows that couldn't be read, no space, no SQLite): while
          // there is something to read it from, the table is read into memory instead, with what
          // couldn't be read kept, and says so (#567). With nothing to read it from (the app was
          // started again), or what there is damaged, its rows are lost to this device.
          let held: HeldRows | null = null;
          let unread: unknown;
          try {
            held = await (await opening).heldRows(tableNameOf(key));
          } catch (failed) {
            unread = failed;
          }
          if (gone.current) return;
          if (held) {
            const { indexed: _indexed, ...rest } = table;
            asked.current.delete(key);
            setMade(({ [key]: _was, ...others }) => others);
            // Said on the table, as its summary's "held in memory", not as an alert (workspace#711).
            latest.current.dispatch({
              type: "reloaded",
              key,
              table: { ...rest, ...withHeld(held) },
              held: heldText(tableNameOf(key), error, held),
            });
            return;
          }
          setMade((was) => ({ ...was, [key]: "lost" }));
          if (unread !== undefined) latest.current.tell(`Couldn't read ${tableNameOf(key)}`, unread instanceof Error ? unread.message : String(unread));
          // Not gone if another window holds the storage: it's there, and this one can't reach it.
          void opening
            .then((host) => host.storage?.())
            .then(
              (storage) => storage === "elsewhere" && setMade((was) => ({ ...was, [key]: "elsewhere" })),
              () => {},
            );
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tables]);

  // Gone (the screen closed): its databases are let go of.
  useEffect(
    () => () => {
      gone.current = true;
      for (const bundle of [...hosts.current.keys()]) void release(bundle);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const closeBundle = useCallback(async (bundle: string) => {
    await release(bundle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = state.tables[state.active];
  const isReady = !!active?.indexed && made[state.active] === "ready";
  const fits = (key: string, table: ParsedTable) => {
    const was = madeFor.current.get(key);
    return !!was && indexedFor(was) === indexedFor(table.schema);
  };

  // The view on screen's rows.
  const [source, setSource] = useState<{ key: string; asked: string; rows: RemoteViewRows } | undefined>(undefined);
  const askingOf = (version: number | string) =>
    `${state.active}\u0000${version}\u0000${JSON.stringify([view.filter, view.sort, view.order, view.group, view.totals, view.hidden])}\u0000${state.search}`;
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
        return {
          count,
          back,
          then: { key: next.key, asked: shown.askingOf(version), rows },
        };
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

  // The tables whose rows wait for flush, as they were last asked to be saved.
  const waitingSave = useRef<Record<string, ParsedTable> | null>(null);
  const save = useCallback(
    async (tables: Record<string, ParsedTable>, later = false): Promise<boolean> => {
      let waits = false;
      for (const [key, table] of Object.entries(tables)) {
        if (!table.indexed || !madeFor.current.has(key)) continue;
        const host = await hostOf(bundleOf(key));
        const was = madeFor.current.get(key)!;
        // Matched by id (D62): a field renamed is the same field, its values kept (#709).
        const { gone, renamed } = fieldChanges(was, table.schema);
        const rows = unsaved.current.has(key) || gone.length > 0;
        // Its fields changed in a way the index holds: it's changed in place, or made
        // again from the rows saved here, so edits wait from now (they'd be lost between the two).
        const again = indexedFor(was) !== indexedFor(table.schema);
        // Rows alone, when the host says when: they wait (in the index, and marked there) for flush.
        if (later && !again && gone.length === 0 && renamed.length === 0) {
          madeFor.current.set(key, table.schema);
          if (rows) {
            waitingSave.current = {
              ...(waitingSave.current ?? {}),
              [key]: table,
            };
            waits = true;
          }
          continue;
        }
        if (again) setMade((m) => ({ ...m, [key]: "building" }));
        // An undo brought fields back (#562): the index is changed first, so the rows it
        // writes have their values again, kept hidden since they were removed.
        const restore = (table.indexed.restore ?? []).filter((name) => !was.fields.some((f) => f.name === name));
        // So does a rename (D63): its rows are written with the new name only once the index
        // has it. Saved first, every row would be written without the field.
        if (again && (restore.length > 0 || renamed.length > 0) && (await host.alter(tableNameOf(key), was, table.schema, { restore }).catch(() => false))) {
          unsaved.current.delete(key);
          try {
            await host.save(tableNameOf(key), table.schema, true, gone, true);
          } catch (error) {
            unsaved.current.add(key);
            setMade((m) => ({ ...m, [key]: "ready" }));
            throw error;
          }
          ready(key, table.schema, latest.current.tables[key]?.indexed?.count ?? table.indexed.count, host, 0);
          continue;
        }
        if (again && renamed.length > 0) {
          // The index can't take the new name where it is: nothing is written, so no row
          // loses the field's values. The file keeps its old name until it's saved again.
          setMade((m) => ({ ...m, [key]: "ready" }));
          latest.current.tell("Couldn't rename the field", "This table's index couldn't be changed. Its file is as it was.");
          continue;
        }
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
        const schema = table.schema;
        // Changed where it is when it can be: the table answers for its new fields at once,
        // and what has to be worked out again is, behind it.
        if (await host.alter(tableNameOf(key), was, schema).catch(() => false)) {
          ready(key, schema, latest.current.tables[key]?.indexed?.count ?? table.indexed.count, host, 0);
          continue;
        }
        // Not awaited: the save is done, and the table shows its first rows while this runs.
        setProgress(({ [key]: _old, ...rest }) => rest);
        readFirst(key, schema, host);
        void host
          .build(tableNameOf(key), schema, (done, total) => setProgress((p) => ({ ...p, [key]: { done, total } })))
          .then(
            (count) => ready(key, schema, count, host),
            (error: unknown) => latest.current.tell("Couldn't read this table again", error instanceof Error ? error.message : String(error)),
          );
      }
      return waits;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const flush = useCallback(async () => {
    const waiting = waitingSave.current;
    if (!waiting) return;
    waitingSave.current = null;
    await save(waiting);
  }, [save]);

  const state_ = active?.indexed ? made[state.active] : undefined;
  const lost = state_ === "lost" ? "gone" : state_ === "elsewhere" ? "elsewhere" : null;
  // The rows read so far, as a source the table view can scroll through: the
  // first ones are here already, the rest are asked of the index, which sees
  // what its build has put in. One snapshot that only grows, so what the view
  // has read of it stays good.
  const firstHere = first[state.active];
  // (Kept past the end of the reading, until the view's own rows have arrived: nothing blanks between the two.)
  const stillReading = state_ === "building" || ((state_ === "ready" || (state_ === undefined && active?.indexed?.kept)) && source?.key !== state.active);
  const readSoFar = active?.indexed && stillReading && firstHere ? (state_ === "ready" ? active.indexed.count : Math.max(firstHere.length, (progress[state.active]?.done ?? 0) - BUILD_BATCH)) : 0;
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

  const building =
    active?.indexed && state_ !== "ready" && lost === null && !(state_ === undefined && active.indexed.kept) ? (progress[state.active] ?? { done: 0, total: active.indexed.count }) : null;
  return {
    hold,
    databaseOf: hostOf,
    save,
    flush,
    closeBundle,
    everyRow,
    building,
    editable: isEditable(active, building !== null || lost !== null),
    reading,
    source: isReady && source?.key === state.active ? source.rows : undefined,
    lost,
    stale: isReady && source?.key === state.active && source.asked !== asking,
  };
}
