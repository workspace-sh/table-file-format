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

// Undo and Redo from the main menu and on Ctrl+Z: the table goes back, and
// the file with it. While typing, the same keys are the text's own.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-undo-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const titleOnDisk = async () => (await parseTable(join(bundle, "tables", "tasks"))).rows.find((r) => r.id === "t1")?.title;

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
}

async function windowOf(): Promise<Gtk.ApplicationWindow> {
  const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" });
  return button.getRoot() as unknown as Gtk.ApplicationWindow;
}

const enabled = (window: Gtk.ApplicationWindow, action: string) => window.getActionEnabled(action);

async function rename(from: string, to: string) {
  await userEvent.click(await screen.findByText(from));
  const entry = (await screen.findByDisplayValue(from)) as Gtk.Entry;
  await userEvent.clear(entry);
  await userEvent.type(entry, to);
  await userEvent.keyboard(entry, "{Enter}");
}

describe("undo on Linux", () => {
  it("Undo puts an edit back, on screen and in the file, and Redo makes it again", async () => {
    await openTasks();
    const window = await windowOf();
    expect(enabled(window, "undo")).toBe(false);
    await rename("Land .table extension", "Renamed task");
    await waitFor(async () => expect(await titleOnDisk()).toBe("Renamed task"));
    await waitFor(() => expect(enabled(window, "undo")).toBe(true));
    expect(enabled(window, "redo")).toBe(false);

    window.activateAction("win.undo", null);
    expect(await screen.findByText("Land .table extension")).toBeDefined();
    await waitFor(async () => expect(await titleOnDisk()).toBe("Land .table extension"));
    await waitFor(() => expect(enabled(window, "undo")).toBe(false));
    expect(enabled(window, "redo")).toBe(true);

    window.activateAction("win.redo", null);
    expect(await screen.findByText("Renamed task")).toBeDefined();
    await waitFor(async () => expect(await titleOnDisk()).toBe("Renamed task"));
  });

  it("while a cell is being typed in, Undo is the text's, and the table stays as it is", async () => {
    await openTasks();
    const window = await windowOf();
    await rename("Land .table extension", "Renamed task");
    await waitFor(async () => expect(await titleOnDisk()).toBe("Renamed task"));

    await userEvent.click(await screen.findByText("Renamed task"));
    const entry = (await screen.findByDisplayValue("Renamed task")) as Gtk.Entry;
    await userEvent.type(entry, " again");
    expect(window.getFocus()).toBeInstanceOf(Gtk.Text);
    window.activateAction("win.undo", null);
    await waitFor(() => expect(entry.getText()).not.toBe("Renamed task again"));
    // The table's own step is still there to take.
    expect(enabled(window, "undo")).toBe(true);
    expect(await titleOnDisk()).toBe("Renamed task");
  });
});
