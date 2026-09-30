import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// The line under a view's name, and the questions asked before something
// is lost: table-app's wording, as the web and macOS show it.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-prompts-"));
  bundle = join(dir, "household-budget.table");
  cpSync(join(fixturesDir()!, "household-budget.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const ledgerOnDisk = () => parseTable(join(bundle, "tables", "ledger"));

async function openLedger(view: string) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="household-budget/ledger" initialView={view} />);
}

describe("the line under a view's name", () => {
  it("counts the rows and says the table is valid", async () => {
    await openLedger("as-entered");
    expect(await screen.findByText("10 of 10 rows")).toBeDefined();
    const valid = await screen.findByText("schema valid");
    expect(valid.getTooltipText()).toMatch(/^Every row fits the schema/);
  });

  it("counts a table's errors, with the first as its hint", async () => {
    appendFileSync(join(bundle, "tables", "ledger", "rows.ndjson"), `${JSON.stringify({ id: "bad", date: "2026-03-01", item: "Odd", amount: "lots" })}\n`);
    await openLedger("as-entered");
    const invalid = await screen.findByText("1 validation error");
    expect(invalid.getTooltipText()).toMatch(/^amount: /);
    expect(invalid.hasCssClass("error")).toBe(true);
  });

  it("says the schema changed once a field is added", async () => {
    await openLedger("as-entered");
    await screen.findByText("schema valid");
    expect(screen.queryByText("schema changed")).toBeNull();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" }));
    let name: Adw.EntryRow | undefined;
    await waitFor(async () => {
      // An entry row is a list item to accessibility, not a text box.
      name = (await screen.findAllByRole(Gtk.AccessibleRole.LIST_ITEM)).find((w) => w instanceof Adw.EntryRow && w.getTitle() === "Name") as Adw.EntryRow | undefined;
      expect(name).toBeDefined();
    });
    await userEvent.type(name!, "Note");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    expect(await screen.findByText("schema changed")).toBeDefined();
  });
});

describe("a sheet that formulas read, turned off", () => {
  async function turnOff() {
    await openLedger("by-date");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    const sheet = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Gtk.Switch) as Gtk.Switch;
    expect(sheet.getActive()).toBe(true);
    await userEvent.click(sheet);
    expect(await screen.findByText(/this sheet by place and will show #REF!\.$/)).toBeDefined();
  }

  it("asks first, and Cancel keeps it a sheet", async () => {
    await turnOff();
    await userEvent.click(await screen.findByText("Cancel"));
    // The switch shows the view as it still is, not where it was flicked.
    await waitFor(async () => {
      const sheet = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Gtk.Switch) as Gtk.Switch;
      expect(sheet.getActive()).toBe(true);
    });
    expect((await ledgerOnDisk()).views.find((v) => v.id === "by-date")?.coordinates).toBe(true);
  });

  it("Stop saves it as a plain table", async () => {
    await turnOff();
    await userEvent.click(await screen.findByText("Stop"));
    await waitFor(async () => expect((await ledgerOnDisk()).views.find((v) => v.id === "by-date")?.coordinates).toBeUndefined());
  });
});

describe("a column header's tooltip", () => {
  it("says what the column is, as the web's hint does", async () => {
    await openLedger("as-entered");
    const header = (await screen.findAllByText("Balance")).find((w) => w.getTooltipText()?.startsWith("Balance\n")) as Gtk.Label;
    const lines = header.getTooltipText()!.split("\n");
    expect(lines[0]).toBe("Balance");
    expect(lines[1]!.startsWith("Formula")).toBe(true);
    expect(lines).toContain("Stored as “balance”");
    expect(lines.at(-1)).toBe("Click to edit this column");
  });
});

