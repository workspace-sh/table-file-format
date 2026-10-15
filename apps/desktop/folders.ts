// .table documents opened from disk: read with core's reader, written back
// with core's writer (atomic per file, SPEC section 1), through desktopFs.
//
// A .table is a folder or a single file (SPEC section 13, D49), told apart
// by what is on disk. A folder is read and written where it is. A single
// file is edited the way Numbers edits one (table-app's singleFile):
// unpacked into a working folder in this Mac's own storage, edited there as
// any folder, and packed back into the file after each write.
//
// An opened document's tables join the app's tables under their own bundle
// key (a clash with one already held gets `-2`, from openLibrary). Each
// edit to them is written back when useTableApp writes, one write at a time
// per document. The documents' paths are remembered, and they're opened
// again at launch; their tables aren't kept in the app's own store, since
// the document is where they live.

import { useCallback, useEffect, useRef } from "react";
import { Dirs, FileSystem } from "react-native-file-access";
import { tableFormOf, type BundleMeta, type ParsedTable } from "@workspace.sh/table-core";
import { joinPath } from "@workspace.sh/table-core/io";
import {
  openLibrary,
  packTableFile,
  restampTableFile,
  unpackTableFile,
  workDirFor,
  writeLibraryBundle,
  type KeyValueStore,
  type Library,
} from "@workspace.sh/table-app";
import { desktopFs } from "./desktopFs";

export const OPENED_KEY = "table-desktop:opened";

/** Where single files' working folders are kept: this Mac's own, beside the large tables' folders. */
const singleFilesHome = (): string => joinPath(Dirs.LibraryDir ?? Dirs.DocumentDir, "Application Support", "sh.workspace.table.desktop", "single-files");

/** A single file as it is now on disk, to tell whether its working folder was made from it. */
async function stampOf(path: string): Promise<string> {
  const stat = await FileSystem.stat(path);
  return `${stat.size}:${stat.lastModified}`;
}

/** Read documents, and which single file each working folder among them stands for. */
export interface OpenedDocuments {
  library: Library;
  /** Each single file, by its working folder. */
  documents: Map<string, string>;
}

/**
 * Read these documents (folders or single files), named apart from `held`.
 * A single file is unpacked into its working folder first, which is kept as
 * it is when it was made from the file as it is now (its index with it). A
 * document that can't be read is a problem, under its name.
 */
async function openDocuments(paths: string[], held: Iterable<string>): Promise<OpenedDocuments> {
  const folders: string[] = [];
  const documents = new Map<string, string>();
  const problems: Record<string, string[]> = {};
  for (const path of paths) {
    try {
      if ((await tableFormOf(desktopFs, path)) !== "file") {
        folders.push(path);
        continue;
      }
      const workDir = workDirFor(singleFilesHome(), path);
      const bytes = await desktopFs.readBytes!(path);
      if (!bytes) throw new Error("it isn't there");
      await unpackTableFile(desktopFs, bytes, workDir, await stampOf(path));
      folders.push(workDir);
      documents.set(workDir, path);
    } catch (error) {
      const name = (path.split("/").pop() ?? path).replace(/\.table$/i, "");
      problems[name] = [error instanceof Error ? error.message : String(error)];
    }
  }
  const library = await openLibrary(desktopFs, folders, held);
  Object.assign(library.problems, problems);
  // Which bundles are single files, and where each file is (table-app's Library.singleFiles):
  // Export as a Single File is for folders only.
  const singleFiles = Object.fromEntries(Object.entries(library.paths).flatMap(([key, folder]) => (documents.has(folder) ? [[key, documents.get(folder)!]] : [])));
  if (Object.keys(singleFiles).length > 0) library.singleFiles = singleFiles;
  return { library, documents };
}

/** The documents opened last time, read again: what the app starts with, beside the fixtures. */
export async function reopenFolders(store: KeyValueStore | null, held: Iterable<string>): Promise<OpenedDocuments> {
  let remembered: string[] = [];
  try {
    const raw = store?.getItem(OPENED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) remembered = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // Unreadable: start with none.
  }
  return openDocuments(remembered, held);
}

