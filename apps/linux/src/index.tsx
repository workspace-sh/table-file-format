import { createRoot } from "@gtkx/react";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { bundlesIn, copiesOf, jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
import { loadClosed } from "./closedFiles.js";
import { INDEXED_FROM } from "@workspace.sh/table-app";
import { App } from "./App.js";
import { openWorkerIndexHost } from "@workspace.sh/table-gtk/embed";
import { fixturesDir } from "./fixtures.js";
import { setFormulaEngine } from "@workspace.sh/table-core";
import { loadEdn } from "@workspace.sh/edn";

// Formulas are worked out by the EDN core (Rust, natively), but those it leaves to `.table`'s own
// workbook (#638). Without it, the workbook works them all out, as before.
setFormulaEngine(await loadEdn({ binding: "native" }).catch((e: unknown) => (console.warn(`formulas: the workbook's own, not the EDN core: ${String(e)}`), null)));

// What's named on the command line (a file manager names what it opens), or
// the repo's fixtures. Spliced out of argv: GTKX hands the rest to
// GApplication, which refuses options it doesn't know. `.table` folders are
// read here, before the window is up; anything else (a single file, a
// spreadsheet) goes back to GApplication, which hands it to App's onOpen.
const args = process.argv.splice(2);
const named = args.filter((arg) => !arg.startsWith("-"));
const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** Whether this app is running already: GApplication then makes this launch hand its files to it, and end. */
function runningAlready(id: string): boolean {
  try {
    const reply = execFileSync("gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner", id], { encoding: "utf8", timeout: 2000 });
    return reply.includes("true");
  } catch {
    return false;
  }
}
const elsewhere = named.length > 0 && runningAlready("sh.workspace.TableDemo");
// Read by the window that's open already, not here: every path goes to it.
const readHere = elsewhere ? [] : named.filter(isFolder);
process.argv.push(...(elsewhere ? named : named.filter((path) => !isFolder(path))));
// `--open=crm/deals#Pipeline`: the table, and optionally the view (by its name or id), shown
// first. How the headless screenshots reach a particular view.
const open = args.find((arg) => arg.startsWith("--open="))?.slice("--open=".length);
const [openTable, openView] = open ? open.split("#") : [];
// Edits save as they're made. Folders named on the command line are
// edited where they are; the examples are copies, made once in the data
// folder, so the repo's fixtures never change.
const dataHome = join(process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"), "table-demo");
const examples = join(dataHome, "examples");
// This viewer's own settings (display language, dates, formula syntax).
const settings = jsonFileStore(join(dataHome, "settings.json"));
const fixtures = fixturesDir();
// The examples: each copied once, but for the ones closed here, and with them whatever else was made
// or opened into their folder (a new file, an archive), which is the app's to keep.
const examplesNow = () => {
  if (fixtures) copiesOf(fixtures, examples, loadClosed(settings));
  return existsSync(examples) ? bundlesIn(examples) : [];
};
const paths = named.length > 0 ? readHere : examplesNow();

// Drawn from each table's small files at once; their rows are read after (the window is up meanwhile).
const library = await loadLibrary(paths, [], { indexedFrom: INDEXED_FROM, rowsLater: true });
for (const [bundle, problems] of Object.entries(library.problems)) {
  for (const problem of problems) console.warn(`${bundle}: ${problem}`);
}

// Reset: the examples copied afresh, dropping every edit and every file
// made or opened into them. Only when the examples are what's open.
const resetExamples =
  named.length === 0 && fixtures
    ? (held: string[]) => {
        rmSync(examples, { recursive: true, force: true });
        return loadLibrary(copiesOf(fixtures, examples), held);
      }
    : undefined;

createRoot().render(
  <App
    library={library}
    initialTable={openTable}
    initialView={openView}
    settings={settings}
    newFilesIn={named.length > 0 ? undefined : examples}
    resetExamples={resetExamples}
    openIndex={openWorkerIndexHost}
    indexedFrom={INDEXED_FROM}
  />,
);
