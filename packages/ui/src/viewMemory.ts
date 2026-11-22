// What a reader was last looking at, kept on this device and never in a
// `.table/`: which view of a table, and a calendar's range. A browser keeps it
// in local storage; a native app hands over its own store (setViewMemory).

import { createContext, useSyncExternalStore } from "react";

export interface ViewMemory {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

const held = new Map<string, string>();

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let memory: ViewMemory = {
  get(key) {
    try {
      return browserStorage()?.getItem(key) ?? held.get(key);
    } catch {
      return held.get(key);
    }
  },
  set(key, value) {
    held.set(key, value);
    try {
      browserStorage()?.setItem(key, value);
    } catch {
      // Private browsing, or full: remembered until the page closes.
    }
  },
};

/** The app's own store for what's remembered. Set once, at startup. */
export function setViewMemory(store: ViewMemory): void {
  memory = store;
}

export function remembered(key: string): string | undefined {
  return memory.get(key);
}

export function remember(key: string, value: string): void {
  memory.set(key, value);
}

/** Where a table's last view is kept, by the folder it's in. */
export function tableViewKey(place: string): string {
  return `table-view:${place}`;
}

/** Where a calendar view's range is kept: its id is unique to it. */
export function calendarRangeKey(viewId: string): string {
  return `table-calendar-range:${viewId}`;
}

export type CalendarRangeName = "month" | "week" | "agenda";

const rangeWatchers = new Set<() => void>();

/** A calendar view's range, as last chosen on this device. */
export function calendarRange(viewId: string): CalendarRangeName {
  const kept = remembered(calendarRangeKey(viewId));
  return kept === "week" || kept === "agenda" ? kept : "month";
}

/** Choose a calendar view's range, from the view or from a host's own control. */
export function setCalendarRange(viewId: string, range: CalendarRangeName): void {
  remember(calendarRangeKey(viewId), range);
  for (const watcher of rangeWatchers) watcher();
}

function watchRanges(watcher: () => void): () => void {
  rangeWatchers.add(watcher);
  return () => void rangeWatchers.delete(watcher);
}

/** A calendar view's range, following it as it changes. Undefined for no calendar. */
export function useCalendarRange(viewId: string | undefined): CalendarRangeName | undefined {
  const read = () => (viewId === undefined ? undefined : calendarRange(viewId));
  return useSyncExternalStore(watchRanges, read, read);
}

/** True where the host draws the range itself (a phone's bottom bar), so the view doesn't. */
export const CalendarRangeInBar = createContext(false);
