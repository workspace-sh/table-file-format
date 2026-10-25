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

// Every formula the app works out is worked out by the EDN core too, as the app does, and checked against
// `.table`'s workbook: a difference fails the test (#638). The index worker reads the variable.
import { setFormulaEngine } from "@workspace.sh/table-core";
import { loadEdn } from "@workspace.sh/edn";
setFormulaEngine(await loadEdn({ binding: "native" }), { check: true });
process.env.TABLE_FORMULA_CHECK = "1";
