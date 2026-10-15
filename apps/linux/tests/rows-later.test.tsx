import { cleanup, render, screen, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A document drawn from its small files at once, its rows read after
// (loadLibrary's rowsLater): what the app does with every .table it opens.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-rows-later-"));
  bundle = join(dir, "household-budget.table");
  cpSync(join(fixturesDir()!, "household-budget.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe("opening a .table, its rows after the rest", () => {
  it("is opened without its rows, about how many it has; then they're read, and it counts them", async () => {
    const library = await loadLibrary([bundle], [], { rowsLater: true });
    const ledger = library.tables["household-budget/ledger"]!;
    expect(ledger.rows).toEqual([]);
    expect(ledger.loading?.estimate).toBe(10);
    await render(<App library={library} initialTable="household-budget/ledger" initialView="as-entered" />);
    // Read after: the count is the rows'.
    expect(await screen.findByText("10 of 10 rows")).toBeDefined();
  });

  it("says a line of its rows it couldn't read once it has read them (#567)", async () => {
    appendFileSync(join(bundle, "tables", "ledger", "rows", "0001.ndjson"), "<<<<<<< HEAD\n");
    const library = await loadLibrary([bundle], [], { rowsLater: true });
    await render(<App library={library} initialTable="household-budget/ledger" initialView="as-entered" />);
    await waitFor(async () => expect(await screen.findByText(/skipped 1 thing it couldn.t read/)).toBeDefined());
  });

  it("a table judged large enough goes to its index, not into memory", async () => {
    const library = await loadLibrary([bundle], [], { rowsLater: true, indexedFrom: 5 });
    expect(library.tables["household-budget/ledger"]!.indexed).toBeDefined();
    expect(library.tables["household-budget/ledger"]!.loading).toBeUndefined();
  });
});
