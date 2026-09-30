import { createRoot } from "@gtkx/react";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { copiesOf, jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
import { App } from "./App.js";
import { fixturesDir } from "./fixtures.js";

// `.table` folders named on the command line, or the repo's fixtures.
// Spliced out of argv: GTKX hands the rest to GApplication, which refuses
// positional arguments it wasn't told to open.
const args = process.argv.splice(2);
const named = args.filter((arg) => !arg.startsWith("-"));
// `--open=crm/deals#pipeline`: the table, and optionally the view, shown
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
const paths = named.length > 0 ? named : fixtures ? copiesOf(fixtures, examples) : [];

const library = await loadLibrary(paths);
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
  />,
);