export interface Folders {
  /** Read these documents (folders or single files), named apart from what's held; the app takes in what comes back. */
  open: (paths: string[]) => Promise<Library>;
  /** Write these opened documents' bundles, one write at a time per document. Rejects with the first that couldn't be written, named. */
  write: (keys: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => Promise<void>;
  /** The document an opened bundle's folder stands for: the single file for its working folder, else the folder itself. */
  documentOf: (folder: string) => string;
  /**
   * Pack these opened bundles' working folders back into their single files, after anything
   * else wrote to them (a history appended, a large table's rows saved). Nothing for a folder.
   */
  pack: (bundles: string[]) => Promise<void>;
}

/**
 * The opened documents (`paths`, table-app's `opened`: each bundle's
 * folder, a single file's working folder for one): remembered for next
 * launch by the documents' own paths, and written back when useTableApp
 * says their bundles are edited, a single file packed again after its
 * folder is.
 */
export function useFolders({
  store,
  bundles,
  paths,
  documents: reopened,
}: {
  store: KeyValueStore | null;
  bundles: Record<string, BundleMeta>;
  /** Each opened document's folder, by bundle key. */
  paths: Record<string, string>;
  /** The single files reopened at launch, by working folder. */
  documents?: Map<string, string>;
}): Folders {
  // The latest of each, for writes and opens that finish later.
  const latest = useRef({ bundles, paths });
  latest.current = { bundles, paths };
  const queues = useRef<Record<string, Promise<void>>>({});
  // Each working folder's single file.
  const documents = useRef(new Map(reopened ?? []));

  const documentOf = useCallback((folder: string) => documents.current.get(folder) ?? folder, []);

  // One pack at a time per single file. Asked again while one runs, it runs once more after,
  // and everyone asking meanwhile waits for that last one.
  const packing = useRef<Record<string, { done: Promise<void>; again: boolean }>>({});
  const packOne = useCallback((bundle: string): Promise<void> => {
    const workDir = latest.current.paths[bundle];
    const file = workDir ? documents.current.get(workDir) : undefined;
    if (!workDir || !file) return Promise.resolve();
    const running = packing.current[file];
    if (running) {
      running.again = true;
      return running.done;
    }
    const entry = { done: Promise.resolve(), again: false };
    entry.done = (async () => {
      do {
        entry.again = false;
        await packTableFile(desktopFs, workDir, file);
        await restampTableFile(desktopFs, workDir, await stampOf(file));
      } while (entry.again);
    })().finally(() => {
      delete packing.current[file];
    });
    packing.current[file] = entry;
    return entry.done;
  }, []);
  const pack = useCallback(async (keys: string[]) => {
    await Promise.all(keys.map(packOne));
  }, [packOne]);

  const open = useCallback(async (wanted: string[]) => {
    const already = new Set(Object.values(latest.current.paths).map((p) => documents.current.get(p) ?? p));
    const opened = await openDocuments(
      wanted.filter((p) => !already.has(p)),
      Object.keys(latest.current.bundles),
    );
    for (const [workDir, path] of opened.documents) documents.current.set(workDir, path);
    return opened.library;
  }, []);

  const write = useCallback(
    async (keys: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => {
      const library: Library = { tables: {}, bundles: {}, paths: latest.current.paths, problems: {} };
      await Promise.all(
        keys.map((key) => {
          const next = (queues.current[key] ?? Promise.resolve())
            .catch(() => {})
            .then(async () => {
              await writeLibraryBundle(desktopFs, library, tables, metas, key);
              // A single file: its working folder packed back into it.
              await packOne(key);
            })
            .catch((error: unknown) => {
              // Shown by the app, from useTableApp's `saving`, with Try Again.
              throw new Error(`${key}.table: ${error instanceof Error ? error.message : String(error)}`);
            });
          queues.current[key] = next;
          return next;
        }),
      );
    },
    [packOne],
  );

  useEffect(() => {
    try {
      store?.setItem(OPENED_KEY, JSON.stringify(Object.values(paths).map((p) => documents.current.get(p) ?? p)));
    } catch {
      // Full or refused: the documents just won't reopen next launch.
    }
  }, [store, paths]);

  return { open, write, documentOf, pack };
}
