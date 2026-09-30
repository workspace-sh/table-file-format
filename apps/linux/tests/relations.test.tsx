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

// Related rows, picked from the related table by title, read back as ids.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-rel-"));
  bundle = join(dir, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const dealsOnDisk = () => parseTable(join(bundle, "tables", "deals"));

async function openDeals() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="crm/deals" initialView="all" />);
}

describe("relations on Linux", () => {
  it("a deal's company is picked from the companies, by name, and saved as its id", async () => {
    await openDeals();
    // Deal 1 (Atlas: 3-year renewal) is Atlas Freight's.
    await userEvent.click((await screen.findAllByText("Atlas Freight"))[0]!);
    let picker: Gtk.DropDown | undefined;
    await waitFor(async () => {
      picker = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).find((w) => w instanceof Gtk.DropDown) as Gtk.DropDown | undefined;
      expect((picker?.getSelectedItem() as Gtk.StringObject | null)?.getString()).toBe("Atlas Freight");
    });
    const labels = Array.from({ length: picker!.getModel()!.getNItems() }, (_, i) => (picker!.getModel()!.getItem(i) as Gtk.StringObject).getString());
    picker!.setSelected(labels.indexOf("Lumen Health"));
    await waitFor(async () => expect((await dealsOnDisk()).rows.find((r) => r.id === "dl-1")?.company).toBe("co-lumen"));
  });

  it("a deal's contacts are ticked on from the contacts, kept in their table's order", async () => {
    await openDeals();
    const pickers = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose Contacts" });
    await userEvent.click(pickers[0]!);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.CHECKBOX, { name: "Priya Nair" }));
    await waitFor(async () => expect((await dealsOnDisk()).rows.find((r) => r.id === "dl-1")?.contacts).toEqual(["ct-maya", "ct-jonas", "ct-priya"]));
  });
});
