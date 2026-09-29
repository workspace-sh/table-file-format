// Core's TableFs over react-native-file-access, so the macOS app reads and
// writes .table folders through core's reader and writer (SPEC section 1,
// D24), the same code Linux runs over node:fs.
//
// rename is a single POSIX rename(2): patches/react-native-file-access+4.0.4.patch
// replaces the library's remove-then-move, which isn't atomic.

import { FileSystem } from "react-native-file-access";
import type { TableFs } from "@workspace.sh/table-core/io";

export const desktopFs: TableFs = {
  async readText(path) {
    try {
      return await FileSystem.readFile(path, "utf8");
    } catch (error) {
      // Missing is a value, not an error; anything else still throws.
      if (!(await FileSystem.exists(path))) return null;
      throw error;
    }
  },
  writeText: (path, content) => FileSystem.writeFile(path, content, "utf8"),
  rename: (from, to) => FileSystem.mv(from, to),
  async mkdir(path) {
    // Creates any missing parents, and is fine when it's already there.
    await FileSystem.mkdir(path);
  },
  async list(path) {
    try {
      const entries = await FileSystem.statDir(path);
      // By name: macOS lists a directory in no particular order.
      return entries
        .map((e) => ({ name: e.filename, directory: e.type === "directory" }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (error) {
      if (!(await FileSystem.exists(path))) return null;
      throw error;
    }
  },
  async remove(path) {
    if (await FileSystem.exists(path)) await FileSystem.unlink(path);
  },
};
