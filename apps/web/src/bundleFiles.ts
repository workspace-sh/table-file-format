// What a .table holds besides its tables (SPEC sections 6 and 13): its
// attachments, and any file no reader knows. A single file opened here
// brings them (core's ParsedBundle.files), and a download writes them back.
// The rows are kept in this browser's store; these are bytes, so they're
// kept in IndexedDB, and come back after a reload as the rows do. Each
// attachment is shown from an object URL made from its bytes. The
// examples' attachments come with the page (loadFixture's attachmentUrls).

import { useEffect, useState } from "react";
import { attachmentAt } from "@workspace.sh/table-app";
import { attachmentUrls } from "./loadFixture";

const DATABASE = "table-web-files";
const STORE = "files";

/** Each bundle's files, by path inside `<bundle>.table/`. */
const kept = new Map<string, Map<string, Uint8Array>>();
/** Each kept attachment's object URL, by `bundle/table` key and file name. */
const urls = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();

const recordKey = (bundle: string, path: string) => `${bundle}\u0000${path}`;

/** The media type a file is shown as, by its name: an SVG is drawn only when it says it's one. */
function typeOf(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
    pdf: "application/pdf",
  };
  return (ext && types[ext]) ?? "application/octet-stream";
}

function changed() {
  for (const listener of listeners) listener();
}

function setUrl(bundle: string, path: string, bytes: Uint8Array | undefined) {
  const at = attachmentAt(bundle, path);
  if (!at) return;
  const table = urls.get(at.tableKey) ?? new Map<string, string>();
  const old = table.get(at.name);
  if (old) URL.revokeObjectURL(old);
  if (bytes) table.set(at.name, URL.createObjectURL(new Blob([bytes as BlobPart], { type: typeOf(at.name) })));
  else table.delete(at.name);
  if (table.size > 0) urls.set(at.tableKey, table);
  else urls.delete(at.tableKey);
}

// -- IndexedDB: where the bytes outlast the page --------------------------

let opening: Promise<IDBDatabase | null> | null = null;
function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    // No storage (a private window that refuses it): kept for as long as the page is open.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

async function write(change: (store: IDBObjectStore) => void): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    change(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

let loading: Promise<void> | null = null;
/** What an earlier visit kept, read once. A file kept since the page opened isn't replaced by it. */
function load(): Promise<void> {
  loading ??= (async () => {
    const db = await database();
    if (!db) return;
    const records = await new Promise<Array<{ bundle: string; path: string; bytes: Uint8Array }>>((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as Array<{ bundle: string; path: string; bytes: Uint8Array }>);
      request.onerror = () => resolve([]);
    });
    if (records.length === 0) return;
    for (const { bundle, path, bytes } of records) {
      const files = kept.get(bundle) ?? new Map<string, Uint8Array>();
      if (files.has(path)) continue;
      files.set(path, bytes);
      kept.set(bundle, files);
      setUrl(bundle, path, bytes);
    }
    changed();
  })();
  return loading;
}

// -- What the app asks ------------------------------------------------------

/** Keep a bundle's files: a single file's, as it's opened. Whatever was kept under that name goes. */
export function keepFiles(bundle: string, files: Record<string, Uint8Array> | undefined): void {
  forgetFiles(bundle);
  const entries = Object.entries(files ?? {});
  if (entries.length === 0) return;
  kept.set(bundle, new Map(entries));
  for (const [path, bytes] of entries) setUrl(bundle, path, bytes);
  changed();
  void write((store) => {
    for (const [path, bytes] of entries) store.put({ bundle, path, bytes }, recordKey(bundle, path));
  });
}

/** Keep one more file in a bundle: an attachment added to a cell. */
export function keepFile(bundle: string, path: string, bytes: Uint8Array): void {
  const files = kept.get(bundle) ?? new Map<string, Uint8Array>();
  files.set(path, bytes);
  kept.set(bundle, files);
  setUrl(bundle, path, bytes);
  changed();
  void write((store) => store.put({ bundle, path, bytes }, recordKey(bundle, path)));
}

/** A closed bundle's files go with it. */
export function forgetFiles(bundle: string): void {
  const files = kept.get(bundle);
  if (!files) return;
  kept.delete(bundle);
  for (const path of files.keys()) setUrl(bundle, path, undefined);
  changed();
  void write((store) => {
    for (const path of files.keys()) store.delete(recordKey(bundle, path));
  });
}

/** Every bundle's files go: Reset Demo Data. */
export function forgetAllFiles(): void {
  for (const bundle of [...kept.keys()]) forgetFiles(bundle);
  void write((store) => store.clear());
}

/** Where a table's attachment is shown from: a file kept here, or an example's. */
export function attachmentUrl(tableKey: string, name: string): string | undefined {
  return urls.get(tableKey)?.get(name) ?? attachmentUrls[tableKey]?.[name];
}

/** A table's attachments' names, kept here or an example's, sorted. */
export function attachmentsOf(tableKey: string): string[] {
  return [...new Set([...Object.keys(attachmentUrls[tableKey] ?? {}), ...(urls.get(tableKey)?.keys() ?? [])])].sort();
}

/**
 * A bundle's files for a single file to carry: those kept here, and the
 * examples' attachments, read from the page. A kept file wins over an
 * example's of the same path.
 */
export async function filesForArchive(bundle: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  const prefix = `${bundle}/`;
  for (const [tableKey, byName] of Object.entries(attachmentUrls)) {
    if (!tableKey.startsWith(prefix)) continue;
    const table = tableKey.slice(prefix.length);
    for (const [name, url] of Object.entries(byName)) {
      files[`tables/${table}/attachments/${name}`] = new Uint8Array(await (await fetch(url)).arrayBuffer());
    }
  }
  for (const [path, bytes] of kept.get(bundle) ?? []) files[path] = bytes;
  return files;
}

/** Draws again as kept files arrive or go; the first call reads what an earlier visit kept. */
export function useBundleFiles(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    void load();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return version;
}
