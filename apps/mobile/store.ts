// Where the phone keeps edits and the viewer's settings between launches:
// AsyncStorage, under the same keys the web keeps in localStorage and the
// Mac in its own store. It works in Expo Go as well as in a development
// build.
//
// table-app's savers read and write synchronously (a KeyValueStore, like
// localStorage), and AsyncStorage answers later. So the keys the app uses
// are read once at launch into memory; reads come from there, and each
// write updates memory at once and goes to disk after, in order.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "@workspace.sh/table-app";

export async function openStore(keys: readonly string[]): Promise<KeyValueStore> {
  const held = new Map<string, string>();
  for (const [key, value] of await AsyncStorage.multiGet(keys)) if (value !== null) held.set(key, value);
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
      later(() => AsyncStorage.setItem(key, value));
    },
    removeItem: (key) => {
      held.delete(key);
      later(() => AsyncStorage.removeItem(key));
    },
  };
}
