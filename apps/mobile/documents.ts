// .table documents opened where they are, chosen in the system's picker:
// read with core's reader, written back with core's writer, through expoFs,
// as the Mac's folders.ts does over its own files.
//
// A .table is a folder or a single file (SPEC section 13, D49), told apart
// by what is on disk. A folder is read and written where it is, under the
// security scope the picker gave it. A single file is edited the way Numbers
// edits one (table-app's singleFile): unpacked into a working folder in the
// phone's own storage, edited there as any folder, and packed back into the
// file after each write. The file itself is only the app's to replace, not
// its folder, so the pack is one coordinated write (@workspace.sh/table-files)
// rather than core's write-beside-and-rename.
//
// The documents are kept for the next launch as bookmarks, and opened again
// then; their tables aren't kept in the app's own store, since the document
// is where they live.
//
// A single file holding a large table (INDEXED_FROM rows or more) is read
// through the index instead (indexHost.ts): its first rows at once, the
// rest read meanwhile into the index and into the host's folder for it,
// which is then its working folder, packed back into the file like any.

import { useCallback, useEffect, useRef } from "react";
import { Directory, File, Paths } from "expo-file-system";
import type { BundleMeta, ParsedTable, Row } from "@workspace.sh/table-core";
import {
  fromBundle,
  holdsLargeTable,
  openLibrary,
  replacingFs,
  singleFilePacker,
  unpackTableFile,
  workDirFor,
  writeLibraryBundle,
  type KeyValueStore,
  type Library,
} from "@workspace.sh/table-app";
import { expoFs, pathOfUri, tablesHome } from "./expoFs";
import { bundleDir, openZip, removeFolder } from "./indexHost";
import { releaseDocument, resolveBookmark, writeCoordinated, type HeldDocument } from "@workspace.sh/table-files";

export const OPENED_KEY = "table-mobile:opened";
/** Each large single file's bundle key last time (its folder in the index host's home), by its URL. */
export const LARGE_KEY = "table-mobile:large-documents";

/** Where single files' working folders are kept: the phone's own, apart from anything else there. */
const singleFilesHome = (): string => new Directory(Paths.document, "single-files").uri.replace(/\/+$/, "");

/** A single file as it is now, to tell whether its working folder was made from it. */
function stampOf(uri: string): string {
  const file = new File(uri);
  return `${file.size}:${file.modificationTime ?? ""}`;
}

/** The names the index host's folders have: a large single file's bundle is named apart from them, so its folder starts empty. */
async function hostFolders(): Promise<string[]> {
  return ((await expoFs.list(tablesHome())) ?? []).flatMap((e) => (e.directory && e.name.endsWith(".table") ? [e.name.slice(0, -".table".length)] : []));
}

