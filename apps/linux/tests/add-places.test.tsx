import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, screenshot } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// What's there looks solid, and the places where something could be added
// recede: a row's menu, the "+" for a field and "New Row" are faint until
// they're pointed at, and none of them is inside the table's lines.

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
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" newFilesIn={dir} />);
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
  it("a row's menu is after the row's lines, and comes up when the row is pointed at", async () => {
    await openTasks();
    const menu = up((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Row Actions" }))[0]!, Gtk.MenuButton);
    const row = menu.getParent()!;
    // The cells are in a box of their own, which has the row's rule; the menu follows it.
    expect(row.getFirstChild()).not.toBe(menu);
    expect(row.getLastChild()).toBe(menu);
    const rest = await drawn(menu, null);
    expect(await drawn(menu, row)).not.toBe(rest);
    expect(await drawn(menu, null)).toBe(rest);
  });

  it("New Row is a band under the last row that fills when pointed at", async () => {
    await openTasks();
    const band = up((await screen.findAllByText("New Row"))[0]!, Gtk.Button);
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
