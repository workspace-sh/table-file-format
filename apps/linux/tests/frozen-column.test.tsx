import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
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
  Gtk.Widget.setDefaultDirection(Gtk.TextDirection.LTR);
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
  it("a view that freezes two columns keeps both where they are (D58), and one that freezes none scrolls them all", async () => {
    const views = join(dir, "projects.table", "tables", "projects", "views.json");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const all = JSON.parse(readFileSync(views, "utf8")) as { id: string; frozen?: { columns: number } }[];
    writeFileSync(views, JSON.stringify(all.map((v) => (v.id === "r1mmz6bdngh1qjdyc7a3u3n58c" ? { ...v, frozen: { columns: 2 } } : v))));
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const second = await screen.findByText("status");
    const later = await screen.findByText("owner");
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    const before = { second: startIn(second, scroller), later: startIn(later, scroller) };
    across.setValue(200);
    await waitFor(() => expect(startIn(later, scroller)).toBe(before.later - 200));
    // The second column has moved only as far as the first does: up to the window's edge.
    expect(before.second - startIn(second, scroller)).toBeLessThanOrEqual(13);
  });

  it("stays where it is while the other columns scroll sideways, header and all", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    // Seven columns: wider than the window, so it scrolls sideways.
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
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
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
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
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
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

describe("columns' lines down a wide table on Linux", () => {
  it("the first column's line stays with it, and a line that has gone under the first column is out of reach until it comes out", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    const line = async (name: string) => (await screen.findAllByName(`resize-column-line-${name}`))[0]!;
    const header = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      const start = startIn(at!, scroller);
      return { start, end: start + at!.getWidth() };
    };
    // Unscrolled, each line is on its column's end.
    for (const name of ["title", "status", "owner"]) expect(startIn(await line(name), scroller)).toBe((await header(name)).end - 4);
    const second = await line("status");
    expect(second.getVisible()).toBe(true);
    // Scrolled so the second column is under the first, and the third starts at its end.
    across.setValue(193);
    await waitFor(async () => expect((await header("owner")).start).toBe((await header("title")).end));
    // The first column's line is still on its end, at the window's edge now.
    expect(startIn(await line("title"), scroller)).toBe((await header("title")).end - 4);
    // The second column's is under the first column: it can't be taken there.
    expect(second.getVisible()).toBe(false);
    // The third's is where its column ends, past the first.
    expect((await line("owner")).getVisible()).toBe(true);
    expect(startIn(await line("owner"), scroller)).toBe((await header("owner")).end - 4);
    across.setValue(0);
    await waitFor(() => expect(second.getVisible()).toBe(true));
  });
});

describe("Back on Linux", () => {
  it("puts a table back where it was scrolled across to", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
    const across = scrollerOf((await screen.findAllByText("Workspace v1"))[0]!).getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    across.setValue(300);
    // It comes to rest on a column, and where it rests is said for history.
    await waitFor(() => expect(across.getValue()).not.toBe(300), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const rested = across.getValue();
    expect(rested).toBeGreaterThan(100);
    // To another table, and back.
    await userEvent.click((await screen.findAllByText("Tasks")).at(-1)!);
    await screen.findAllByText("Land .table extension");
    const back = (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })) as Gtk.Button;
    await waitFor(() => expect(back.getSensitive()).toBe(true));
    await userEvent.click(back);
    const again = scrollerOf((await screen.findAllByText("Workspace v1"))[0]!).getHadjustment();
    await waitFor(() => expect(again.getValue()).toBe(rested), { timeout: 3000 });
    // And it stays: nothing brings it back to the start.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(again.getValue()).toBe(rested);
  });
});

describe("a cell the keyboard moves to on Linux", () => {
  it("is brought whole into the window: out from under the first column, and in from past the window's end", async () => {
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    const header = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      const start = startIn(at!, scroller);
      return { start, end: start + at!.getWidth() };
    };
    let first: Gtk.Widget | null = title;
    while (first && !first.getFocusable()) first = first.getParent();
    first!.grabFocus();
    // End: the row's last cell, which was past the window's end. All of it is in the window now.
    await userEvent.keyboard(first!, "{End}");
    await waitFor(async () => expect((await header("Budget / month")).end).toBeLessThanOrEqual(across.getPageSize()));
    expect((await header("Budget / month")).end).toBe(across.getPageSize());
    // Back to the first column, then one along: the second column, which is under the first by now.
    const focused = () => (scroller.getRoot() as unknown as Gtk.Window).getFocus()!;
    await userEvent.keyboard(focused(), "{Home}");
    await waitFor(() => expect(focused()).toBe(first));
    expect((await header("status")).start).toBeLessThan((await header("title")).end);
    await userEvent.keyboard(first!, "{ArrowRight}");
    await waitFor(async () => expect((await header("status")).start).toBe((await header("title")).end));
  });
});

