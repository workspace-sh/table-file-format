// Where the macOS app keeps edits between launches: AsyncStorage (SQLite on
// macOS), under the same keys the web keeps in localStorage.
//
// table-app's savers read and write synchronously (a KeyValueStore, like
// localStorage), and AsyncStorage answers later. So the keys the app uses
// are read once at launch into memory; reads come from there, and each
// write updates memory at once and goes to disk after, in order.

import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "@workspace.sh/table-app";

const storage = createAsyncStorage("table-desktop");

export async function openStore(keys: readonly string[]): Promise<KeyValueStore> {
  const held = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      const value = await storage.getItem(key);
      if (value !== null) held.set(key, value);
    }),
  );
  // One write after another, so the last edit is the one that stays.
  let writes: Promise<unknown> = Promise.resolve();
  const later = (write: () => Promise<unknown>) => {
    writes = writes.then(write).catch(() => {
      // Full or refused: the edit still stands on screen; it just won't
      // survive a relaunch, as on the web.
    });
  };
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
      later(() => storage.setItem(key, value));
    },
    removeItem: (key) => {
      held.delete(key);
      later(() => storage.removeItem(key));
    },
  };
}
