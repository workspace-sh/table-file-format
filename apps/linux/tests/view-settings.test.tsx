import * as Adw from "@gtkx/gi/adw";
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

// View settings change the view in the file: read back after each change.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-views-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));

async function openSettings() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="juycicwios88m" />);
  await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
  await screen.findByText("Filters");
}

/** Every drop-down's shown choice, in the order they're found. */
async function shownChoices(): Promise<string[]> {
  const downs = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Gtk.DropDown) as Gtk.DropDown[];
  return downs.map((d) => (d.getSelectedItem() as Gtk.StringObject | null)?.getString() ?? "");
}

describe("view settings on Linux", () => {
  it("a row hidden from its menu leaves the view, and View Settings shows it again (D58)", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="juycicwios88m" />);
    const cell = await screen.findByText("Land .table extension");
    const window = cell.getRoot() as unknown as Gtk.ApplicationWindow;
    await userEvent.click(cell);
    // The row's menu action, as its menu item runs it.
    const row = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Row Actions" }))[0]!;
    row.activateAction("row.hide", null);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.hidden).toEqual(["ytjc8tj8w8ftnbf9h86s5k9jfk"]));
    await waitFor(() => expect(screen.queryByText("Land .table extension")).toBeNull());
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    await userEvent.click(await screen.findByText("Show All"));
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.hidden).toBeUndefined());
    expect(window).toBeDefined();
  });

  it("Colours: a rule added colours the whole row in a colour not yet used, and its colour is chosen from the list (D53)", async () => {
    await openSettings();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Colour" }));
    await waitFor(async () => {
      const rules = (await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.colors;
      expect(rules).toHaveLength(1);
      expect(rules![0]!.color).toBe("red");
      expect(rules![0]!.field).toBeUndefined();
    });
    // Its colour, from the drop-down showing Red.
    const downs = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Gtk.DropDown) as Gtk.DropDown[];
    const colour = downs.find((d) => (d.getSelectedItem() as Gtk.StringObject | null)?.getString() === "Red")!;
    colour.setSelected(4);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.colors?.[0]?.color).toBe("green"));
  });

  it("shows the view's own filter and sort, not each picker's first choice", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="mufe9nmjruiq5" />);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    await screen.findByText("Filters");
    // "Active by owner": status is active, sorted by owner.
    await waitFor(async () => expect(await shownChoices()).toEqual(["status", "is", "active", "owner", "Ascending"]));
  });

  it("Sorts: a sort added is moved earlier, and the view sorts by it first", async () => {
    await openSettings();
    // The field each sort is by, in order (a sort is the viewer's own arrangement until saved for everyone).
    const sortFields = async () =>
      ((await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Gtk.DropDown && w.getTooltipText() === "Field") as Gtk.DropDown[]).map(
        (d) => (d.getSelectedItem() as Gtk.StringObject | null)?.getString() ?? "",
      );
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Sort" }));
    await waitFor(async () => expect((await sortFields()).length).toBe(2));
    const [first, added] = await sortFields();
    expect(first).toBe("priority");
    // The first can't go earlier, nor the last later.
    const earlier = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Sort Earlier" })) as Gtk.Button[];
    const later = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Sort Later" })) as Gtk.Button[];
    expect(earlier.map((b) => b.getSensitive())).toEqual([false, true]);
    expect(later.map((b) => b.getSensitive())).toEqual([true, false]);
    await userEvent.click(earlier[1]!);
    await waitFor(async () => expect(await sortFields()).toEqual([added, "priority"]));
  });

  it("making a table a sheet is saved to the view", async () => {
    await openSettings();
    // The row and its switch both have the switch role; the switch is the control.
    const sheet = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Gtk.Switch)!;
    await userEvent.click(sheet);
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.find((v) => v.id === "juycicwios88m")?.coordinates).toBe(true);
    });
  });

  it("Columns: a column switched off leaves the view without it, and the last one stays", async () => {
    await openSettings();
    const fieldsOnDisk = async () => (await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.fields;
    const all = (await tasksOnDisk()).schema.fields.map((f) => f.name);
    const column = async (name: string) => {
      const rows = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).filter((w) => w instanceof Adw.SwitchRow) as Adw.SwitchRow[];
      return rows.find((r) => r.getTitle() === name)!;
    };
    expect(await fieldsOnDisk()).toBeUndefined();
    (await column("status")).setActive(false);
    await waitFor(async () => expect(await fieldsOnDisk()).toEqual(all.filter((n) => n !== "status")));
    // All shown again is written as no list at all, so a field added later shows too.
    (await column("status")).setActive(true);
    await waitFor(async () => expect(await fieldsOnDisk()).toBeUndefined());
    for (const name of all.slice(1)) {
      (await column(name)).setActive(false);
      await waitFor(async () => expect(await fieldsOnDisk()).not.toContain(name));
    }
    expect(await fieldsOnDisk()).toEqual([all[0]]);
    // The last one can't go: its switch is on again, and the view says why.
    (await column(all[0]!)).setActive(false);
    await screen.findByText("One column always shows.");
    await waitFor(async () => expect((await column(all[0]!)).getActive()).toBe(true));
    expect(await fieldsOnDisk()).toEqual([all[0]]);
  });

  it("Totals: a total chosen for a column is saved to the view and shown under it; None takes it away", async () => {
    await openSettings();
    const totalsOnDisk = async () => (await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.totals;
    await screen.findByText("Shown in a row under the table.");
    const total = async (title: string) => {
      const rows = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Adw.ComboRow) as Adw.ComboRow[];
      return rows.find((r) => r.getTitle() === title && choicesOf(r)[0] === "None")!;
    };
    const choicesOf = (row: Adw.ComboRow) => {
      const model = row.getModel() as Gtk.StringList;
      return Array.from({ length: model.getNItems() }, (_, i) => model.getString(i) ?? "");
    };
    // What the footer's own menu offers: sums and the like for a number, counts for text.
    expect(choicesOf(await total("priority"))).toEqual(["None", "Sum", "Average", "Smallest", "Largest", "Count values", "Count empty"]);
    expect(choicesOf(await total("title"))).toEqual(["None", "Count values", "Count empty"]);
    expect(await totalsOnDisk()).toBeUndefined();
    (await total("priority")).setSelected(2);
    await waitFor(async () => expect(await totalsOnDisk()).toEqual({ priority: "average" }));
    await screen.findByText("Avg");
    await waitFor(async () => expect((await total("priority")).getSelected()).toBe(2));
    (await total("title")).setSelected(1);
    await waitFor(async () => expect(await totalsOnDisk()).toEqual({ priority: "average", title: "count" }));
    (await total("priority")).setSelected(0);
    (await total("title")).setSelected(0);
    await waitFor(async () => expect(await totalsOnDisk()).toBeUndefined());
  });

  it("Totals aren't offered on a board, which has no row under it", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="mufe9nmjruiq5" />);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    await screen.findByText("Filters");
    expect(screen.queryByText("Totals")).toBeNull();
    expect(screen.queryByText("Shown in a row under the table.")).toBeNull();
  });

  it("Freeze Columns: the first column by default, and two chosen are written to the view (D58)", async () => {
    await openSettings();
    const rows = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Adw.ComboRow) as Adw.ComboRow[];
    const freeze = rows.find((r) => r.getTitle() === "Freeze Columns")!;
    expect((freeze.getSelectedItem() as Gtk.StringObject).getString()).toBe("First Column");
    freeze.setSelected(2);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.frozen).toEqual({ columns: 2 }));
    freeze.setSelected(1);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.frozen).toBeUndefined());
  });

  it("Freeze Rows: the header only by default, and two chosen are written to the view (D58)", async () => {
    await openSettings();
    const rows = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Adw.ComboRow) as Adw.ComboRow[];
    const freeze = rows.find((r) => r.getTitle() === "Freeze Rows")!;
    expect((freeze.getSelectedItem() as Gtk.StringObject).getString()).toBe("Header Only");
    freeze.setSelected(2);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.frozen).toEqual({ rows: 2 }));
    freeze.setSelected(0);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.frozen).toBeUndefined());
  });

  it("Totals are offered for the columns the view shows", async () => {
    await openSettings();
    const totalRows = async () => {
      const rows = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Adw.ComboRow) as Adw.ComboRow[];
      return rows.filter((r) => (r.getModel() as Gtk.StringList).getString(0) === "None" && r.getTitle() !== "Group By" && !r.getTitle().startsWith("Freeze")).map((r) => r.getTitle());
    };
    const all = (await tasksOnDisk()).schema.fields.map((f) => f.name);
    await waitFor(async () => expect(await totalRows()).toEqual(all));
    const status = ((await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).filter((w) => w instanceof Adw.SwitchRow) as Adw.SwitchRow[]).find((r) => r.getTitle() === "status")!;
    status.setActive(false);
    await waitFor(async () => expect(await totalRows()).toEqual(all.filter((n) => n !== "status")));
  });

  it("an added filter is this viewer's own until saved for everyone (D4)", async () => {
    await openSettings();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Filter" }));
    // Shown at once, and only for this viewer: the file is as it was.
    const save = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Save for Everyone" });
    expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.filter).toBeUndefined();
    await userEvent.click(save);
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.find((v) => v.id === "juycicwios88m")?.filter?.[0]?.field).toBe("title");
    });
    // Saved, it's no longer this viewer's own.
    await waitFor(() => expect(screen.queryByRole(Gtk.AccessibleRole.BUTTON, { name: "Save for Everyone" })).toBeNull());
  });

  it("Reset drops this viewer's filter, and the file never had it", async () => {
    await openSettings();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Filter" }));
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Reset" }));
    await waitFor(() => expect(screen.queryByRole(Gtk.AccessibleRole.BUTTON, { name: "Remove Filter" })).toBeNull());
    expect((await tasksOnDisk()).views.find((v) => v.id === "juycicwios88m")?.filter).toBeUndefined();
  });

  it("deleting a view asks first, then removes it from the file", async () => {
    await openSettings();
    await userEvent.click(await screen.findByText("Delete View"));
    expect(await screen.findByText("Delete the view “All tasks by priority”?")).toBeDefined();
    await userEvent.click(await screen.findByText("Delete"));
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.map((v) => v.id)).toEqual(["mufe9nmjruiq5"]);
    });
  });
});
