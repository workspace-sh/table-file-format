import * as GLib from "@gtkx/gi/glib";
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

// A date is typed, or picked from a calendar beside the entry.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-dates-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const launchedOnDisk = async () => (await parseTable(join(bundle, "tables", "projects"))).rows.find((r) => r.id === "p1")?.launched;

describe("a date cell on Linux", () => {
  it("has a calendar: a day picked goes into the entry, and closing the calendar saves it", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    expect(await launchedOnDisk()).toBe("2026-01-15");
    await userEvent.click((await screen.findAllByText("2026-01-15"))[0]!);
    const entry = (await screen.findByDisplayValue("2026-01-15")) as Gtk.Entry;
    const button = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON)).find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === "Choose a Date") as Gtk.MenuButton;
    expect(button).toBeDefined();
    const calendar = (button.getPopover() as Gtk.Popover).getChild() as Gtk.Calendar;
    // It opens on the cell's own day.
    expect([calendar.getYear(), calendar.getMonth() + 1, calendar.getDay()]).toEqual([2026, 1, 15]);
    button.popup();
    calendar.selectDay(GLib.DateTime.newLocal(2026, 3, 9, 0, 0, 0)!);
    await waitFor(() => expect(entry.getText()).toBe("2026-03-09"));
    // Not saved while the calendar is open.
    expect(await launchedOnDisk()).toBe("2026-01-15");
    // Dismissed (a click outside it, or Escape): the test's window never really shows a popover, so it is told it closed.
    button.getPopover()!.emit("closed");
    await waitFor(async () => expect(await launchedOnDisk()).toBe("2026-03-09"));
    expect((await screen.findAllByText("2026-03-09")).length).toBeGreaterThan(0);
  });

  it("the keyboard going to the calendar's button doesn't end the edit; going elsewhere saves what was typed", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    await userEvent.click((await screen.findAllByText("2026-01-15"))[0]!);
    const entry = (await screen.findByDisplayValue("2026-01-15")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "2026-02-02");
    const button = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON)).find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === "Choose a Date") as Gtk.MenuButton;
    button.grabFocus();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await launchedOnDisk()).toBe("2026-01-15");
    expect(entry.getMapped()).toBe(true);
    // Another cell takes the keyboard: the edit is over, and saved.
    let other: Gtk.Widget | null = (await screen.findAllByText("Workspace v1"))[0]!;
    while (other && !other.getFocusable()) other = other.getParent();
    other!.grabFocus();
    await waitFor(async () => expect(await launchedOnDisk()).toBe("2026-02-02"));
  });

  it("a cell that isn't a date has no calendar", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    await userEvent.click((await screen.findAllByText("Workspace v1"))[0]!);
    await screen.findByDisplayValue("Workspace v1");
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON);
    expect(buttons.some((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === "Choose a Date")).toBe(false);
  });
});
