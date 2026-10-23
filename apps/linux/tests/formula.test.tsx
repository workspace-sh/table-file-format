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

  it("a loop is offered Repeat Until It Settles, which works it out and is written to the table's meta, and Stop Repeating takes it back (D60)", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const schemaFile = join(bundle, "tables", "budget", "schema.json");
    const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as { fields: { name: string; computed?: { expr: string } }[] };
    // The quarter reads itself (times nothing): a loop, which repeating settles at the months' sum.
    schema.fields.find((f) => f.name === "quarter")!.computed!.expr = "(+ jan feb mar (* quarter 0))";
    writeFileSync(schemaFile, JSON.stringify(schema));
    await openSheet();
    await userEvent.click((await screen.findAllByText("#REF!"))[0]!);
    await userEvent.click(await screen.findByText("Repeat Until It Settles"));
    const iteration = async () => (await parseTable(join(bundle, "tables", "budget"))).meta?.iteration;
    await waitFor(async () => expect(await iteration()).toEqual({ max: 100, change: 0.001 }));
    expect((await screen.findAllByText("£4,350.00")).length).toBeGreaterThan(0);
    await userEvent.click(await screen.findByText("Stop Repeating"));
    await waitFor(async () => expect(await iteration()).toBeUndefined());
  });

  it("This Row Only saves the formula as that row's own, and the column's stays for the rest (D52)", async () => {
    await openSheet();
    await userEvent.click(await screen.findByText("£4,350.00"));
    const row = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Gtk.Switch)!;
    await userEvent.click(row);
    expect(await screen.findByText("Save for This Row")).toBeDefined();
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "=C1*2");
    await userEvent.click(await screen.findByText("Save for This Row"));
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "budget"));
      expect(t.cells).toEqual([expect.objectContaining({ field: "quarter", expr: "(* jan 2)" })]);
      expect(t.schema.fields.find((f) => f.name === "quarter")?.computed?.expr).toBe("(+ jan feb mar)");
    });
    // Rent's quarter is £2,900.00 now; reopened, it shows its own.
    await userEvent.click(await screen.findByText("£2,900.00"));
    expect(await screen.findByText("Use the Column's Formula")).toBeDefined();
    await userEvent.click(await screen.findByText("Use the Column's Formula"));
    await waitFor(async () => expect((await parseTable(join(bundle, "tables", "budget"))).cells).toBeUndefined());
  });

  it("colours the formula as it is typed: what it reads, its functions, numbers and text", async () => {
    await openSheet();
    await userEvent.click(await screen.findByText("£4,350.00"));
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    const colours = () => (entry.getAttributes()?.toString() ?? "").split("\n").filter(Boolean);
    // =C1 + D1 + E1: three references in one colour, and the operators fainter.
    await waitFor(() => expect(colours().filter((line) => / foreground #/.test(line))).toHaveLength(3));
    const reference = colours().find((line) => line.startsWith("1 3 "))!.split(" ").at(-1);
    expect(colours().filter((line) => line.includes("foreground-alpha"))).toHaveLength(3);
    await userEvent.clear(entry);
    await userEvent.type(entry, '=round(C1, 2) & "é" & D1');
    await waitFor(() => expect(colours().length).toBeGreaterThan(6));
    const colourAt = (start: number) => colours().find((line) => line.startsWith(`${start} `) && / foreground #/.test(line))?.split(" ").at(-1);
    const [fn, ref, num, str] = [colourAt(1), colourAt(7), colourAt(11), colourAt(16)];
    expect(ref).toBe(reference);
    // Four kinds, four colours.
    expect(new Set([fn, ref, num, str]).size).toBe(4);
    // After the é, which is two bytes to Pango, D1 still starts where it is drawn.
    expect(colourAt(23)).toBe(reference);
  });

  it("a column is clicked into the formula where it waits for one, by its coordinate in a sheet", async () => {
    await openSheet();
    await userEvent.click(await screen.findByText("£4,350.00"));
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    const column = async (label: string) => (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: label })).find((w) => w.getTooltipText()?.startsWith("Add "))!;
    // The formula is whole: nothing is waited for, and a column can't be added on its end.
    entry.setPosition(-1);
    await waitFor(async () => expect((await column("Jan")).getSensitive()).toBe(false));
    // Its own column isn't offered.
    expect(screen.queryAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Q1" }).filter((w) => w.getTooltipText()?.startsWith("Add "))).toHaveLength(0);
    await userEvent.type(entry, " + ");
    await screen.findByText("Click a column to add it");
    await waitFor(async () => expect((await column("Jan")).getSensitive()).toBe(true));
    // Jan is column C, and this is row 1.
    expect((await column("Jan")).getTooltipText()).toBe("Add C1");
    await userEvent.click(await column("Jan"));
    await waitFor(() => expect(entry.getText()).toBe("=C1 + D1 + E1 + C1"));
    // The cursor is after what was added, and typing goes on from there.
    await waitFor(() => expect(entry.getPosition()).toBe(entry.getText().length));
    expect(await screen.findByText("With This Formula")).toBeDefined();
    // In the middle of the formula too: after the first plus.
    entry.setPosition(5);
    await waitFor(async () => expect((await column("Feb")).getSensitive()).toBe(true));
    await userEvent.click(await column("Feb"));
    await waitFor(() => expect(entry.getText()).toBe("=C1 +D1 D1 + E1 + C1"));
  });

  it("in a field's settings on a table that isn't a sheet, a column is added by its name", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="household-budget/budget" initialView="spending" />);
    await userEvent.click(await screen.findByText("Q1"));
    await screen.findByText("One formula for the whole column.");
    const entry = (await screen.findAllByDisplayValue(/^=/)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    const column = async (label: string) => (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: label })).find((w) => w.getTooltipText()?.startsWith("Add "))!;
    expect((await column("Feb")).getTooltipText()).toBe("Add feb");
    const before = entry.getText();
    await userEvent.type(entry, " * ");
    await waitFor(async () => expect((await column("Feb")).getSensitive()).toBe(true));
    await userEvent.click(await column("Feb"));
    await waitFor(() => expect(entry.getText()).toBe(`${before} * feb`));
    // Coloured here as in the cell's panel.
    expect(entry.getAttributes()?.toString()).toMatch(/ foreground #/);
  });
});
