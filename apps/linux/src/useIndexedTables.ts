// Tables held in their bundle's index (SPEC section 8): the Linux app's
// side of it. Each bundle with a large table gets an index host (a worker
// over node:sqlite); a table's index is made fresh when it opens, with its
// progress shown; the view on screen reads its rows from it; queued edits
// are made in it; and a save writes its rows back to rows.ndjson.

import { bundleOf, remoteEdits, remoteViewRows, tableNameOf, type AppAction, type AppState, type IndexWork, type RemoteViewRows } from "@workspace.sh/table-app";
import { queryIndex } from "@workspace.sh/table-core";
import { firstRows, type IndexHost } from "@workspace.sh/table-app/node";
import { readTable } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import type { ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
import { useCallback, useEffect, useRef, useState } from "react";

/** What of a schema an index is made for: its fields' names and types, and their formulas, whose results it holds. */
const indexedFor = (schema: TableSchema) => JSON.stringify(schema.fields.map((f) => [f.name, f.type, f.computed ?? null]));

/** Rows shown from the head of the file while a table's index is made. */
const FIRST_ROWS = 200;

export interface IndexedTables {
  /** The table on screen is held in the index, and its index is being made: how far along. */
  building: { done: number; total: number } | null;
  /** While it's being made: the table's first rows as its file has them, to show meanwhile. */
  firstRows: Row[] | undefined;
  /** The view on screen's rows, once read; undefined for a table in memory, or while they're on their way. */
  source: ViewRows | undefined;
  /** After a bundle's other files are written: its indexed tables' rows, and their indexes said fresh. */
  save(bundles: string[], tables: Record<string, ParsedTable>): Promise<void>;
  /** Every row of an indexed table, in file order: for what needs the whole table at once, like an archive. */
  everyRow(key: string): Promise<Row[]>;
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
        (rows) => setFirst((was) => ({ ...was, [key]: rows })),
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
            setFirst(({ [key]: _shown, ...rest }) => rest);
            // The search's own index is made after the view has its first rows, behind whatever the window asks for.
            setTimeout(() => void host.search(tableNameOf(key)).catch(() => {}), 1500);
          },
          async (error: unknown) => {
            // No index to be had (no space, no SQLite): the table is held in memory instead, and says so.
            const table = await readTable(nodeFs, dirOf(key));
            latest.current.dispatch({ type: "reloaded", key, table });
            latest.current.tell(
              "Opened without its index",
              `${tableNameOf(key)} is large, and its index couldn't be made (${error instanceof Error ? error.message : String(error)}). It's held in memory instead, and may be slow.`,
            );
          },
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tables]);

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
      const count = await remoteEdits(host.rows, tableNameOf(first.key), table, work);
      // The table on screen: its next snapshot is opened here, with the rows it is
      // showing read ahead, so the edit shows in one draw and not after three.
      const shown = shownNow.current;
      if (first.key !== state.active || !shown.source || shown.source.key !== first.key) return { count, then: undefined };
      const version = (table.indexed?.version ?? 0) + 1;
      const rows = await remoteViewRows(host.rows, tableNameOf(first.key), { ...table, indexed: { count, version } }, shown.view, shown.search);
      await rows.readAhead(shown.source.rows.recent());
      return { count, then: { key: first.key, asked: shown.askingOf(version), rows } };
    })()
      .then(
        ({ count, then }) => {
          if (work.some((w) => w.kind !== "body")) unsaved.current.add(first.key);
          latest.current.dispatch({ type: "indexed", key: first.key, count, done: work.at(-1)!.n });
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
        const gone = was ? was.fields.filter((f) => !table.schema.fields.some((g) => g.name === f.name)).map((f) => f.name) : [];
        const rows = unsaved.current.has(key) || gone.length > 0;
        unsaved.current.delete(key);
        try {
          await host.save(tableNameOf(key), dirOf(key), rows, gone);
        } catch (error) {
          if (rows) unsaved.current.add(key);
          throw error;
        }
        if (!was || indexedFor(was) === indexedFor(table.schema)) {
          madeFor.current.set(key, table.schema);
          continue;
        }
        // Not awaited: the save is done, and the table shows its first rows while this runs.
        setMade((m) => ({ ...m, [key]: "building" }));
        setProgress(({ [key]: _old, ...rest }) => rest);
        void firstRows(dirOf(key), FIRST_ROWS).then((first) => setFirst((f) => ({ ...f, [key]: first })), () => {});
        const schema = table.schema;
        void host
          .build(tableNameOf(key), dirOf(key), (done, total) => setProgress((p) => ({ ...p, [key]: { done, total } })))
          .then(
            (count) => {
              madeFor.current.set(key, schema);
              latest.current.dispatch({ type: "indexed", key, count });
              setMade((m) => ({ ...m, [key]: "ready" }));
              setFirst(({ [key]: _shown, ...rest }) => rest);
              setTimeout(() => void host.search(tableNameOf(key)).catch(() => {}), 1500);
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

  return {
    everyRow,
    building: active?.indexed && !ready ? (progress[state.active] ?? { done: 0, total: 0 }) : null,
    firstRows: active?.indexed && !ready ? first[state.active] : undefined,
    source: ready && source?.key === state.active ? source.rows : undefined,
    save,
  };
}
