import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, screenshot, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// What's there looks solid, and the places where something could be added
// recede: the "+" for a field and "+ New row" are faint until they're
// pointed at, and neither is inside the table's lines. A row has no button
// of its own: its menu is a right-click, or the Menu key, as on the web.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-places-"));
  cpSync(join(fixturesDir()!, "projects.table"), join(dir, "projects.table"), { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function openTasks() {
  const library = await loadLibrary([join(dir, "projects.table")]);
  await render(<App library={library} initialTable="projects/tasks" initialView="ffaisc1zows4dzhy7aq5jrebkx" newFilesIn={dir} />);
}

function up<T extends Gtk.Widget>(from: Gtk.Widget, kind: abstract new (...args: never[]) => T): T {
  let w: Gtk.Widget | null = from;
  while (w && !(w instanceof kind)) w = w.getParent();
  return w as T;
}

/** A widget as it's drawn, pointed at or not: `:hover` in the stylesheet is GTK's prelight state. */
async function drawn(widget: Gtk.Widget, pointedAt: Gtk.Widget | null): Promise<string> {
  if (pointedAt) pointedAt.setStateFlags(Gtk.StateFlags.PRELIGHT, false);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { data } = await screenshot(widget);
  if (pointedAt) pointedAt.unsetStateFlags(Gtk.StateFlags.PRELIGHT);
  return data;
}

describe("places to add to, on Linux", () => {
  it("a row's lines stop at its last cell, and its menu takes no room", async () => {
    await openTasks();
    const menu = up((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Row Actions" }))[0]!, Gtk.MenuButton);
    // Laid over the row, never seen or pointed at: the row is its cells and nothing after them.
    expect(menu.getOpacity()).toBe(0);
    expect(menu.getCanTarget()).toBe(false);
    const row = menu.getParent() as Gtk.Overlay;
    const cells = row.getChild()!;
    // As wide as the header's columns, and the header is wider by the "+" after its last one.
    const add = up(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" }), Gtk.Button);
    const header = add.getParent()!;
    expect(cells.getWidth()).toBe(header.getFirstChild()!.getWidth());
    expect(header.getWidth()).toBe(cells.getWidth() + 40);
  });

  it("Shift+F10 on a cell opens its row's menu, as the Menu key does", async () => {
    await openTasks();
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    cell!.grabFocus();
    const menu = up((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Row Actions" }))[0]!, Gtk.MenuButton);
    expect(menu.getActive()).toBe(false);
    await userEvent.keyboard(cell!, "{Shift>}{F10}{/Shift}");
    await waitFor(() => expect(menu.getActive()).toBe(true));
  });

  it("+ New row is a band under the last row that comes up when pointed at", async () => {
    await openTasks();
    const band = up((await screen.findAllByText("+ New row"))[0]!, Gtk.Button);
    const rest = await drawn(band, null);
    expect(await drawn(band, band)).not.toBe(rest);
    expect(await drawn(band, null)).toBe(rest);
  });

  it("the + for a field is after the header's last column, and comes up when pointed at", async () => {
    await openTasks();
    const add = up(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" }), Gtk.Button);
    const header = add.getParent()!;
    expect(header.getLastChild()).toBe(add);
    expect(header.getFirstChild()).not.toBe(add);
    const rest = await drawn(add, null);
    expect(await drawn(add, add)).not.toBe(rest);
  });
});
