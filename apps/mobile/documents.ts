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
import { bundleDir, openZip, removeFolder, tablesHome } from "./indexHost";
import { documentStamp, expoFs, filesLog, keepEditsAsCopy, pathOfUri, releaseAllBut, releaseDocument, resolveBookmark, settleDocument, writeCoordinated, type HeldDocument } from "@workspace.sh/table-files";

export const OPENED_KEY = "table-mobile:opened";
/** Documents closed with edits they never got (Android), by bookmark: settled at the next launch. */
export const UNSAVED_KEY = "table-mobile:unsaved";

/** Something said of a document in place (the tables sheet), with what can be done about it. */
export interface DocumentNotice {
  name: string;
  message: string;
  bookmark?: string;
  action?: { label: string; onPress: () => Promise<void> | void };
}
/** Each large single file's bundle key last time (its folder in the index host's home), by its URL. */
export const LARGE_KEY = "table-mobile:large-documents";

/** Where single files' working folders are kept: the phone's own, apart from anything else there. */
const singleFilesHome = (): string => new Directory(Paths.document, "single-files").uri.replace(/\/+$/, "");

/**
 * A single file as it is now, to tell whether its working folder was made
 * from it: the document's own size and time where the file held is a copy
 * of it (Android), so a change made to it elsewhere is seen; the file's own
 * where it's the document.
 */
async function stampOf(uri: string): Promise<string> {
  const held = await documentStamp(pathOfUri(uri));
  if (held !== null) return held;
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
  /** Documents opened last time that are there but couldn't be opened again, and why. */
  unavailable?: DocumentNotice[];
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
  const notices: DocumentNotice[] = [];
  const names = new Set(taken);
  const read: Library = { tables: {}, bundles: {}, paths: {}, problems: {} };
  const first: Record<string, Row[]> = {};
  const keys = largeKeys(store);
  for (const doc of held) {
    const uri = doc.uri.replace(/\/+$/, "");
    bookmarks.set(uri, doc.bookmark);
    if (doc.unsavedEdits) notices.push(unsavedNotice(doc));
    try {
      if (doc.directory) {
        folders.push(uri);
        continue;
      }
      const workDir = workDirFor(singleFilesHome(), uri);
      // The file's stamp before its bytes: a change that lands between the two is then seen at the next save, not taken as read.
      const stamp = doc.stamp != null ? doc.stamp : await stampOf(uri);
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
          await expoFs.writeText(`${dir}.stamp`, stamp);
          continue;
        }
        // Judged large, read as not: unpacked as any.
      }
      await unpackTableFile(expoFs, bytes, workDir, stamp);
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
  return { library, first, documents, bookmarks, ...(notices.length > 0 ? { unavailable: notices } : {}) };
}

/** A document changed elsewhere after edits here weren't all saved to it: its edits, offered as a copy. */
function unsavedNotice(doc: HeldDocument): DocumentNotice {
  return {
    name: doc.name,
    message: "Changed somewhere else before edits here were all saved to it. It's shown as it is; those edits are kept on this phone.",
    action: { label: "Keep My Edits as a Copy…", onPress: () => void keepEditsAsCopy(doc.path) },
  };
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
  // Documents closed with edits they never got: held again to finish them, and let go once they're settled.
  let unsaved: string[] = [];
  try {
    const raw = store?.getItem(UNSAVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) unsaved = parsed.filter((b): b is string => typeof b === "string" && !remembered.includes(b));
  } catch {
    // Unreadable: none.
  }
  const waiting = (await Promise.all(unsaved.map(async (b) => ((await settleDocument(b).catch(() => false)) ? [] : [b])))).flat();
  try {
    store?.setItem(UNSAVED_KEY, JSON.stringify(waiting));
  } catch {
    // Full or refused: tried again next launch.
  }
  // Grants kept for anything but these (a pick that couldn't be read, a close cut short) are given back.
  await releaseAllBut([...remembered, ...waiting]).catch(() => {});
  const found = await Promise.all(remembered.map((bookmark) => resolveBookmark(bookmark).catch((error: unknown) => ({ error: String(error), bookmark }))));
  const held = found.filter((doc): doc is HeldDocument => doc !== null && !("error" in doc));
  // There, but not to be held (its grant taken away): said in place, by its name.
  const unavailable: DocumentNotice[] = found.flatMap((doc) => (doc && "error" in doc ? [{ name: nameOfBookmark(doc.bookmark), message: doc.error, bookmark: doc.bookmark }] : []));
  const opened = await openDocuments(held, taken, store);
  return { ...opened, unavailable: [...unavailable, ...(opened.unavailable ?? [])] };
}

