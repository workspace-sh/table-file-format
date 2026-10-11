import * as Gio from "@gtkx/gi/gio";
import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// The totals footer: each cell is the menu of what can be worked out under
// its column, as on the web's "Calculate". Read back from the view's file.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-totals-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const totalsOnDisk = async () => (await parseTable(join(bundle, "tables", "tasks"))).views.find((v) => v.id === "v1")!.totals;

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
}

function labels(model: Gio.MenuModel): string[] {
  const out: string[] = [];
  for (let i = 0; i < model.getNItems(); i++) {
    const label = model.getItemAttributeValue(i, "label", GLib.VariantType.new("s"));
    if (label) out.push(label.getString()[0]);
    const section = model.getItemLink(i, "section");
    if (section) out.push(...labels(section));
  }
  return out;
}

/** The footer cell under the column titled `title`. */
async function footerCell(title: string): Promise<Gtk.MenuButton> {
  let found: Gtk.MenuButton | undefined;
  await waitFor(async () => {
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON);
    found = buttons.find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === `Calculate ${title}`) as Gtk.MenuButton | undefined;
    expect(found, `the footer cell under "${title}"`).toBeDefined();
  });
  return found!;
}

const menuOf = (cell: Gtk.MenuButton) => labels((cell.getPopover() as Gtk.PopoverMenu).getMenuModel()!);

describe("the totals footer on Linux", () => {
  it("is there with nothing chosen, each cell offering what its column can show", async () => {
    await openTasks();
    expect(await totalsOnDisk()).toBeUndefined();
    // A number: sums and the like, and counts. Text: counts only.
    expect(menuOf(await footerCell("priority"))).toEqual(["None", "Sum", "Average", "Smallest", "Largest", "Count values", "Count empty"]);
    expect(menuOf(await footerCell("title"))).toEqual(["None", "Count values", "Count empty"]);
  });

  it("a total chosen is saved to the view and shown; None takes it away", async () => {
    await openTasks();
    (await footerCell("priority")).activateAction("total.sum", null);
    await waitFor(async () => expect(await totalsOnDisk()).toEqual({ priority: "sum" }));
    const rows = (await parseTable(join(bundle, "tables", "tasks"))).rows;
    const sum = rows.reduce((a, r) => a + (typeof r.priority === "number" ? r.priority : 0), 0);
    await screen.findByText("Sum");
    await screen.findByText(String(sum));
    (await footerCell("title")).activateAction("total.count", null);
    await waitFor(async () => expect(await totalsOnDisk()).toEqual({ priority: "sum", title: "count" }));
    (await footerCell("priority")).activateAction("total.none", null);
    (await footerCell("title")).activateAction("total.none", null);
    await waitFor(async () => expect(await totalsOnDisk()).toBeUndefined());
  });

  it("the cell's menu ticks the total that is chosen", async () => {
    await openTasks();
    const cell = await footerCell("priority");
    /** The menu's entries drawn with a tick: its mark is in the checked state. */
    const ticked = () => {
      const out: string[] = [];
      const walk = (w: Gtk.Widget) => {
        if ([Gtk.AccessibleRole.MENU_ITEM, Gtk.AccessibleRole.MENU_ITEM_CHECKBOX].includes(w.getAccessibleRole())) {
          let label = "";
          let checked = false;
          const within = (x: Gtk.Widget) => {
            if (x instanceof Gtk.Label) label = x.getText();
            if ((x.getStateFlags() & Gtk.StateFlags.CHECKED) !== 0) checked = true;
            for (let c = x.getFirstChild(); c; c = c.getNextSibling()) within(c);
          };
          within(w);
          if (checked) out.push(label);
          return;
        }
        for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
      };
      walk(cell.getPopover()!);
      return out;
    };
    cell.popup();
    await waitFor(() => expect(ticked()).toEqual(["None"]));
    cell.activateAction("total.average", null);
    await waitFor(async () => expect(await totalsOnDisk()).toEqual({ priority: "average" }));
    await waitFor(() => expect(ticked()).toEqual(["Average"]));
  });
});
