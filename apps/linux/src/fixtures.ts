// The tables the demo opens: the `.table` folders named on the command
// line, or else the repo's fixtures, read with table-app's loader. The web
// demo bundles the same fixtures instead, having no disk.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repo's `fixtures/`, found by walking up from this module: from
 * `src/` under `gtkx dev`, from `dist/` in a build.
 */
export function fixturesDir(from = dirname(fileURLToPath(import.meta.url))): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "fixtures");
    if (existsSync(join(candidate, "projects.table"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}
