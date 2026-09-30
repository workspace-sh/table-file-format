import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { SIDEBAR_KEY, type KeyValueStore } from "@workspace.sh/table-app";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A narrow window (the web's 760): the sidebar lays over the content,
// hidden until asked for, without touching the viewer's saved choice.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-narrow-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) };
}

async function splitView(): Promise<Adw.OverlaySplitView> {
  let w: Gtk.Widget | null = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" });
  while (w && !(w instanceof Adw.OverlaySplitView)) w = w.getParent();
  return w as Adw.OverlaySplitView;
}

async function openNarrow(settings: KeyValueStore) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" settings={settings} />);
  const window = (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.Window;
  window.setDefaultSize(600, 700);
  window.setSizeRequest(360, 294);
  await waitFor(async () => expect((await splitView()).getCollapsed()).toBe(true));
}

describe("a narrow window on Linux", () => {
  it("hides the sidebar over the content, and Show Sidebar brings it", async () => {
    const settings = memoryStore();
    await openNarrow(settings);
    expect((await splitView()).getShowSidebar()).toBe(false);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show Sidebar" }));
    await waitFor(async () => expect((await splitView()).getShowSidebar()).toBe(true));
    // Choosing a view puts it away again.
    await userEvent.click(await screen.findByText("Board by status"));
    await waitFor(async () => expect((await splitView()).getShowSidebar()).toBe(false));
  });

  it("Ctrl+B shows it over the content without saving a choice, and a wide window shows it again", async () => {
    const settings = memoryStore();
    await openNarrow(settings);
    const window = (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow;
    window.activateAction("win.toggle-sidebar", null);
    await waitFor(async () => expect((await splitView()).getShowSidebar()).toBe(true));
    window.activateAction("win.toggle-sidebar", null);
    await waitFor(async () => expect((await splitView()).getShowSidebar()).toBe(false));
    // Narrow toggling is the window's, not the viewer's saved choice.
    expect(settings.getItem(SIDEBAR_KEY) ?? "{}").not.toContain("collapsed");
    window.setDefaultSize(1280, 800);
    await waitFor(async () => expect((await splitView()).getCollapsed()).toBe(false));
    expect((await splitView()).getShowSidebar()).toBe(true);
  });
});
