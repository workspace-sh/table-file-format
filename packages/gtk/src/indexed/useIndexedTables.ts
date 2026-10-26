// Tables held in their bundle's index (SPEC section 8), for an app on Node
// that holds them in table-app's state: the Linux table app, and a .table
// opened or embedded in a document. Each bundle with a large table gets an
// index host (a worker over node:sqlite); a table's index is made fresh when
// it opens, with its progress shown; the view on screen reads its rows from
// it; queued edits are made in it; and a save writes its rows back to
// rows.ndjson.

import { bundleOf, remoteEdits, remoteViewRows, settled, tableNameOf, type AppAction, type AppState, type IndexWork, type RemoteViewRows } from "@workspace.sh/table-app";
import { computeRows, fieldChanges, queryIndex } from "@workspace.sh/table-core";
import { firstRows, packSingleFile, type IndexHost } from "@workspace.sh/table-app/node";
import { readTable } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import type { ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** What of a schema an index is made for: its fields' names and types, and their formulas, whose results it holds. */
const indexedFor = (schema: TableSchema) => JSON.stringify(schema.fields.map((f) => [f.name, f.type, f.computed ?? null]));

/** Rows a build puts in at a time: the last of them may not be in yet when its count is told. */
const BUILD_BATCH = 5000;

/** Rows shown from the head of the file while a table's index is made. */
const FIRST_ROWS = 200;

export interface IndexedTables {
  /** The table on screen is held in the index, and its index is being made: how far along. */
  building: { done: number; total: number } | null;
  /**
   * While it's being made: the table's rows as its file has them, as many
   * as are in so far, to show and scroll through meanwhile. They grow as
   * the reading goes on.
   */
  reading: ViewRows | undefined;
  /** The view on screen's rows, once read; undefined for a table in memory, or while they're on their way. */
  source: ViewRows | undefined;
  /** After a bundle's other files are written: its indexed tables' rows, and their indexes said fresh. */
  save(bundles: string[], tables: Record<string, ParsedTable>): Promise<void>;
  /** Every row of an indexed table, in file order: for what needs the whole table at once, like an archive. */
  everyRow(key: string): Promise<Row[]>;
  /** A file closed: its index is let go of, so its folder is no longer held open. */
  closeBundle(bundle: string): Promise<void>;
}

export function useIndexedTables(input: {
  state: AppState;
  dispatch: (action: AppAction) => void;
  /** The view on screen as shown (arranged). */
  view: View;
  /** Where a bundle is on disk. */
  pathOf: (bundle: string) => string | undefined;
  openIndex: (bundleDir: string) => IndexHost;
  tell: (heading: string, body?: string) => void;
}): IndexedTables {
  const { state, dispatch, view, pathOf, openIndex, tell } = input;
  const hosts = useRef(new Map<string, IndexHost>());
  // Each indexed table's index: being made, or ready.
  const [made, setMade] = useState<Record<string, "building" | "ready">>({});
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const asked = useRef(new Set<string>());
  // The schema each table's index was made for.
  const madeFor = useRef(new Map<string, TableSchema>());
  // The view has gone: what the index answers after isn't for anyone.
  const gone = useRef(false);
  const [first, setFirst] = useState<Record<string, Row[]>>({});
  // Tables whose rows changed in the index since they were last written.
  const unsaved = useRef(new Set<string>());
  const latest = useRef({ pathOf, tell, dispatch });
  latest.current = { pathOf, tell, dispatch };

  const hostOf = useCallback(
    (bundle: string): IndexHost | undefined => {
      let host = hosts.current.get(bundle);
      const path = latest.current.pathOf(bundle);
      if (!host && path) hosts.current.set(bundle, (host = openIndex(path)));
      return host;
    },
    [openIndex],
  );
  const dirOf = (key: string) => `${latest.current.pathOf(bundleOf(key))}/tables/${tableNameOf(key)}`;

  // Make each indexed table's index fresh, once, as it's first held.
  useEffect(() => {
    for (const [key, table] of Object.entries(state.tables)) {
      if (!table.indexed || asked.current.has(key)) continue;
      const host = hostOf(bundleOf(key));
      if (!host) continue;
      asked.current.add(key);
      setMade((was) => ({ ...was, [key]: "building" }));
      // Something to look at meanwhile: the head of the file, which is read in a moment.
      void firstRows(dirOf(key), FIRST_ROWS).then(
        // With their formulas worked out, as the rows in the index are.
        (rows) => setFirst((was) => ({ ...was, [key]: computeRows(schema, rows).rows })),
        () => {},
      );
      const schema = table.schema;
      host
        .ensure(tableNameOf(key), dirOf(key), (done, total) => setProgress((was) => ({ ...was, [key]: { done, total } })))
        .then(
          (count) => {
            madeFor.current.set(key, schema);
            latest.current.dispatch({ type: "indexed", key, count });
            setMade((was) => ({ ...was, [key]: "ready" }));
            // The search's own index is made after the view has its first rows, behind whatever the window asks for;
            // and what a change of fields left to work out, when the app closed before it was done.
            setTimeout(() => fillIn(host, key, schema), 1500);
          },
          async (error: unknown) => {
            // The view has gone (its file closed) while the index was made: nothing is waiting for it.
            if (gone.current) return;
            // No index to be had (no space, no SQLite): the table is held in memory instead, and says so.
            const why = error instanceof Error ? error.message : String(error);
            try {
              const table = await readTable(nodeFs, dirOf(key));
              if (gone.current) return;
              // Said on the table, as its summary's "held in memory", not as an alert (workspace#711).
              latest.current.dispatch({ type: "reloaded", key, table, held: `${tableNameOf(key)} is large, and its index couldn't be made (${why}). It's held in memory instead, and may be slow.` });
            } catch (unread) {
              // Nor can the file be read: it has gone from where it was, or can't be read.
              if (gone.current) return;
              latest.current.tell(`Couldn't read ${tableNameOf(key)}`, unread instanceof Error ? unread.message : String(unread));
            }
          },
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tables]);

  // A table no longer held (its file closed) is forgotten, so a file opened again under the same
  // name is read afresh rather than taken for the one that was here.
  useEffect(() => {
    const gone = [...asked.current].filter((key) => !state.tables[key]);
    if (gone.length === 0) return;
    const drop = <T,>(was: Record<string, T>) => Object.fromEntries(Object.entries(was).filter(([key]) => !gone.includes(key)));
    for (const key of gone) {
      asked.current.delete(key);
      madeFor.current.delete(key);
      unsaved.current.delete(key);
    }
    setMade(drop);
    setProgress(drop);
    setFirst(drop);
  }, [state.tables]);
  // Gone (the view closed): its indexes are let go of, once whatever it was writing is written.
  useEffect(
    () => () => {
      gone.current = true;
      for (const [bundle, host] of hosts.current) {
        const path = latest.current.pathOf(bundle);
        void (path ? settled(path) : Promise.resolve()).then(() => host.close()).catch(() => {});
      }
      hosts.current.clear();
    },
    [],
  );
  /**
   * What a change of fields left to work out, behind whatever the window
   * asks for (IndexHost.fill); then the search's own index. Done, the view
   * is asked again: what it sorts or filters by may now be the index's to answer.
   */
  const fillIn = useCallback((host: IndexHost, key: string, schema: TableSchema) => {
    const name = tableNameOf(key);
    void host
      .fill(name, schema)
      .then(async () => {
        if (gone.current || madeFor.current.get(key) !== schema) return;
        const count = (await queryIndex(host, { name, schema }))?.count;
        if (count !== undefined && !gone.current && madeFor.current.get(key) === schema) latest.current.dispatch({ type: "indexed", key, count });
      })
      .then(() => host.search(name))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A file closed: its index is let go of, so its folder is no longer held open. */
  const closeBundle = useCallback(async (bundle: string) => {
    const host = hosts.current.get(bundle);
    hosts.current.delete(bundle);
    await host?.close().catch(() => {});
  }, []);

  // The view on screen's rows.
  const active = state.tables[state.active];
  const ready = !!active?.indexed && made[state.active] === "ready";
  const [source, setSource] = useState<{ key: string; asked: string; rows: RemoteViewRows } | undefined>(undefined);
  const askingOf = (version: number | string) =>
    `${state.active}\u0000${version}\u0000${JSON.stringify([view.filter, view.sort, view.order, view.group, view.totals])}\u0000${state.search}`;
  const asking = askingOf(active?.indexed?.version ?? "");
  const shownNow = useRef({ source, view, search: state.search, askingOf });
  shownNow.current = { source, view, search: state.search, askingOf };
  // Whether a table's index holds what its schema now says: not from a change to its fields until it's made again.
  const fits = (key: string, table: ParsedTable) => {
    const was = madeFor.current.get(key);
    return !!was && indexedFor(was) === indexedFor(table.schema);
  };
  useEffect(() => {
    if (!ready || !active) return;
    // Its fields just changed: the rows on screen stay until the index is made again.
    if (!fits(state.active, active)) return;
    // Already here: an edit brings the next snapshot's rows with it (below).
    if (source?.asked === asking) return;
    const host = hostOf(bundleOf(state.active));
    if (!host) return;
    let current = true;
    remoteViewRows(host.rows, tableNameOf(state.active), active, view, state.search).then(
      (rows) => current && setSource({ key: state.active, asked: asking, rows }),
      (error: unknown) => current && latest.current.tell("Couldn't read this table's rows", error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
    // `asking` stands for the table's snapshot, the view's query and the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, asking]);

  // Queued edits, made in order, one table's at a time.
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current) return;
    const first = state.indexWork.find((w) => made[w.key] === "ready");
    if (!first) return;
    const work: IndexWork[] = state.indexWork.filter((w) => w.key === first.key);
    const table = state.tables[first.key];
    const host = hostOf(bundleOf(first.key));
    if (!table || !host || !fits(first.key, table)) return;
    busy.current = true;
    (async () => {
      const { count, back } = await remoteEdits(host.rows, tableNameOf(first.key), table, work);
      // The table on screen: its next snapshot is opened here, with the rows it is
      // showing read ahead, so the edit shows in one draw and not after three.
      const shown = shownNow.current;
      if (first.key !== state.active || !shown.source || shown.source.key !== first.key) return { count, back, then: undefined };
      const version = (table.indexed?.version ?? 0) + 1;
      const rows = await remoteViewRows(host.rows, tableNameOf(first.key), { ...table, indexed: { count, version } }, shown.view, shown.search);
      await rows.readAhead(shown.source.rows.recent());
      return { count, back, then: { key: first.key, asked: shown.askingOf(version), rows } };
    })()
      .then(
        ({ count, back, then }) => {
          if (work.some((w) => w.kind !== "body")) unsaved.current.add(first.key);
          latest.current.dispatch({ type: "indexed", key: first.key, count, done: work.at(-1)!.n, back });
          if (then) setSource(then);
        },
        (error: unknown) => {
          latest.current.tell("Couldn't make that change", error instanceof Error ? error.message : String(error));
          latest.current.dispatch({ type: "indexed", key: first.key, count: table.indexed?.count ?? 0, done: work.at(-1)!.n });
        },
      )
      .finally(() => {
        busy.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.indexWork, made]);

  useEffect(
    () => () => {
      for (const host of hosts.current.values()) void host.close().catch(() => {});
    },
    [],
  );

  const save = useCallback(
    async (bundles: string[], tables: Record<string, ParsedTable>) => {
      for (const [key, table] of Object.entries(tables)) {
        if (!table.indexed || !bundles.includes(bundleOf(key))) continue;
        const host = hosts.current.get(bundleOf(key));
        if (!host) continue;
        // Its fields changed: rows lose the fields that went, and the index
        // is made again when what it holds no longer fits (indexedFor).
        const was = madeFor.current.get(key);
        // Matched by id (D62): a field renamed is the same field, its values kept (#709).
        const { gone, renamed } = was ? fieldChanges(was, table.schema) : { gone: [] as string[], renamed: [] };
        const rows = unsaved.current.has(key) || gone.length > 0;
        // Its fields changed in a way the index holds: it's changed in place, or made
        // again from the rows saved here, so edits wait from now (they'd be lost between the two).
        const again = was !== undefined && indexedFor(was) !== indexedFor(table.schema);
        if (again) setMade((m) => ({ ...m, [key]: "building" }));
        // An undo brought fields back (#562): the index is changed first, so the rows it
        // writes have their values again, kept hidden since they were removed.
        const restore = (table.indexed.restore ?? []).filter((name) => !was?.fields.some((f) => f.name === name));
        // So does a rename (D63): its rows are written with the new name only once the index
        // has it. Saved first, every row would be written without the field.
        if (again && (restore.length > 0 || renamed.length > 0) && (await host.alter(tableNameOf(key), was, table.schema, { restore }).catch(() => false))) {
          const schema = table.schema;
          madeFor.current.set(key, schema);
          unsaved.current.delete(key);
          try {
            await host.save(tableNameOf(key), dirOf(key), true, gone, true);
            await packSingleFile(dirOf(key));
          } catch (error) {
            unsaved.current.add(key);
            setMade((m) => ({ ...m, [key]: "ready" }));
            throw error;
          }
          const count = (await queryIndex(host, { name: tableNameOf(key), schema }))?.count ?? table.indexed.count;
          latest.current.dispatch({ type: "indexed", key, count });
          setMade((m) => ({ ...m, [key]: "ready" }));
          fillIn(host, key, schema);
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
          saved = await host.save(tableNameOf(key), dirOf(key), rows, gone, again);
        } catch (error) {
          if (rows) unsaved.current.add(key);
          if (again) setMade((m) => ({ ...m, [key]: "ready" }));
          throw error;
        }
        if (!saved) {
          // An edit landed while it was written: it's saved again after that edit.
          if (rows) unsaved.current.add(key);
          continue;
        }
        // A single file's rows are in its working folder: packed back into the file (singleFile.ts).
        if (rows) void packSingleFile(dirOf(key)).catch((error: unknown) => latest.current.tell("Couldn't save the file", error instanceof Error ? error.message : String(error)));
        if (!again) {
          madeFor.current.set(key, table.schema);
          continue;
        }
        const schema = table.schema;
        // Changed where it is when it can be: the table answers for its new fields at once,
        // and what has to be worked out again is, behind it.
        const altered = await host.alter(tableNameOf(key), was, schema).catch(() => false);
        const count = altered ? (await queryIndex(host, { name: tableNameOf(key), schema }))?.count : undefined;
        if (count !== undefined) {
          madeFor.current.set(key, schema);
          latest.current.dispatch({ type: "indexed", key, count });
          setMade((m) => ({ ...m, [key]: "ready" }));
          fillIn(host, key, schema);
          continue;
        }
        // Not awaited: the save is done, and the table shows its first rows while this runs.
        setProgress(({ [key]: _old, ...rest }) => rest);
        void firstRows(dirOf(key), FIRST_ROWS).then((first) => setFirst((f) => ({ ...f, [key]: computeRows(schema, first).rows })), () => {});
        void host
          .build(tableNameOf(key), dirOf(key), (done, total) => setProgress((p) => ({ ...p, [key]: { done, total } })))
          .then(
            (count) => {
              madeFor.current.set(key, schema);
              latest.current.dispatch({ type: "indexed", key, count });
              setMade((m) => ({ ...m, [key]: "ready" }));
              setTimeout(() => fillIn(host, key, schema), 1500);
            },
            (error: unknown) => latest.current.tell("Couldn't read this table again", error instanceof Error ? error.message : String(error)),
          );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const tables = useRef(state.tables);
  tables.current = state.tables;
  const everyRow = useCallback(async (key: string): Promise<Row[]> => {
    const host = hosts.current.get(bundleOf(key));
    const table = tables.current[key];
    const all = host && table ? await queryIndex(host, { name: tableNameOf(key), schema: table.schema }) : null;
    if (!all) throw new Error(`${tableNameOf(key)} isn't ready to read`);
    return all.rows(0, all.count);
  }, []);

  // The rows read so far, as a source the table view can scroll through: the
  // first ones are here already, the rest are asked of the index's host, which
  // sees what its build has put in. One snapshot that only grows, so what the
  // view has read of it stays good. Kept past the end of the reading until the
  // view's own rows have arrived, so nothing blanks between the two.
  const firstHere = first[state.active];
  const stillReading = !!active?.indexed && (!ready || source?.key !== state.active);
  const readSoFar =
    active?.indexed && stillReading && firstHere
      ? ready
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
      return (await hostOf(bundleOf(key))?.peek(tableNameOf(key), from, to)) ?? [];
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

  return {
    everyRow,
    building: active?.indexed && !ready ? (progress[state.active] ?? { done: 0, total: 0 }) : null,
    reading,
    source: ready && source?.key === state.active ? source.rows : undefined,
    save,
    closeBundle,
  };
}
