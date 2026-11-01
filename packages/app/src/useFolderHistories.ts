// The histories of tables kept in folders (SPEC section 14), held in
// memory so the Files side can list and show them as it draws: an app on a
// phone or the Mac reads its files only asynchronously. Each is read when
// its table is first held, and again when the app has added to it.

import { useCallback, useEffect, useRef, useState } from "react";

export interface FolderHistories {
  /** A folder table's history as read, by `bundle/table` key: absent until read, "" when it has none. */
  texts: Record<string, string>;
  /** Read a table's history again, after the app has added to it. */
  reread: (key: string) => void;
}

/**
 * `keys`: the tables kept in folders; `read`: a table's history from its
 * folder, undefined when it has none.
 */
export function useFolderHistories(keys: readonly string[], read: (key: string) => Promise<string | undefined>): FolderHistories {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const reader = useRef(read);
  reader.current = read;
  const load = useCallback((key: string) => {
    void reader.current(key).then(
      (text) => setTexts((was) => (was[key] === (text ?? "") ? was : { ...was, [key]: text ?? "" })),
      () => {},
    );
  }, []);
  const asked = useRef(new Set<string>());
  const joined = keys.join("\n");
  useEffect(() => {
    for (const key of keys) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      load(key);
    }
    // `joined` stands for `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, load]);
  return { texts, reread: load };
}
