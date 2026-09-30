// .table folders opened from disk: read with core's reader, written back
// with core's writer (atomic per file, SPEC section 1), through desktopFs.
//
// An opened folder's tables join the app's tables under their own bundle
// key (a clash with one already held gets `-2`, from openLibrary). Each
// edit to them is written back to the folder shortly after, one write at a
// time per folder. The folders' paths are remembered, and they're opened
// again at launch; their tables aren't kept in the app's own store, since
// the folder is where they live.

import { useCallback, useEffect, useRef } from "react";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundleTables, openLibrary, writeLibraryBundle, type KeyValueStore, type Library } from "@workspace.sh/table-app";
import { desktopFs } from "./desktopFs";

export const OPENED_KEY = "table-desktop:opened";

/** How long after the last edit a folder is written, so typing isn't a write a key. */
const WRITE_AFTER_MS = 400;

/** The folders opened last time, read again: what the app starts with, beside the fixtures. */
export async function reopenFolders(store: KeyValueStore | null, held: Iterable<string>): Promise<Library> {
  let remembered: string[] = [];
  try {
    const raw = store?.getItem(OPENED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) remembered = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // Unreadable: start with none.
  }
  return openLibrary(desktopFs, remembered, held);
}

export interface Folders {
  /** Read these folders, named apart from what's held; the app takes in what comes back. */
  open: (paths: string[]) => Promise<Library>;
}

/**
 * The opened folders (`paths`, table-app's `opened`): remembered for next
 * launch, and each one's tables written back to it after an edit.
 */
export function useFolders({
  store,
  tables,
  bundles,
  paths,
  onProblem,
}: {
  store: KeyValueStore | null;
  tables: Record<string, ParsedTable>;
  bundles: Record<string, BundleMeta>;
  /** Each opened folder's path, by bundle key. */
  paths: Record<string, string>;
  /** A folder that couldn't be written, and why. */
  onProblem: (title: string, message: string) => void;
}): Folders {
  // The latest of each, for writes and opens that finish later.
  const latest = useRef({ tables, bundles, paths });
  latest.current = { tables, bundles, paths };
  // Each folder's tables as last read or written, so only a change is written.
  const written = useRef<Record<string, Record<string, ParsedTable>>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queues = useRef<Record<string, Promise<void>>>({});

  const open = useCallback(async (wanted: string[]) => {
    const already = new Set(Object.values(latest.current.paths));
    return openLibrary(desktopFs, wanted.filter((p) => !already.has(p)), Object.keys(latest.current.bundles));
  }, []);

  useEffect(() => {
    try {
      store?.setItem(OPENED_KEY, JSON.stringify(Object.values(paths)));
    } catch {
      // Full or refused: the folders just won't reopen next launch.
    }
  }, [store, paths]);

  // Written back after an edit: each opened folder whose tables changed. A
  // folder first seen here is as it was read.
  useEffect(() => {
    for (const key of Object.keys(paths)) {
      const now = bundleTables(tables, key);
      const before = written.current[key];
      written.current[key] = now;
      if (!before) continue;
      const changed =
        Object.keys(now).length !== Object.keys(before).length || Object.keys(now).some((t) => now[t] !== before[t]);
      if (!changed) continue;
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

  return { open };
}
