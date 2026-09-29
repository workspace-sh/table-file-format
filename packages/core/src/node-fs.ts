// `TableFs` over node:fs, for `./parser`, `./writer` and any Node app.
// Kept out of the barrel so bundlers for browsers and React Native never
// reach node:fs.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";

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
};
