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
  writeFileSync(viewsFile, JSON.stringify(views.map((v) => (v.id === "sheet" ? { ...v, merged } : v))));
  const library = await loadLibrary([join(dir, "household-budget.table")]);
  await render(<App library={library} initialTable="household-budget/budget" initialView="sheet" />);
  const cell = (await screen.findAllByText("Rent"))[0]!;
  return cell.getRoot() as unknown as Gtk.Widget;
}

describe("merged cells on Linux", () => {
  it("a block of Jan and Feb over Rent and Energy is drawn as one, two columns wide and two rows tall, showing Rent's January", async () => {
    const root = await openSheet([{ from: { field: "jan", row: "rent" }, to: { field: "feb", row: "energy" } }]);
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

  it("a block that isn't one (a single cell, a corner that isn't there, outside a Sheet view) isn't drawn", async () => {
    const root = await openSheet([
      { from: { field: "jan", row: "rent" }, to: { field: "jan", row: "rent" } },
      { from: { field: "jan", row: "rent" }, to: { field: "nope", row: "energy" } },
    ]);
    await screen.findAllByText("£1,450.00");
    expect(all(root, "merged-cells")).toHaveLength(0);
  });
});
