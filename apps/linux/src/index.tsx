import { createRoot } from "@gtkx/react";
import { bundlesIn, loadLibrary } from "@workspace.sh/table-app/node";
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
const fixtures = fixturesDir();
const paths = named.length > 0 ? named : fixtures ? bundlesIn(fixtures) : [];

const library = await loadLibrary(paths);
for (const [bundle, problems] of Object.entries(library.problems)) {
  for (const problem of problems) console.warn(`${bundle}: ${problem}`);
}

createRoot().render(<App library={library} initialTable={openTable} initialView={openView} />);
