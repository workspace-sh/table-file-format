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

// A choice cell's drop-down draws its choices as the cell does: each a pill in its colour.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-choice-"));
  bundle = join(dir, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** Every label inside `w`, in order. */
function labelsIn(w: Gtk.Widget): Gtk.Label[] {
  const out: Gtk.Label[] = [];
  for (let c = w.getFirstChild(); c; c = c.getNextSibling()) {
    if (c instanceof Gtk.Label) out.push(c);
    out.push(...labelsIn(c));
  }
  return out;
}

describe("choices on Linux", () => {
  it("a stage is picked from pills in the stages' colours, as the cells draw them", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="crm/deals" initialView="All deals" />);
    // Two deals' stages of different colours, as the grid draws them.
    const proposal = (await screen.findAllByText("Proposal"))[0]! as Gtk.Label;
    const won = (await screen.findAllByText("Won"))[0]! as Gtk.Label;
    const pill = proposal.getCssClasses();
    expect(pill.length).toBeGreaterThan(1);
    expect(won.getCssClasses()).not.toEqual(pill);

    await userEvent.click(proposal.getParent()!);
    let picker: Gtk.DropDown | undefined;
    await waitFor(async () => {
      picker = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).find((w) => w instanceof Gtk.DropDown) as Gtk.DropDown | undefined;
      expect(picker).toBeDefined();
    });
    // The chosen stage, on the drop-down's button: the cell's own pill.
    await waitFor(() => {
      const shown = labelsIn(picker!).find((l) => l.getLabel() === "Proposal");
      expect(shown?.getCssClasses()).toEqual(pill);
    });
  });

  it("New Choice… names a stage that isn't there yet: it's added to the field and the deal takes it", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="crm/deals" initialView="All deals" />);
    const proposal = (await screen.findAllByText("Proposal"))[0]! as Gtk.Label;
    await userEvent.click(proposal.getParent()!);
    let picker: Gtk.DropDown | undefined;
    await waitFor(async () => {
      picker = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).find((w) => w instanceof Gtk.DropDown) as Gtk.DropDown | undefined;
      expect(picker).toBeDefined();
    });
    // The last item: "New Choice…".
    const items = picker!.getModel()!;
    expect((items.getItem(items.getNItems() - 1) as Gtk.StringObject).getString()).toBe("New Choice…");
    picker!.setSelected(items.getNItems() - 1);
    const entry = (await screen.findByPlaceholderText("New choice")) as Gtk.Entry;
    await userEvent.type(entry, "On hold");
    entry.emit("activate");
    await waitFor(async () => {
      const deals = await parseTable(join(bundle, "tables", "deals"));
      const stage = deals.schema.fields.find((f) => f.name === "stage")!;
      expect(JSON.stringify(stage.constraints?.enum)).toContain('"On hold"');
      expect(deals.rows.filter((r) => r.stage === "On hold")).toHaveLength(1);
    });
    expect(await screen.findAllByText("On hold")).not.toHaveLength(0);
  });
});
