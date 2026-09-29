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

// The demo edits a copy of a fixture, through its real widgets, and the
// test reads what was saved back from disk: what a person would see after
// closing the app and opening the file again.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
}

describe("editing on Linux saves to the file", () => {
  it("a cell clicked, retyped and entered is saved", async () => {
    await openTasks();
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Renamed task");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.rows.find((r) => r.id === "t1")?.title).toBe("Renamed task");
    });
  });

  it("a value the column can't hold is refused, and nothing is written", async () => {
    await openTasks();
    const priority = (await screen.findAllByText("2"))[0]!;
    await userEvent.click(priority);
    const entry = (await screen.findByDisplayValue("2")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "2.5");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(entry.hasCssClass("error")).toBe(true));
    expect(entry.getTooltipText()).toBe("“2.5” isn't a whole number.");
    const t = await tasksOnDisk();
    expect(t.rows.find((r) => r.id === "t2")?.priority).toBe(2);
  });

  it("a new row opens for typing, and is saved with what's typed", async () => {
    await openTasks();
    await userEvent.click(await screen.findByText("New Row"));
    // The new row's first cell, not the (also empty) search box.
    const entry = (await screen.findAllByDisplayValue("")).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    expect(entry).toBeDefined();
    await userEvent.type(entry, "Fresh task");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.rows.at(-1)?.title).toBe("Fresh task");
    });
  });
});
