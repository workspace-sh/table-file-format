// Tables held in their bundle's index (SPEC section 8), for an app on Node:
// the Linux table app, and a .table opened or embedded in a document. The
// hook is table-app's, the same as every other app's; what's here is where
// a bundle's database comes from. Each bundle with a large table gets an
// index host (a worker over node:sqlite) in its own folder, whose methods
// take the table's folder where the shared hook's database takes its schema;
// a table's first rows are read from its file while its index is made; a
// save of its rows packs a single file back up (singleFile.ts); and a table
// whose index can't be made is read from its file into memory instead.

import { bundleOf, settled, tableNameOf, type AppAction, type AppState, type HeldRows } from "@workspace.sh/table-app";
import { useIndexedTables as useSharedIndexedTables, type IndexedTables as SharedIndexedTables, type IndexedTablesDatabase } from "@workspace.sh/table-app/react";
import { computeRows } from "@workspace.sh/table-core";
import { firstRows, packSingleFile, type IndexHost } from "@workspace.sh/table-app/node";
import { readTable } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import type { ParsedTable, Row, View } from "@workspace.sh/table-core";
import { useCallback, useRef } from "react";

/** Rows shown from the head of the file while a table's index is made. */
const FIRST_ROWS = 200;

export interface IndexedTables extends Pick<SharedIndexedTables, "building" | "reading" | "source" | "closeBundle"> {
  /** After a bundle's other files are written: its indexed tables' rows, and their indexes said fresh. */
  save(bundles: string[], tables: Record<string, ParsedTable>): Promise<void>;
  /** Every row of an indexed table, in file order: for what needs the whole table at once, like an archive. */
  everyRow(key: string): Promise<Row[]>;
}

/** A bundle's node:sqlite host, as the shared hook asks of a database. */
function nodeDatabase(host: IndexHost, bundleDir: string): IndexedTablesDatabase {
  const dirOf = (name: string) => `${bundleDir}/tables/${name}`;
  return {
    ensure: (name, _schema, onProgress) => host.ensure(name, dirOf(name), onProgress),
    build: (name, _schema, onProgress) => host.build(name, dirOf(name), onProgress),
    async save(name, _schema, rows, omit, whole) {
      const saved = await host.save(name, dirOf(name), rows, omit, whole);
      // A single file's rows are in its working folder: packed back into the file.
      if (saved && rows) await packSingleFile(dirOf(name));
      return saved;
    },
    peek: (name, start, end) => host.peek(name, start, end),
    rows: (request) => host.rows(request),
    search: (name) => host.search(name),
    alter: (name, from, to, options) => host.alter(name, from, to, options),
    fill: (name, schema) => host.fill(name, schema),
    // With their formulas worked out, as the rows in the index are.
    firstRows: async (name, schema) => computeRows(schema, await firstRows(dirOf(name), FIRST_ROWS)).rows,
    async heldRows(name): Promise<HeldRows> {
      // Read from its own file, which is always here: never null, and it throws when it can't be read.
      const table = await readTable(nodeFs, dirOf(name));
      return { rows: table.rows, cells: table.cells, rowFiles: table.rowFiles ?? [], unread: table.unread ?? [], diagnostics: table.diagnostics ?? [] };
    },
    // Once whatever was being written to its folder is written.
    close: () => settled(bundleDir).then(() => host.close()),
  };
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
  const latest = useRef({ pathOf, openIndex });
  latest.current = { pathOf, openIndex };
  const openIndexDatabase = useCallback((bundle: string) => {
    const path = latest.current.pathOf(bundle);
    return path ? nodeDatabase(latest.current.openIndex(path), path) : undefined;
  }, []);
  const shared = useSharedIndexedTables({ state, dispatch, view, tell, openIndexDatabase, closeUnheld: true });

  const sharedSave = shared.save;
  const save = useCallback(
    async (bundles: string[], tables: Record<string, ParsedTable>) => {
      await sharedSave(Object.fromEntries(Object.entries(tables).filter(([key]) => bundles.includes(bundleOf(key)))));
    },
    [sharedSave],
  );
  const tables = useRef(state.tables);
  tables.current = state.tables;
  const sharedEveryRow = shared.everyRow;
  const everyRow = useCallback(
    (key: string) => {
      const table = tables.current[key];
      if (!table?.indexed) return Promise.reject(new Error(`${tableNameOf(key)} isn't ready to read`));
      return sharedEveryRow(key, table);
    },
    [sharedEveryRow],
  );
  return { building: shared.building, reading: shared.reading, source: shared.source, closeBundle: shared.closeBundle, save, everyRow };
}
