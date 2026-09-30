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
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
  await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
  await screen.findByText("Filters");
}

/** Every drop-down's shown choice, in the order they're found. */
async function shownChoices(): Promise<string[]> {
  const downs = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).filter((w) => w instanceof Gtk.DropDown) as Gtk.DropDown[];
  return downs.map((d) => (d.getSelectedItem() as Gtk.StringObject | null)?.getString() ?? "");
}

describe("view settings on Linux", () => {
  it("shows the view's own filter and sort, not each picker's first choice", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v2" />);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    await screen.findByText("Filters");
    // "Active by owner": status is active, sorted by owner.
    await waitFor(async () => expect(await shownChoices()).toEqual(["status", "is", "active", "owner", "Ascending"]));
  });

  it("making a table a sheet is saved to the view", async () => {
    await openSettings();
    // The row and its switch both have the switch role; the switch is the control.
    const sheet = (await screen.findAllByRole(Gtk.AccessibleRole.SWITCH)).find((w) => w instanceof Gtk.Switch)!;
    await userEvent.click(sheet);
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.find((v) => v.id === "v1")?.coordinates).toBe(true);
    });
  });

  it("an added filter is saved, on the first field", async () => {
    await openSettings();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Filter" }));
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.find((v) => v.id === "v1")?.filter?.[0]?.field).toBe("title");
    });
  });

  it("deleting a view asks first, then removes it from the file", async () => {
    await openSettings();
    await userEvent.click(await screen.findByText("Delete View"));
    expect(await screen.findByText("Delete the view “All tasks by priority”?")).toBeDefined();
    await userEvent.click(await screen.findByText("Delete"));
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.views.map((v) => v.id)).toEqual(["v2"]);
    });
  });
});
