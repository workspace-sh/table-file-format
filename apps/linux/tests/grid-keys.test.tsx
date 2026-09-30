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

// The keyboard in a table's grid: table-ui/shared's gridKey, as the web's
// grid has it. The focused cell is the one the keyboard is on.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-keys-"));
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

/** The cell a piece of text is in: the focusable box around it. */
async function cellOf(text: string): Promise<Gtk.Widget> {
  let w: Gtk.Widget | null = (await screen.findAllByText(text))[0]!;
  while (w && !w.getFocusable()) w = w.getParent();
  return w!;
}

const focused = (w: Gtk.Widget) => (w.getRoot() as unknown as Gtk.Window).getFocus();

/** The text in the focused cell. */
function focusedText(w: Gtk.Widget): string {
  const labels: string[] = [];
  const walk = (x: Gtk.Widget | null) => {
    for (let c = x?.getFirstChild() ?? null; c; c = c.getNextSibling()) {
      if (c instanceof Gtk.Label) labels.push(c.getLabel());
      walk(c);
    }
  };
  walk(focused(w));
  return labels.join(" ");
}

describe("the keyboard in a table on Linux", () => {
  it("arrows move between cells", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "{ArrowRight}");
    await waitFor(() => expect(focused(first)).not.toBe(first));
    const right = focused(first)!;
    await userEvent.keyboard(right, "{ArrowLeft}");
    await waitFor(() => expect(focused(first)).toBe(first));
  });

  it("down, then up, comes back to the same cell", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "{ArrowDown}");
    await waitFor(() => expect(focusedText(first)).not.toContain("Land .table extension"));
    await userEvent.keyboard(focused(first)!, "{ArrowUp}");
    await waitFor(() => expect(focused(first)).toBe(first));
  });

  it("a character typed on a cell replaces its text; Enter saves and goes down", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "Z");
    const entry = (await screen.findByDisplayValue("Z")) as Gtk.Entry;
    await userEvent.type(entry, "ed");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Zed"));
    // The grid has the keyboard again, a row down.
    await waitFor(() => {
      const now = focused(first)!;
      expect(now.getFocusable() && !(now instanceof Gtk.Text)).toBe(true);
      expect(focusedText(first)).not.toContain("Zed");
    });
  });

  it("Enter opens the cell as it is, and Escape gives the grid the keyboard back", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "{Enter}");
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.keyboard(entry, "{Escape}");
    await waitFor(async () => expect(focused(await cellOf("Land .table extension"))).toBe(await cellOf("Land .table extension")));
    expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Land .table extension");
  });

  it("Tab in an editor saves and moves along the row", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "{Enter}");
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Tabbed");
    await userEvent.keyboard(entry, "{Tab}");
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Tabbed"));
    await waitFor(() => expect(focusedText(first)).toContain("Table file format spike"));
  });

  it("Delete empties the cell", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "{End}");
    await waitFor(() => expect(focusedText(first)).toContain("leslie"));
    await userEvent.keyboard(focused(first)!, "{Delete}");
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.assignee).toBeUndefined());
  });
});

