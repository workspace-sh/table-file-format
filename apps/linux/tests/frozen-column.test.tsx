import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// On a wide window a table's first column stays put while the others
// scroll sideways under it, as on the web and the Mac.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-frozen-"));
  cpSync(join(fixturesDir()!, "projects.table"), join(dir, "projects.table"), { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function scrollerOf(w: Gtk.Widget): Gtk.ScrolledWindow {
  let x: Gtk.Widget | null = w;
  while (x && !(x instanceof Gtk.ScrolledWindow)) x = x.getParent();
  return x as Gtk.ScrolledWindow;
}

/** Where a widget's start is, across the scroller it's in. */
function startIn(widget: Gtk.Widget, scroller: Gtk.ScrolledWindow): number {
  const [found, bounds] = widget.computeBounds(scroller);
  expect(found).toBe(true);
  return Math.round(bounds!.getX());
}

describe("a wide table's first column on Linux", () => {
  it("stays where it is while the other columns scroll sideways, header and all", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    // Seven columns: wider than the window, so it scrolls sideways.
    await render(<App library={library} initialTable="projects/projects" initialView="v4" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const owner = (await screen.findAllByText("leslie"))[0]!;
    const titleHeader = await screen.findByText("title");
    const ownerHeader = await screen.findByText("owner");
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    const before = { title: startIn(title, scroller), owner: startIn(owner, scroller), titleHeader: startIn(titleHeader, scroller), ownerHeader: startIn(ownerHeader, scroller) };

    across.setValue(200);
    await waitFor(() => expect(startIn(owner, scroller)).toBe(before.owner - 200));
    expect(startIn(ownerHeader, scroller)).toBe(before.ownerHeader - 200);
    // The first column has moved only up to the window's edge: the frame's margin and line are off screen.
    expect(before.title - startIn(title, scroller)).toBeLessThanOrEqual(13);
    expect(startIn(title, scroller)).toBeGreaterThanOrEqual(0);
    expect(before.titleHeader - startIn(titleHeader, scroller)).toBeLessThanOrEqual(13);

    across.setValue(0);
    await waitFor(() => expect(startIn(owner, scroller)).toBe(before.owner));
    expect(startIn(title, scroller)).toBe(before.title);
  });

  it("a sideways scroll comes to rest with a column starting where the first column ends", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="v4" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    const end = across.getUpper() - across.getPageSize();
    // Where the first column ends and each other column starts, across the window: by their headers.
    const header = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      return at!;
    };
    const frozenEnd = async () => startIn(await header("title"), scroller) + (await header("title")).getWidth();
    const starts = async () => {
      const out: number[] = [];
      for (const name of ["status", "owner", "budget", "launched"]) out.push(startIn(await header(name), scroller));
      return out;
    };

    // Left between two columns, the table brings the nearer one to the edge.
    across.setValue(150);
    await waitFor(async () => expect(await starts()).toContain(await frozenEnd()), { timeout: 3000 });
    const rested = across.getValue();
    expect(rested).not.toBe(150);
    expect(rested).toBeGreaterThan(0);
    expect(rested).toBeLessThan(end);
    // And stays there.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(across.getValue()).toBe(rested);

    // A little way from the start goes back to it; the end is a place to rest too.
    across.setValue(20);
    await waitFor(() => expect(across.getValue()).toBe(0), { timeout: 3000 });
    across.setValue(end);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(across.getValue()).toBe(end);
  });

  it("in a narrow window, where the first column scrolls too, a column comes to rest at the window's edge", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="v4" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    (title.getRoot() as unknown as Gtk.Window).setDefaultSize(600, 700);
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getPageSize()).toBeLessThan(700));
    const header = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      return startIn(at!, scroller);
    };
    // The first column made wider than the rest, so it's its width that counts.
    const gesture = getController((await screen.findAllByName("resize-column-title"))[0]!, Gtk.GestureDrag);
    await fireEvent(gesture, "drag-begin", 0, 0);
    await fireEvent(gesture, "drag-update", 60, 0);
    await fireEvent(gesture, "drag-end", 60, 0);
    await waitFor(async () => expect((await header("owner")) - (await header("status"))).toBe((await header("status")) - (await header("title")) - 60));
    const second = await header("status");
    across.setValue(second - 30);
    await waitFor(async () => expect(await header("status")).toBe(0), { timeout: 3000 });
    expect(across.getValue()).toBe(second);
    // The first column went with the rest.
    expect(await header("title")).toBeLessThan(0);
  });
});
