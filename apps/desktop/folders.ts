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
//
// A single file holding a large table (INDEXED_FROM rows or more) is read
// through the index instead (indexHost.ts): its first rows at once, the
// rest read meanwhile into the index and into the host's folder for it,
// which is then its working folder, packed back into the file like any.

import { useCallback, useEffect, useRef } from "react";
import { Dirs, FileSystem } from "react-native-file-access";
import { tableFormOf, type BundleMeta, type ParsedTable, type Row } from "@workspace.sh/table-core";
import { joinPath } from "@workspace.sh/table-core/io";
import {
  fromBundle,
  holdsLargeTable,
  openLibrary,
  singleFilePacker,
  unpackTableFile,
  workDirFor,
  writeLibraryBundle,
  type KeyValueStore,
  type Library,
} from "@workspace.sh/table-app";
import { desktopFs } from "./desktopFs";
import { bundleDir, openZip, removeFolder, tablesHome } from "./indexHost";

export const OPENED_KEY = "table-desktop:opened";
/** Each large single file's bundle key last time (its folder in the index host's home), by its path. */
export const LARGE_KEY = "table-desktop:large-documents";

/** Where single files' working folders are kept: this Mac's own, beside the large tables' folders. */
const singleFilesHome = (): string => joinPath(Dirs.LibraryDir ?? Dirs.DocumentDir, "Application Support", "sh.workspace.table.desktop", "single-files");

/** A single file as it is now on disk, to tell whether its working folder was made from it. */
async function stampOf(path: string): Promise<string> {
  const stat = await FileSystem.stat(path);
  return `${stat.size}:${stat.lastModified}`;
}

/** The names the index host's folders have: a large single file's bundle is named apart from them, so its folder starts empty. */
async function hostFolders(): Promise<string[]> {
  return ((await desktopFs.list(tablesHome())) ?? []).flatMap((e) => (e.directory && e.name.endsWith(".table") ? [e.name.slice(0, -".table".length)] : []));
}

function largeKeys(store: KeyValueStore | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(LARGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Read documents, and which single file each working folder among them stands for. */
export interface OpenedDocuments {
  library: Library;
  /** A large table's first rows, by table key, to show while the rest is read into the index. */
  first: Record<string, Row[]>;
  /** Each single file, by its working folder. */
  documents: Map<string, string>;
}

/**
 * Read these documents (folders or single files), named apart from `held`.
 * A single file is unpacked into its working folder first, which is kept as
 * it is when it was made from the file as it is now (its index with it). A
 * document that can't be read is a problem, under its name.
 */
async function openDocuments(paths: string[], held: Iterable<string>, store: KeyValueStore | null): Promise<OpenedDocuments> {
  const folders: string[] = [];
  const documents = new Map<string, string>();
  const problems: Record<string, string[]> = {};
  const names = new Set(held);
  const read: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const first: Record<string, Row[]> = {};
  const keys = largeKeys(store);
  for (const path of paths) {
    try {
      if ((await tableFormOf(desktopFs, path)) !== "file") {
        folders.push(path);
        continue;
      }
      const workDir = workDirFor(singleFilesHome(), path);
      const bytes = await desktopFs.readBytes!(path);
      if (!bytes) throw new Error("it isn't there");
      if (await holdsLargeTable(bytes)) {
        // Its folder from last time goes: it's read again from the file, which holds every saved edit.
        if (keys[path]) {
          await removeFolder(keys[path]);
          await desktopFs.remove(`${bundleDir(keys[path])}.stamp`);
        }
        const { opened, first: shown } = await openZip(bytes, [...names, ...(await hostFolders())]);
        if (Object.values(opened.bundle.tables).some((t) => t.indexed)) {
          const dir = bundleDir(opened.key);
          names.add(opened.key);
          Object.assign(read.tables, fromBundle(opened.key, opened.bundle));
          read.bundles[opened.key] = opened.bundle.meta;
          read.paths[opened.key] = dir;
          for (const [table, rows] of Object.entries(shown)) first[`${opened.key}/${table}`] = rows;
          documents.set(dir, path);
          keys[path] = opened.key;
          // What the file was when its folder was made: a save checks it's still that (packTableFile).
          await desktopFs.writeText(`${dir}.stamp`, await stampOf(path));
          continue;
        }
        // Judged large, read as not: unpacked as any.
      }
      await unpackTableFile(desktopFs, bytes, workDir, await stampOf(path));
      folders.push(workDir);
      documents.set(workDir, path);
    } catch (error) {
      const name = (path.split("/").pop() ?? path).replace(/\.table$/i, "");
      problems[name] = [error instanceof Error ? error.message : String(error)];
    }
  }
  const library = await openLibrary(desktopFs, folders, names);
  Object.assign(library.tables, read.tables);
  Object.assign(library.bundles, read.bundles);
  Object.assign(library.paths, read.paths);
  Object.assign(library.problems, problems);
  try {
    store?.setItem(LARGE_KEY, JSON.stringify(keys));
  } catch {
    // Full or refused: next time its old folder is left, and a new one made.
  }
  // Which bundles are single files, and where each file is (table-app's Library.singleFiles):
  // Export as a Single File is for folders only.
  const singleFiles = Object.fromEntries(Object.entries(library.paths).flatMap(([key, folder]) => (documents.has(folder) ? [[key, documents.get(folder)!]] : [])));
  if (Object.keys(singleFiles).length > 0) library.singleFiles = singleFiles;
  return { library, first, documents };
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
  return openDocuments(remembered, held, store);
}

export interface Folders {
  /** Read these documents (folders or single files), named apart from what's held; the app takes in what comes back, and holds the first rows to show. */
  open: (paths: string[]) => Promise<Pick<OpenedDocuments, "library" | "first">>;
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

  // One pack at a time per single file (table-app's singleFilePacker).
  const packer = useRef(singleFilePacker(desktopFs, stampOf));
  const packOne = useCallback((bundle: string): Promise<void> => {
    const workDir = latest.current.paths[bundle];
    const file = workDir ? documents.current.get(workDir) : undefined;
    if (!workDir || !file) return Promise.resolve();
    return packer.current(workDir, file);
  }, []);
  const pack = useCallback(async (keys: string[]) => {
    await Promise.all(keys.map(packOne));
  }, [packOne]);

  const open = useCallback(async (wanted: string[]) => {
    const already = new Set(Object.values(latest.current.paths).map((p) => documents.current.get(p) ?? p));
    const opened = await openDocuments(
      wanted.filter((p) => !already.has(p)),
      Object.keys(latest.current.bundles),
      store,
    );
    for (const [workDir, path] of opened.documents) documents.current.set(workDir, path);
    return { library: opened.library, first: opened.first };
  }, [store]);

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
