// .table folders opened from disk: read with core's reader, written back
// with core's writer (atomic per file, SPEC section 1), through desktopFs.
//
// An opened folder's tables join the app's tables under their own bundle
// key (a clash with one already held gets `-2`, from openLibrary). Each
// edit to them is written back to the folder when useTableApp writes, one
// write at a time per folder. The folders' paths are remembered, and they're opened
// again at launch; their tables aren't kept in the app's own store, since
// the folder is where they live.

import { useCallback, useEffect, useRef } from "react";
import type { BundleMeta, ParsedTable } from "@workspace.sh/table-core";
import { bundleTables, openLibrary, writeLibraryBundle, type KeyValueStore, type Library } from "@workspace.sh/table-app";
import { desktopFs } from "./desktopFs";

export const OPENED_KEY = "table-desktop:opened";

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
  /** Write these opened folders' bundles, one write at a time per folder. Rejects with the first that couldn't be written, named. */
  write: (keys: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => Promise<void>;
}

/**
 * The opened folders (`paths`, table-app's `opened`): remembered for next
 * launch, and written back when useTableApp says their bundles are edited.
 */
export function useFolders({
  store,
  bundles,
  paths,
}: {
  store: KeyValueStore | null;
  bundles: Record<string, BundleMeta>;
  /** Each opened folder's path, by bundle key. */
  paths: Record<string, string>;
}): Folders {
  // The latest of each, for writes and opens that finish later.
  const latest = useRef({ bundles, paths });
  latest.current = { bundles, paths };
  const queues = useRef<Record<string, Promise<void>>>({});

  const open = useCallback(async (wanted: string[]) => {
    const already = new Set(Object.values(latest.current.paths));
    return openLibrary(desktopFs, wanted.filter((p) => !already.has(p)), Object.keys(latest.current.bundles));
  }, []);

  const write = useCallback(
    async (keys: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => {
      const library: Library = { tables: {}, bundles: {}, paths: latest.current.paths, problems: {} };
      await Promise.all(
        keys.map((key) => {
          const next = (queues.current[key] ?? Promise.resolve())
            .catch(() => {})
            .then(() => writeLibraryBundle(desktopFs, library, tables, metas, key))
            .catch((error: unknown) => {
              // Shown by the app, from useTableApp's `saving`, with Try Again.
              throw new Error(`${key}.table: ${error instanceof Error ? error.message : String(error)}`);
            });
          queues.current[key] = next;
          return next;
        }),
      );
    },
    [],
  );

  useEffect(() => {
    try {
      store?.setItem(OPENED_KEY, JSON.stringify(Object.values(paths)));
    } catch {
      // Full or refused: the folders just won't reopen next launch.
    }
  }, [store, paths]);

  return { open, write };
}
