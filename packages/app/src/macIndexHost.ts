// A large .table's index on the Mac (SPEC section 8, #435): the shared index
// host (indexHost.ts) over react-native-file-access, for what's read and
// written a piece at a time, and op-sqlite over the system's own SQLite,
// which macOS builds with FTS5. The .table app on the Mac and Workspace's
// Mac app run it; each gives its own files (`fs`) and folder (`home`).

import { open } from "@op-engineering/op-sqlite";
import { FileSystem } from "react-native-file-access";
import { BundleEntry } from "@workspace.sh/table-core";
import type { TableFs } from "@workspace.sh/table-core/io";
import { opDriver, type OpDatabase } from "@workspace.sh/table-core/sqlite-op";
import { createIndexHost } from "./indexHost.ts";

// String.fromCharCode takes its arguments on the stack: convert in chunks.
const CHUNK = 0x8000;
// Hermes has them; React Native's types don't say so.
const { atob, btoa } = globalThis as unknown as { atob: (data: string) => string; btoa: (data: string) => string };

/** Bytes as base64, as react-native-file-access carries binary. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

/** Base64 back to bytes. */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function macIndexHost({ fs, home }: { fs: TableFs; home: () => string }) {
  return createIndexHost({
    fs,
    home,
    async size(path) {
      if (!(await FileSystem.exists(path))) return null;
      return (await FileSystem.stat(path)).size;
    },
    async writer(path) {
      await FileSystem.writeFile(path, "", "utf8");
      // Pieces are appended in the order written; close waits for the last.
      let written: Promise<void> = Promise.resolve();
      return {
        write: (bytes) => (written = written.then(() => FileSystem.appendFile(path, toBase64(bytes), "base64"))),
        close: () => written,
      };
    },
    async *pieces(path, size, step) {
      for (let at = 0; at < size; at += step) yield fromBase64(await FileSystem.readFileChunk(path, at, Math.min(step, size - at), "base64"));
    },
    async openDatabase(dir) {
      // op-sqlite's database matches core's structural one but for its wider value types.
      return opDriver(open({ name: BundleEntry.index, location: dir }) as unknown as OpDatabase);
    },
  });
}