/** A document's name from its bookmark, where that is a URI (Android's): its last part, decoded. */
function nameOfBookmark(bookmark: string): string {
  let path = bookmark.replace(/\/+$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not encoded: as it is.
  }
  return path.slice(path.lastIndexOf("/") + 1).replace(/^.*:/, "") || "A document";
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
  reopened?: Pick<OpenedDocuments, "documents" | "bookmarks" | "unavailable">;
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
    if (!workDir || !file) {
      filesLog(`pack ${bundle}: not a single file (folder ${workDir ?? "none"})`);
      return Promise.resolve();
    }
    filesLog(`pack ${bundle}: ${workDir} into ${file}`);
    return packer.current(workDir, file).then(
      () => filesLog(`pack ${bundle}: done`),
      (error: unknown) => {
        filesLog(`pack ${bundle}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      },
    );
  }, []);
  // Each pack waits its turn behind the bundle's writes, and closing waits for it in turn.
  const pack = useCallback(async (keys: string[]) => {
    await Promise.all(
      keys.map((key) => {
        const next = (queues.current[key] ?? Promise.resolve()).catch(() => {}).then(() => packOne(key));
        queues.current[key] = next;
        return next;
      }),
    );
  }, [packOne]);

  const open = useCallback(async (held: HeldDocument[]) => {
    const already = new Set(Object.values(latest.current.paths).map((p) => documents.current.get(p) ?? p));
    const fresh = held.filter((doc) => !already.has(doc.uri.replace(/\/+$/, "")));
    const opened = await openDocuments(fresh, Object.keys(latest.current.bundles), store);
    for (const [workDir, uri] of opened.documents) documents.current.set(workDir, uri);
    for (const [uri, bookmark] of opened.bookmarks) bookmarks.current.set(uri, bookmark);
    // A document that couldn't be read isn't kept open: what it was granted goes back.
    const read = new Set(opened.documents.values());
    for (const doc of fresh) if (!doc.directory && !read.has(doc.uri.replace(/\/+$/, ""))) releaseDocument(doc.path);
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
              filesLog(`write ${key}: ${error instanceof Error ? error.message : String(error)}`);
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
    // Let go only once the writes asked for so far are done: a save queued as it closed still reaches it.
    const closed = [...held.current].filter((uri) => !now.has(uri));
    if (closed.length > 0) {
      void Promise.allSettled(Object.values(queues.current)).then(() => {
        for (const uri of closed) {
          // Kept (edits it never got wait beside it): remembered, to be settled at the next launch.
          const bookmark = bookmarks.current.get(uri);
          if (releaseDocument(pathOfUri(uri)) && bookmark) {
            try {
              const raw = store?.getItem(UNSAVED_KEY);
              const list: string[] = raw ? JSON.parse(raw) : [];
              store?.setItem(UNSAVED_KEY, JSON.stringify([...new Set([...list, bookmark])]));
            } catch {
              // Full or refused: its grant is kept regardless, and it's settled when opened again.
            }
          }
        }
      });
    }
    held.current = now;
    try {
      // Documents that couldn't be opened again stay remembered, listed with why, for when they can be.
      const kept = (reopened?.unavailable ?? []).flatMap((doc) => (doc.bookmark ? [doc.bookmark] : []));
      store?.setItem(OPENED_KEY, JSON.stringify([...new Set([...[...now].flatMap((uri) => (bookmarks.current.has(uri) ? [bookmarks.current.get(uri)!] : [])), ...kept])]));
    } catch {
      // Full or refused: the documents just won't reopen next launch.
    }
  }, [store, paths]);

  return { open, write, pack, documentOf };
}
