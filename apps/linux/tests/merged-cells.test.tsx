import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A Sheet view's merged cells (D58): a block drawn as one, with its top-left cell's value.

let dir: string;
let budget: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-merged-"));
  cpSync(join(fixturesDir()!, "household-budget.table"), join(dir, "household-budget.table"), { recursive: true });
  budget = join(dir, "household-budget.table", "tables", "budget");
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function all(root: Gtk.Widget, name: string, out: Gtk.Widget[] = []): Gtk.Widget[] {
  if (root.getName() === name) out.push(root);
  for (let c = root.getFirstChild(); c; c = c.getNextSibling()) all(c, name, out);
  return out;
}

function labels(root: Gtk.Widget, out: string[] = []): string[] {
  if (root instanceof Gtk.Label) out.push(root.getLabel());
  for (let c = root.getFirstChild(); c; c = c.getNextSibling()) labels(c, out);
  return out;
}

async function openSheet(merged: unknown[]) {
  const viewsFile = join(budget, "views.json");
  const views = JSON.parse(readFileSync(viewsFile, "utf8")) as { id: string }[];
  writeFileSync(viewsFile, JSON.stringify(views.map((v) => (v.id === "435dx9iqim5iz" ? { ...v, merged } : v))));
  const library = await loadLibrary([join(dir, "household-budget.table")]);
  await render(<App library={library} initialTable="household-budget/budget" initialView="435dx9iqim5iz" />);
  const cell = (await screen.findAllByText("Rent"))[0]!;
  return cell.getRoot() as unknown as Gtk.Widget;
}

describe("merged cells on Linux", () => {
  it("a block of Jan and Feb over Rent and Energy is drawn as one, two columns wide and two rows tall, showing Rent's January", async () => {
    const root = await openSheet([{ from: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" }, to: { field: "feb", row: "f8o7dzw4cpk4zgd38togwz7n4w" } }]);
    const box = await waitFor(() => {
      const found = all(root, "merged-cells");
      expect(found).toHaveLength(1);
      return found[0]!;
    });
    expect(labels(box)).toEqual(["£1,450.00"]);
    // As wide as its two columns and as tall as its two rows, less their last rules.
    const rent = (await screen.findAllByText("£142.00"))[0]!;
    const [, cellBounds] = rent.getParent()!.getParent()!.computeBounds(root);
    await waitFor(() => {
      expect(box.getHeight()).toBeGreaterThan(80);
      expect(box.getWidth()).toBeGreaterThan(2 * (cellBounds!.getWidth() - 2) - 2);
    });
    // A click on it is a click on Rent's January.
    await userEvent.click(box);
    await waitFor(() => {
      const focus = (root as unknown as Gtk.Window).getFocus();
      expect(focus).not.toBeNull();
      expect(labels(focus!)).toEqual(["£1,450.00"]);
    });
  });

  it("Merge Cells… from Rent's January asks for the block from C1, merges C1:D2, and Unmerge Cells shows the cells again", async () => {
    const root = await openSheet([]);
    const views = () => JSON.parse(readFileSync(join(budget, "views.json"), "utf8")) as { id: string; merged?: unknown }[];
    const january = () => {
      let cell: Gtk.Widget | null = screen.queryAllByText("£1,450.00")[0] as Gtk.Widget;
      while (cell && !cell.getFocusable()) cell = cell.getParent();
      cell!.grabFocus();
    };
    const rowMenu = async () => (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Row Actions" }))[0]!;
    await screen.findAllByText("£1,450.00");
    january();
    (await rowMenu()).activateAction("row.merge", null);
    const entry = (await screen.findByPlaceholderText("B2:C4")) as Gtk.Entry;
    expect(entry.getText()).toBe("C1:");
    entry.setPosition(-1);
    await userEvent.type(entry, "D2");
    await userEvent.click(await screen.findByText("Merge"));
    await waitFor(() => expect(views().find((v) => v.id === "435dx9iqim5iz")?.merged).toEqual([{ from: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" }, to: { field: "feb", row: "f8o7dzw4cpk4zgd38togwz7n4w" } }]));
    await waitFor(() => expect(all(root, "merged-cells")).toHaveLength(1));
    // From the block: its top-left cell is selected, and the menu offers to take it apart.
    await userEvent.click(all(root, "merged-cells")[0]!);
    (await rowMenu()).activateAction("row.unmerge", null);
    await waitFor(() => expect(views().find((v) => v.id === "435dx9iqim5iz")?.merged).toBeUndefined());
    await waitFor(() => expect(all(root, "merged-cells")).toHaveLength(0));
  });

  it("a block that isn't one (a single cell, a corner that isn't there, outside a Sheet view) isn't drawn", async () => {
    const root = await openSheet([
      { from: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" }, to: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" } },
      { from: { field: "jan", row: "yzqhrmxgwi1k3ur81b7epdbim5" }, to: { field: "nope", row: "f8o7dzw4cpk4zgd38togwz7n4w" } },
    ]);
    await screen.findAllByText("£1,450.00");
    expect(all(root, "merged-cells")).toHaveLength(0);
  });
});
