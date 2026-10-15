import { configure } from "@gtkx/testing";

// Saving waits 400 ms after the last edit, then writes; with a dialog up,
// the first write can take longer than the 1 s default. Waiting on the
// file is how these tests see a save, so they wait up to 5 s.
configure({ asyncUtilTimeout: 5000 });

// A single-file .table opened in a test is edited in a working folder in the
// XDG cache (table-app's openSingleFile): this run's own, never the user's.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "table-linux-cache-"));
