import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadDisplay } from "@workspace.sh/table-app";
import { jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-display-"));
});

afterEach(async () => {
  await cleanup();
  Gtk.Widget.setDefaultDirection(Gtk.TextDirection.LTR);
  rmSync(dir, { recursive: true, force: true });
});

describe("display settings on Linux", () => {
  it("choosing long dates reformats date cells, and is kept for next time", async () => {
    const settings = jsonFileStore(join(dir, "settings.json"));
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    await render(<App library={library} initialTable="crm/deals" initialView="all" settings={settings} />);
    expect(await screen.findByText("2026-12-20")).toBeDefined();
    // Display… is in the main menu.
    ((await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow).activateAction("win.display", null);
    let dates: Adw.ComboRow | undefined;
    await waitFor(async () => {
      dates = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).find((w) => w instanceof Adw.ComboRow && w.getTitle() === "Dates") as Adw.ComboRow | undefined;
      expect(dates).toBeDefined();
    });
    // iso, short, long, weekday, relative: long is third.
    dates!.setSelected(2);
    await waitFor(async () => expect(screen.queryByText("2026-12-20")).toBeNull());
    expect(loadDisplay(jsonFileStore(join(dir, "settings.json")))).toEqual({ dateFormat: "long" });
  });

  it("an Arabic display language lays the app out right to left", async () => {
    const settings = jsonFileStore(join(dir, "settings.json"));
    settings.setItem("table-demo:display", JSON.stringify({ locale: "ar-EG" }));
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    await render(<App library={library} initialTable="crm/deals" initialView="all" settings={settings} />);
    await screen.findAllByText("Deals");
    expect(Gtk.Widget.getDefaultDirection()).toBe(Gtk.TextDirection.RTL);
  });

  it("About Tables says which build this is", async () => {
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    await render(<App library={library} initialTable="crm/deals" initialView="all" />);
    ((await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow).activateAction("win.about", null);
    // A date, the day's count and the commit; a test run has no build, and says so.
    expect(await screen.findByText(/^(\d{4}\.\d+\.\d+\.\d+(\+dev)? · [0-9a-f]{7}|unnumbered build)$/)).toBeDefined();
  });
});