// Right to left the table starts at the window's right: the first column stays there,
// and GTK counts the scroll from the far end.
describe("a wide table's first column on Linux, right to left", () => {
  async function openArabic() {
    const settings = jsonFileStore(join(dir, "settings.json"));
    settings.setItem("table-demo:display", JSON.stringify({ locale: "ar-EG" }));
    const library = await loadLibrary([join(dir, "projects.table")]);
    await render(<App library={library} initialTable="projects/projects" initialView="r1mmz6bdngh1qjdyc7a3u3n58c" settings={settings} />);
    const title = (await screen.findAllByText("Workspace v1"))[0]!;
    const scroller = scrollerOf(title);
    const across = scroller.getHadjustment();
    await waitFor(() => expect(across.getUpper()).toBeGreaterThan(across.getPageSize() + 200));
    // It opens at its start: the right.
    await waitFor(() => expect(across.getValue()).toBe(across.getUpper() - across.getPageSize()));
    /** A column's header: where it starts (its right edge) and ends (its left), across the window. */
    const header = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      const end = startIn(at!, scroller);
      return { start: end + at!.getWidth(), end };
    };
    return { title, scroller, across, header, start: across.getUpper() - across.getPageSize() };
  }

  it("stays at the right while the other columns scroll under it", async () => {
    const { across, header, start } = await openArabic();
    const page = across.getPageSize();
    const before = { title: await header("title"), owner: await header("owner") };
    // The frame's margin and line are between it and the window's edge.
    expect(page - before.title.start).toBe(13);
    across.setValue(start - 200);
    await waitFor(async () => expect((await header("owner")).start).toBeGreaterThan(before.owner.start + 150));
    // The first column has moved only up to the window's edge.
    expect((await header("title")).start).toBe(page);
    across.setValue(0);
    await waitFor(async () => expect((await header("title")).start).toBe(page));
    // The last column has come into the window, past the first.
    expect((await header("Budget / month")).end).toBeGreaterThanOrEqual(0);
  });

  it("a column's line down the table is on its column's end, which is its left", async () => {
    const { scroller, header } = await openArabic();
    for (const name of ["title", "status", "owner"]) {
      const line = (await screen.findAllByName(`resize-column-line-${name}`))[0]!;
      // Six wide: four of it inside the column, two past its end.
      expect(startIn(line, scroller)).toBe((await header(name)).end - 2);
    }
  });

  it("a sideways scroll comes to rest with a column starting where the first column ends", async () => {
    const { across, header, start } = await openArabic();
    across.setValue(start - 150);
    await waitFor(async () => expect([(await header("status")).start, (await header("owner")).start, (await header("budget")).start]).toContain((await header("title")).end), {
      timeout: 3000,
    });
    const rested = across.getValue();
    expect(rested).not.toBe(start - 150);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(across.getValue()).toBe(rested);
    // A little way from the start goes back to it.
    across.setValue(start - 20);
    await waitFor(() => expect(across.getValue()).toBe(start), { timeout: 3000 });
  });

  it("the keyboard moving to a cell under the first column brings it out from under", async () => {
    const { title, across, header } = await openArabic();
    // Scrolled to the far end: the second and third columns are under the first, or past it.
    across.setValue(0);
    await waitFor(async () => expect((await header("owner")).end).toBeGreaterThanOrEqual((await header("title")).end));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const focusable = (label: Gtk.Widget) => {
      let cell: Gtk.Widget | null = label;
      while (cell && !cell.getFocusable()) cell = cell.getParent();
      return cell!;
    };
    // From the first column, one step towards the end is the second column's cell.
    const first = focusable(title);
    first.grabFocus();
    await userEvent.keyboard(first, "{ArrowLeft}");
    await waitFor(async () => expect((await header("status")).start).toBeLessThanOrEqual((await header("title")).end), { timeout: 3000 });
    expect((await header("status")).start).toBe((await header("title")).end);
  });
});
