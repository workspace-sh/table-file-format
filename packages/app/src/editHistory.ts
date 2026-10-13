// A table's edit history (SPEC section 14, D44) where an app keeps it:
// `history.ndjson` in the table's folder for a bundle that is a folder, or
// beside the table in the app's store for one kept there (the demo's
// tables on the web, a phone, the Mac). Only ever added to.

import { HISTORY_FILE, serializeEditEvents, type EditEvent, type ParsedTable } from "@workspace.sh/table-core";
import { joinPath, type TableFs } from "@workspace.sh/table-core/io";
import type { KeyValueStore } from "./savedTables.ts";

/** Where the store keeps every stored table's history: one entry, `bundle/table` to its NDJSON. */
export const HISTORY_KEY = "table-demo:history";

/** `text` followed by `events` as NDJSON, given a line end first when it has none. */
function appended(text: string, events: readonly EditEvent[]): string {
  return text + (text.length > 0 && !text.endsWith("\n") ? "\n" : "") + serializeEditEvents(events);
}

/**
 * Append events to `history.ndjson` in a table's folder (`tableDir`), by
 * core's TableFs: what is there is kept, and given a line end first when it
 * has none.
 */
export async function appendFolderHistory(fs: TableFs, tableDir: string, events: readonly EditEvent[]): Promise<void> {
  if (events.length === 0) return;
  const path = joinPath(tableDir, HISTORY_FILE);
  await fs.writeText(path, appended((await fs.readText(path)) ?? "", events));
}

/** Every stored table's history, by `bundle/table` key. */
function storedHistories(store: KeyValueStore): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(HISTORY_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Append events to a stored table's history, kept in the store beside it. */
export function appendStoredHistory(store: KeyValueStore, key: string, events: readonly EditEvent[]): void {
  if (events.length === 0) return;
  const all = storedHistories(store);
  all[key] = appended(all[key] ?? "", events);
  store.setItem(HISTORY_KEY, JSON.stringify(all));
}

/** A stored table's history as NDJSON: "" when it has none. */
export function storedHistory(store: KeyValueStore, key: string): string {
  return storedHistories(store)[key] ?? "";
}

/** Forget every stored table's history, as Reset Demo Data forgets the tables. */
export function clearStoredHistory(store: KeyValueStore | null): void {
  try {
    store?.removeItem(HISTORY_KEY);
  } catch {
    // Nothing kept to forget.
  }
}

// -- A history and an archive: a `.table.zip` carries each table's history as it is (SPEC section 13) ----

/**
 * An app's tables with each one's edit history put in, ready for an
 * archive (`bundleToArchive`, `writeTableArchive`). `historyOf` gives a
 * table's history as NDJSON from where the app keeps it: its folder's
 * `history.ndjson`, or `storedHistory`. None ("" or undefined) and the
 * table goes out without one. What a table holds from an archive it was
 * opened from (`ParsedTable.history`) is not what goes out: the app's own
 * copy has what was added since.
 */
export async function withHistories(
  tables: Record<string, ParsedTable>,
  historyOf: (key: string) => string | undefined | Promise<string | undefined>,
): Promise<Record<string, ParsedTable>> {
  const out: Record<string, ParsedTable> = {};
  for (const [key, table] of Object.entries(tables)) {
    const { history: _arrived, ...rest } = table;
    const history = await historyOf(key);
    out[key] = history ? { ...rest, history } : rest;
  }
  return out;
}

/**
 * For an app that keeps histories in its store: the histories that came
 * with tables just opened from an archive (`ParsedTable.history`), kept
 * there, and the tables to hold without them. A table the store already
 * has a history for keeps that one: it is the app's own, and an archive
 * doesn't replace it. (An app that keeps a table as a folder needs none of
 * this: the directory writer puts an arrived history in the folder once.)
 */
export function keepArrivedHistories(store: KeyValueStore | null, tables: Record<string, ParsedTable>): Record<string, ParsedTable> {
  const arrived = Object.entries(tables).filter(([, table]) => table.history);
  if (arrived.length === 0) return tables;
  if (store) {
    const all = storedHistories(store);
    let changed = false;
    for (const [key, table] of arrived) {
      if (all[key]) continue;
      all[key] = table.history!;
      changed = true;
    }
    if (changed) store.setItem(HISTORY_KEY, JSON.stringify(all));
  }
  return Object.fromEntries(
    Object.entries(tables).map(([key, table]) => {
      if (!table.history) return [key, table];
      const { history: _kept, ...rest } = table;
      return [key, rest];
    }),
  );
}

