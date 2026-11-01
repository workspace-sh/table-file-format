// `TableFs` over node:fs, for `./parser`, `./writer` and any Node app.
// Kept out of the barrel so bundlers for browsers and React Native never
// reach node:fs.

import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import type { TableFs } from "./io.js";

const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

export const nodeFs: TableFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      if (missing(err) || (err as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw err;
    }
  },
  writeText: (path, content) => writeFile(path, content),
  // rename(2): replaces an existing target atomically.
  rename: (from, to) => rename(from, to),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  async list(path) {
    if (!existsSync(path)) return null;
    try {
      return (await readdir(path, { withFileTypes: true })).map((e) => ({ name: e.name, directory: e.isDirectory() }));
    } catch (err) {
      if (missing(err) || (err as NodeJS.ErrnoException).code === "ENOTDIR") return null;
      throw err;
    }
  },
  remove: (path) => rm(path, { recursive: true, force: true }),
  async readBytes(path) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (err) {
      if (missing(err) || (err as NodeJS.ErrnoException).code === "EISDIR") return null;
      throw err;
    }
  },
  writeBytes: (path, bytes) => writeFile(path, bytes),
  async size(path) {
    try {
      const s = await stat(path);
      return s.isFile() ? s.size : null;
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
  },
  async readHead(path, bytes) {
    let file;
    try {
      file = await open(path, "r");
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
    try {
      const buffer = new Uint8Array(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  },
};
