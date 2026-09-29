// .table folders opened from disk: read with core's reader, written back
// with core's writer (atomic per file, SPEC section 1), through desktopFs.
//
// An opened folder's tables join the app's tables under their own bundle
// key (a clash with one already held gets `-2`, from openLibrary). Each
// edit to them is written back to the folder shortly after, one write at a
// time per folder. The folders' paths are remembered, and they're opened
// again at launch; their tables aren't kept in the app's own store, since
// the folder is where they live.

import { useCallback, useEffect, useRef, useState } from "react";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundleTables, openLibrary, writeLibraryBundle, type KeyValueStore, type Library } from "@workspace.sh/table-app";
import { desktopFs } from "./desktopFs";

export const OPENED_KEY = "table-desktop:opened";

/** How long after the last edit a folder is written, so typing isn't a write a key. */
const WRITE_AFTER_MS = 400;

export interface Folders {
  /** Each opened folder's path, by bundle key. */
  paths: Record<string, string>;
  /** Open these folders, beside what's held. Resolves with what was read. */
  open: (paths: string[]) => Promise<Library>;
}

export function useFolders({
  store,
  tables,
  setTables,
  bundles,
  setBundles,
  onProblem,
}: {
  store: KeyValueStore | null;
  tables: Record<string, ParsedTable>;
  setTables: (update: (all: Record<string, ParsedTable>) => Record<string, ParsedTable>) => void;
  bundles: Record<string, BundleMeta>;
  setBundles: (update: (all: Record<string, BundleMeta>) => Record<string, BundleMeta>) => void;
  /** A folder that couldn't be read or written, and why. */
  onProblem: (title: string, message: string) => void;
}): Folders {
  const [paths, setPaths] = useState<Record<string, string>>({});
  // The latest of each, for writes and opens that finish later.
  const latest = useRef({ tables, bundles, paths });
  latest.current = { tables, bundles, paths };
  // Each folder's tables as last read or written, so only a change is written.
  const written = useRef<Record<string, Record<string, ParsedTable>>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queues = useRef<Record<string, Promise<void>>>({});
  // The remembered paths are only rewritten once the ones from last time
  // have been opened again, or an early empty list would forget them.
  const [reopened, setReopened] = useState(false);

  const open = useCallback(
    async (wanted: string[]) => {
      const already = new Set(Object.values(latest.current.paths));
      const fresh = wanted.filter((p) => !already.has(p));
      const library = await openLibrary(desktopFs, fresh, Object.keys(latest.current.bundles));
      for (const key of Object.keys(library.paths)) written.current[key] = bundleTables(library.tables, key);
      setTables((all) => ({ ...all, ...library.tables }));
      setBundles((all) => ({ ...all, ...library.bundles }));
      setPaths((all) => ({ ...all, ...library.paths }));
      return library;
    },
    [setTables, setBundles],
  );

  // Opened again at launch, from where they were last time.
  useEffect(() => {
    let remembered: string[] = [];
    try {
      const raw = store?.getItem(OPENED_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) remembered = parsed.filter((p): p is string => typeof p === "string");
    } catch {
      // Unreadable: start with none.
    }
    open(remembered)
      .then((library) => {
        for (const [key, messages] of Object.entries(library.problems))
          onProblem(`Problems reading ${key}.table`, messages.join("\n"));
      })
      .finally(() => setReopened(true));
    // Once, at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!reopened) return;
    try {
      store?.setItem(OPENED_KEY, JSON.stringify(Object.values(paths)));
    } catch {
      // Full or refused: the folders just won't reopen next launch.
    }
  }, [store, paths, reopened]);

  // Written back after an edit: each opened folder whose tables changed.
  useEffect(() => {
    for (const key of Object.keys(paths)) {
      const now = bundleTables(tables, key);
      const before = written.current[key] ?? {};
      const changed =
        Object.keys(now).length !== Object.keys(before).length || Object.keys(now).some((t) => now[t] !== before[t]);
      if (!changed) continue;
      written.current[key] = now;
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        const { tables: all, bundles: metas, paths: where } = latest.current;
        const library: Library = { tables: {}, bundles: {}, paths: where, problems: {} };
        queues.current[key] = (queues.current[key] ?? Promise.resolve())
          .then(() => writeLibraryBundle(desktopFs, library, all, metas, key))
          .catch((error: unknown) =>
            onProblem(`Couldn't save ${key}.table`, error instanceof Error ? error.message : String(error)),
          );
      }, WRITE_AFTER_MS);
    }
  }, [tables, paths, onProblem]);

  return { paths, open };
}
