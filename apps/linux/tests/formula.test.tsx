import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A formula cell opens how it was worked out, on a copy of the budget, and a
// formula saved there is read back from the file.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-formula-"));
  bundle = join(dir, "household-budget.table");
  cpSync(join(fixturesDir()!, "household-budget.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function openSheet() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="household-budget/budget" initialView="sheet" />);
}

describe("a formula cell on Linux", () => {
  it("opens with the formula, what it read, and its result", async () => {
    await openSheet();
    // Rent's Q1: £1,450 × 3.
    await userEvent.click(await screen.findByText("£4,350.00"));
    expect(await screen.findByText("In This Row")).toBeDefined();
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    expect(entry.getText()).toBe("=C1 + D1 + E1");
    expect((await screen.findAllByText("Result")).length).toBe(1);
  });

  it("a changed formula previews, and saving writes it to the file for every row", async () => {
    await openSheet();
    await userEvent.click(await screen.findByText("£4,350.00"));
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "=C1*2");
    expect(await screen.findByText("With This Formula")).toBeDefined();
    await userEvent.click(await screen.findByText("Save for Every Row"));
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "budget"));
      expect(t.schema.fields.find((f) => f.name === "quarter")?.computed?.expr).toBe("(* jan 2)");
    });
  });
});
