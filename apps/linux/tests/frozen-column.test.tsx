import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, waitFor } from "@gtkx/testing";
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
});
