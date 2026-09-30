import * as Adw from "@gtkx/gi/adw";
import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import type { KeyValueStore } from "@workspace.sh/table-app";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Back and forward between views, the app's commands and their keys, and
// the sidebar as this viewer left it: table-app's history, appCommands
// and sidebarPrefs, as the Mac has them.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-nav-"));
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

async function openTasks(settings?: KeyValueStore) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" settings={settings} />);
}

const button = (name: string) => screen.findByRole(Gtk.AccessibleRole.BUTTON, { name }) as Promise<Gtk.Button>;
/** The view's name, as its header bar shows it. */
async function title(): Promise<string> {
  let w: Gtk.Widget | null = await button("Back");
  while (w && !(w instanceof Adw.HeaderBar)) w = w.getParent();
  return ((w as Adw.HeaderBar).getTitleWidget() as Adw.WindowTitle).getTitle();
}

/** The window, from any widget in it. */
async function window(): Promise<Gtk.ApplicationWindow> {
  return (await button("Back")).getRoot() as unknown as Gtk.ApplicationWindow;
}

async function splitView(): Promise<Adw.OverlaySplitView> {
  let w: Gtk.Widget | null = await button("Back");
  while (w && !(w instanceof Adw.OverlaySplitView)) w = w.getParent();
  return w as Adw.OverlaySplitView;
}

describe("back and forward on Linux", () => {
  it("goes back to the view before, and forward again", async () => {
    await openTasks();
    expect((await button("Back")).getSensitive()).toBe(false);
    await userEvent.click(await screen.findByText("Board by status"));
    await waitFor(async () => expect((await button("Back")).getSensitive()).toBe(true));
    await userEvent.click(await button("Back"));
    await waitFor(async () => expect(await title()).toBe("All tasks by priority"));
    expect((await button("Forward")).getSensitive()).toBe(true);
    await userEvent.click(await button("Forward"));
    await waitFor(async () => expect(await title()).toBe("Board by status"));
  });

  it("skips a view that's since been deleted", async () => {
    await openTasks();
    await userEvent.click(await screen.findByText("Board by status"));
    await userEvent.click(await button("View Settings"));
    await userEvent.click(await screen.findByText("Delete View"));
    await userEvent.click(await screen.findByText("Delete"));
    await waitFor(async () => expect(await title()).toBe("All tasks by priority"));
    // Back would be the deleted board, then this very view: nowhere to go.
    await waitFor(async () => expect((await button("Back")).getSensitive()).toBe(false));
  });
});

describe("the app's commands on Linux", () => {
  it("have GNOME's keys", async () => {
    await openTasks();
    const app = (await window()).getApplication()!;
    expect(app.getAccelsForAction("win.go-back")).toEqual(["<Alt>Left"]);
    expect(app.getAccelsForAction("win.toggle-sidebar")).toEqual(["<Control>b"]);
    expect(app.getAccelsForAction("win.copy-link")).toEqual(["<Control><Alt>c"]);
  });

  it("Copy Link to View puts the view's address on the clipboard", async () => {
    await openTasks();
    (await window()).activateAction("win.copy-link", null);
    const text = await Gdk.Display.getDefault()!.getClipboard().readTextAsync();
    expect(text).toBe("projects.table#table=tasks&view=v1");
  });

  it("Ctrl+B's command hides the sidebar, and it stays hidden next time", async () => {
    const settings = memoryStore();
    await openTasks(settings);
    expect((await splitView()).getShowSidebar()).toBe(true);
    (await window()).activateAction("win.toggle-sidebar", null);
    await waitFor(async () => expect((await splitView()).getShowSidebar()).toBe(false));
    await cleanup();
    await openTasks(settings);
    expect((await splitView()).getShowSidebar()).toBe(false);
  });

  it("the Files side is remembered", async () => {
    const settings = memoryStore();
    await openTasks(settings);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.TOGGLE_BUTTON, { name: "Files" }));
    await cleanup();
    // Opened again as the viewer would, not at a named table (which lands on Tables, as a link does).
    await render(<App library={await loadLibrary([bundle])} settings={settings} />);
    const files = (await screen.findByRole(Gtk.AccessibleRole.TOGGLE_BUTTON, { name: "Files" })) as Gtk.ToggleButton;
    expect(files.getActive()).toBe(true);
  });
});

describe("leaving a view on Linux", () => {
  it("another view of the same table starts with no search", async () => {
    await openTasks();
    const search = (await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry;
    await userEvent.type(search, "fixtures");
    await userEvent.click(await screen.findByText("Board by status"));
    await waitFor(async () => expect(((await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry).getText()).toBe(""));
  });

  it("its settings close when Back leaves it", async () => {
    await openTasks();
    await userEvent.click(await screen.findByText("Board by status"));
    await userEvent.click(await button("View Settings"));
    await screen.findByText("Filters");
    (await window()).activateAction("win.go-back", null);
    await waitFor(() => expect(screen.queryByText("Filters")).toBeNull());
  });

  it("Copy Link to View carries the row whose page is open", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="v7" />);
    await userEvent.click(await screen.findByText("Table file format spike"));
    await screen.findByText("bodies/p2.md");
    (await window()).activateAction("win.copy-link", null);
    expect(await Gdk.Display.getDefault()!.getClipboard().readTextAsync()).toBe("projects.table#table=projects&row=p2&view=v7");
  });
});

