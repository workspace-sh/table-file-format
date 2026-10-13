// A table's edit history (SPEC section 14, D44) where an app keeps it:
// `history.ndjson` in the table's folder for a bundle that is a folder, or
// beside the table in the app's store for one kept there (the demo's
// tables on the web, a phone, the Mac). Only ever added to.

import { HISTORY_FILE, serializeEditEvents, type EditEvent } from "@workspace.sh/table-core";
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
