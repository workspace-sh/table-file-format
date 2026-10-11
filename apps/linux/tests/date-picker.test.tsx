import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const { calendar: found, hour } = await picker("Choose a Date");
    const calendar = found!;
    // A date has no time to pick.
    expect(hour).toBeUndefined();
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

// A time, and a date and time, have an hour and a minute to pick too. The projects
// table is given one of each, on its first row.
const KICKOFF = "2026-09-22T14:30:00Z";

function withTimes() {
  const table = join(bundle, "tables", "projects");
  const schema = JSON.parse(readFileSync(join(table, "schema.json"), "utf8"));
  schema.fields.push({ name: "kickoff", type: "datetime", format: "iso" }, { name: "standup", type: "time" }, { name: "review", type: "datetime", format: "iso" });
  writeFileSync(join(table, "schema.json"), JSON.stringify(schema, null, 2));
  // The view shows the three, and little else.
  const views = JSON.parse(readFileSync(join(table, "views.json"), "utf8"));
  for (const view of Array.isArray(views) ? views : views.views) if (view.id === "v1") view.fields = ["title", "kickoff", "standup", "review"];
  writeFileSync(join(table, "views.json"), JSON.stringify(views, null, 2));
  const rows = readFileSync(join(table, "rows.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  Object.assign(rows.find((r) => r.id === "p1"), { kickoff: KICKOFF, standup: "09:30:15" });
  writeFileSync(join(table, "rows.ndjson"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const p1 = async () => (await parseTable(join(bundle, "tables", "projects"))).rows.find((r) => r.id === "p1")!;

/** The picker beside the entry being edited, and what is in it. */
async function picker(tooltip: string) {
  const button = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON)).find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === tooltip) as Gtk.MenuButton;
  expect(button, tooltip).toBeDefined();
  const found: { calendar?: Gtk.Calendar; spins: Gtk.SpinButton[] } = { spins: [] };
  const walk = (w: Gtk.Widget) => {
    if (w instanceof Gtk.Calendar) return void (found.calendar = w);
    if (w instanceof Gtk.SpinButton) return void found.spins.push(w);
    for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
  };
  walk(button.getPopover()!);
  return { button, calendar: found.calendar, hour: found.spins[0], minute: found.spins[1] };
}

/** Open the first row's cell that shows `text` (or the first empty one), and give its entry. */
async function openCell(text: string): Promise<Gtk.Entry> {
  const label = (await screen.findAllByText(text))[0]!;
  let cell: Gtk.Widget | null = label;
  while (cell && !cell.getFocusable()) cell = cell.getParent();
  await userEvent.click(label);
  let entry: Gtk.Entry | undefined;
  await waitFor(() => {
    entry = undefined;
    const walk = (w: Gtk.Widget) => {
      if (w instanceof Gtk.Entry) entry = w;
      for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
    };
    walk(cell!);
    expect(entry, `the entry of the cell showing ${text}`).toBeDefined();
  });
  return entry!;
}

describe("a time on Linux", () => {
  it("a time cell has an hour and a minute to pick, and no calendar; its seconds are kept", async () => {
    withTimes();
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    const entry = await openCell("09:30:15");
    expect(entry.getText()).toBe("09:30:15");
    const { button, calendar, hour, minute } = await picker("Choose a Time");
    expect(calendar).toBeUndefined();
    expect([hour!.getValueAsInt(), minute!.getValueAsInt()]).toEqual([9, 30]);
    button.popup();
    hour!.setValue(16);
    await waitFor(() => expect(entry.getText()).toBe("16:30:15"));
    minute!.setValue(5);
    await waitFor(() => expect(entry.getText()).toBe("16:05:15"));
    // Not saved while the picker is open.
    expect((await p1()).standup).toBe("09:30:15");
    button.getPopover()!.emit("closed");
    await waitFor(async () => expect((await p1()).standup).toBe("16:05:15"));
  });

  it("a date and time has both, shown in the viewer's own time and saved in UTC", async () => {
    withTimes();
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    const entry = await openCell("2026-09-22");
    expect(entry.getText()).toBe(KICKOFF);
    const { button, calendar, hour, minute } = await picker("Choose a Date and Time");
    const local = new Date(KICKOFF);
    expect([calendar!.getYear(), calendar!.getMonth(), calendar!.getDay()]).toEqual([local.getFullYear(), local.getMonth(), local.getDate()]);
    expect([hour!.getValueAsInt(), minute!.getValueAsInt()]).toEqual([local.getHours(), local.getMinutes()]);
    // Opening the picker writes nothing over what is there.
    button.popup();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(entry.getText()).toBe(KICKOFF);
    // An hour later, by the viewer's clock, is an hour later in UTC.
    // (Where that would be past midnight the hour wraps to the same day's first: an hour earlier is used there.)
    const step = local.getHours() === 23 ? -1 : 1;
    hour!.setValue(local.getHours() + step);
    await waitFor(() => expect(entry.getText()).toBe(step === 1 ? "2026-09-22T15:30:00Z" : "2026-09-22T13:30:00Z"));
    // Another day keeps the time.
    calendar!.selectDay(GLib.DateTime.newLocal(2026, 10, 3, 0, 0, 0)!);
    await waitFor(() => expect(entry.getText()).toMatch(/^2026-10-0[234]T\d\d:30:00Z$/));
    const picked = new Date(entry.getText());
    expect([picked.getFullYear(), picked.getMonth() + 1, picked.getDate(), picked.getMinutes()]).toEqual([2026, 10, 3, local.getMinutes()]);
    button.getPopover()!.emit("closed");
    await waitFor(async () => expect((await p1()).kickoff).toBe(picked.toISOString().replace(".000Z", "Z")));
  });

  it("an empty date and time stays empty until something is picked, then starts from now", async () => {
    withTimes();
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    const entry = await openCell("—");
    const { button, calendar } = await picker("Choose a Date and Time");
    button.popup();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(entry.getText()).toBe("");
    calendar!.selectDay(GLib.DateTime.newLocal(2027, 2, 14, 0, 0, 0)!);
    await waitFor(() => expect(entry.getText()).not.toBe(""));
    const picked = new Date(entry.getText());
    expect([picked.getFullYear(), picked.getMonth() + 1, picked.getDate(), picked.getSeconds()]).toEqual([2027, 2, 14, 0]);
    expect(Math.abs(picked.getHours() * 60 + picked.getMinutes() - (new Date().getHours() * 60 + new Date().getMinutes()))).toBeLessThanOrEqual(2);
  });

  it("typing a date and time isn't rewritten by the picker following it", async () => {
    withTimes();
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v1" />);
    const entry = await openCell("—");
    await userEvent.type(entry, "2026-11-05T08:15");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(entry.getText()).toBe("2026-11-05T08:15");
    // And the picker has followed: it shows that day and time.
    const { calendar, hour, minute } = await picker("Choose a Date and Time");
    expect([calendar!.getMonth() + 1, calendar!.getDay(), hour!.getValueAsInt(), minute!.getValueAsInt()]).toEqual([11, 5, 8, 15]);
  });
});