function largeKeys(store: KeyValueStore | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(LARGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Read documents, which single file each working folder among them stands for, and each document's bookmark. */
export interface OpenedDocuments {
  library: Library;
  /** A large table's first rows, by table key, to show while the rest is read into the index. */
  first: Record<string, Row[]>;
  /** Each single file (its URL), by its working folder. */
  documents: Map<string, string>;
  /** Each document's bookmark, by its URL. */
  bookmarks: Map<string, string>;
}

/**
 * Read these documents, named apart from `held`. A single file is unpacked
 * into its working folder first, which is kept as it is when it was made
 * from the file as it is now (its index with it); one with a large table is
 * read through the index instead. A document that can't be read is a
 * problem, under its name.
 */
async function openDocuments(held: HeldDocument[], taken: Iterable<string>, store: KeyValueStore | null): Promise<OpenedDocuments> {
  const folders: string[] = [];
  const documents = new Map<string, string>();
  const bookmarks = new Map<string, string>();
  const problems: Record<string, string[]> = {};
  const names = new Set(taken);
  const read: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const first: Record<string, Row[]> = {};
  const keys = largeKeys(store);
  for (const doc of held) {
    const uri = doc.uri.replace(/\/+$/, "");
    bookmarks.set(uri, doc.bookmark);
    try {
      if (doc.directory) {
        folders.push(uri);
        continue;
      }
      const workDir = workDirFor(singleFilesHome(), uri);
      const bytes = await expoFs.readBytes!(uri);
      if (!bytes) throw new Error("it isn't there");
      if (await holdsLargeTable(bytes)) {
        // Its folder from last time goes: it's read again from the file, which holds every saved edit.
        if (keys[uri]) {
          await removeFolder(keys[uri]);
          await expoFs.remove(`${bundleDir(keys[uri])}.stamp`);
        }
        const { opened, first: shown } = await openZip(bytes, [...names, ...(await hostFolders())]);
        if (Object.values(opened.bundle.tables).some((t) => t.indexed)) {
          const dir = bundleDir(opened.key);
          names.add(opened.key);
          Object.assign(read.tables, fromBundle(opened.key, opened.bundle));
          read.bundles[opened.key] = opened.bundle.meta;
          read.paths[opened.key] = dir;
          for (const [table, rows] of Object.entries(shown)) first[`${opened.key}/${table}`] = rows;
          documents.set(dir, uri);
          keys[uri] = opened.key;
          // What the file was when its folder was made: a save checks it's still that (packTableFile).
          await expoFs.writeText(`${dir}.stamp`, stampOf(uri));
          continue;
        }
        // Judged large, read as not: unpacked as any.
      }
      await unpackTableFile(expoFs, bytes, workDir, stampOf(uri));
      folders.push(workDir);
      documents.set(workDir, uri);
    } catch (error) {
      problems[doc.name.replace(/\.table$/i, "")] = [error instanceof Error ? error.message : String(error)];
    }
  }
  const library = await openLibrary(expoFs, folders, names);
  Object.assign(library.tables, read.tables);
  Object.assign(library.bundles, read.bundles);
  Object.assign(library.paths, read.paths);
  Object.assign(library.problems, problems);
  try {
    store?.setItem(LARGE_KEY, JSON.stringify(keys));
  } catch {
    // Full or refused: next time its old folder is left, and a new one made.
  }
  // Which bundles are single files, and where each file is: Export as a Single File is for folders only.
  const singleFiles = Object.fromEntries(Object.entries(library.paths).flatMap(([key, folder]) => (documents.has(folder) ? [[key, documents.get(folder)!]] : [])));
  if (Object.keys(singleFiles).length > 0) library.singleFiles = singleFiles;
  return { library, first, documents, bookmarks };
}

/** The documents opened last time, held open again from their bookmarks and read: what the app starts with, beside the fixtures. */
export async function reopenDocuments(store: KeyValueStore | null, taken: Iterable<string>): Promise<OpenedDocuments> {
  let remembered: string[] = [];
  try {
    const raw = store?.getItem(OPENED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) remembered = parsed.filter((b): b is string => typeof b === "string");
  } catch {
    // Unreadable: start with none.
  }
  const held = remembered.flatMap((bookmark) => {
    const doc = resolveBookmark(bookmark);
    return doc ? [doc] : [];
  });
  return openDocuments(held, taken, store);
}

export interface Documents {
  /** Read these picked documents, named apart from what's held; the app takes in what comes back, and holds the first rows to show. */
  open: (held: HeldDocument[]) => Promise<Pick<OpenedDocuments, "library" | "first">>;
  /** Write these opened documents' bundles, one write at a time per document. Rejects with the first that couldn't be written, named. */
  write: (keys: string[], tables: Record<string, ParsedTable>, metas: Record<string, BundleMeta>) => Promise<void>;
  /** Pack these opened bundles' working folders back into their single files, after anything else wrote to them. Nothing for a folder. */
  pack: (bundles: string[]) => Promise<void>;
  /** The document an opened bundle's folder stands for: the single file for its working folder, else the folder itself. */
  documentOf: (folder: string) => string;
}

/**
 * The opened documents (`paths`, table-app's `opened`: each bundle's folder,
 * a single file's working folder for one): remembered for next launch by
 * their bookmarks, and written back when useTableApp says their bundles are
 * edited, a single file packed again after its folder is.
 */
export function useDocuments({
  store,
  bundles,
  paths,
  reopened,
}: {
  store: KeyValueStore | null;
  bundles: Record<string, BundleMeta>;
  /** Each opened document's folder, by bundle key. */
  paths: Record<string, string>;
  /** What was opened again at launch. */
  reopened?: Pick<OpenedDocuments, "documents" | "bookmarks">;
}): Documents {
  // The latest of each, for writes and opens that finish later.
  const latest = useRef({ bundles, paths });
  latest.current = { bundles, paths };
  const queues = useRef<Record<string, Promise<void>>>({});
  const documents = useRef(new Map(reopened?.documents ?? []));
  const bookmarks = useRef(new Map(reopened?.bookmarks ?? []));

  const documentOf = useCallback((folder: string) => documents.current.get(folder) ?? folder, []);

  // One pack at a time per single file (table-app's singleFilePacker), each one coordinated
  // write of the file: a file the picker gave is the app's, its folder isn't.
  const packer = useRef(
    singleFilePacker(expoFs, stampOf, (file) => replacingFs(expoFs, file, (bytes) => writeCoordinated(pathOfUri(file), bytes))),
  );
  const packOne = useCallback((bundle: string): Promise<void> => {
    const workDir = latest.current.paths[bundle];
    const file = workDir ? documents.current.get(workDir) : undefined;
    if (!workDir || !file) return Promise.resolve();
    return packer.current(workDir, file);
  }, []);
  const pack = useCallback(async (keys: string[]) => {
    await Promise.all(keys.map(packOne));
  }, [packOne]);

  const open = useCallback(async (held: HeldDocument[]) => {
    const already = new Set(Object.values(latest.current.paths).map((p) => documents.current.get(p) ?? p));
    const opened = await openDocuments(
      held.filter((doc) => !already.has(doc.uri.replace(/\/+$/, ""))),
      Object.keys(latest.current.bundles),
      store,
    );
    for (const [workDir, uri] of opened.documents) documents.current.set(workDir, uri);
    for (const [uri, bookmark] of opened.bookmarks) bookmarks.current.set(uri, bookmark);
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
              await writeLibraryBundle(expoFs, library, tables, metas, key);
              // A single file: its working folder packed back into it.
              await packOne(key);
            })
            .catch((error: unknown) => {
              // Shown by the app, from useTableApp's `saving`.
              throw new Error(`${key}.table: ${error instanceof Error ? error.message : String(error)}`);
            });
          queues.current[key] = next;
          return next;
        }),
      );
    },
    [packOne],
  );

  // Remembered for next launch by bookmark; a document closed lets go of its scope.
  const held = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(Object.values(paths).map((p) => documents.current.get(p) ?? p));
    for (const uri of held.current) if (!now.has(uri)) releaseDocument(pathOfUri(uri));
    held.current = now;
    try {
      store?.setItem(OPENED_KEY, JSON.stringify([...now].flatMap((uri) => (bookmarks.current.has(uri) ? [bookmarks.current.get(uri)!] : []))));
    } catch {
      // Full or refused: the documents just won't reopen next launch.
    }
  }, [store, paths]);

  return { open, write, pack, documentOf };
}
