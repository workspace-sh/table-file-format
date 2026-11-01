// The example files the viewer closed, kept with their settings: closing
// one removes the app's copy of it, and the next launch would copy the
// example back if it weren't told not to. Reset Demo Data empties the list.

import type { KeyValueStore } from "@workspace.sh/table-app";

const CLOSED_KEY = "table-demo:closed";

/** The files closed before, by their name without `.table`. Nothing kept, or junk, is none. */
export function loadClosed(store: KeyValueStore | null): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(CLOSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === "string") : [];
  } catch {
    return [];
  }
}

export function saveClosed(store: KeyValueStore | null, closed: readonly string[]): void {
  if (!store) return;
  if (closed.length === 0) {
    if (store.getItem(CLOSED_KEY) !== null) store.removeItem(CLOSED_KEY);
    return;
  }
  const text = JSON.stringify(closed);
  if (store.getItem(CLOSED_KEY) !== text) store.setItem(CLOSED_KEY, text);
}
