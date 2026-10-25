import * as Adw from "@gtkx/gi/adw";
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

// The table's own commands in the main menu, as the Mac has them in its
// menu bar: New Row, Find in View, the view's settings, and its Cancel.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-commands-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));

async function openTasks(): Promise<Gtk.ApplicationWindow> {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="ffaisc1zows4dzhy7aq5jrebkx" />);
  return (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow;
}

describe("the table's commands in the main menu on Linux", () => {
  it("New Row adds a row at the end", async () => {
    const window = await openTasks();
    const before = (await tasksOnDisk()).rows.length;
    window.activateAction("win.new-row", null);
    await waitFor(async () => expect((await tasksOnDisk()).rows.length).toBe(before + 1));
  });

  it("Find in View puts the keyboard in the search box", async () => {
    const window = await openTasks();
    const search = (await screen.findAllByRole(Gtk.AccessibleRole.SEARCH_BOX)).find((w) => w instanceof Gtk.SearchEntry) as Gtk.SearchEntry;
    const within = (w: Gtk.Widget | null): boolean => {
      for (let x = w; x; x = x.getParent()) if (x === search) return true;
      return false;
    };
    // From a cell of the table.
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    cell!.grabFocus();
    await waitFor(() => expect(within(window.getFocus())).toBe(false));
    window.activateAction("win.find", null);
    await waitFor(() => expect(within(window.getFocus())).toBe(true));
  });

  it("the view's settings open from the menu, and Cancel puts the view back as it was", async () => {
    const window = await openTasks();
    window.activateAction("win.view-settings", null);
    await screen.findByText("Filters");
    const sheet = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Adw.SwitchRow && w.getTitle() === "Sheet") as Adw.SwitchRow;
    sheet.setActive(true);
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "ffaisc1zows4dzhy7aq5jrebkx")?.coordinates).toBe(true));
    (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Cancel" }) as Gtk.Button).activate();
    await waitFor(async () => expect((await tasksOnDisk()).views.find((v) => v.id === "ffaisc1zows4dzhy7aq5jrebkx")?.coordinates).toBeUndefined());
    await waitFor(() => expect(screen.queryAllByText("Filters")).toHaveLength(0));
  });
});
