// What a reader was last looking at, kept on this device and never in a
// `.table/`: which view of a table, and a calendar's range. A browser keeps it
// in local storage; a native app hands over its own store (setViewMemory).

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
