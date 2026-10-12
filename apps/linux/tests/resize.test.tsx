import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, screenshot, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Dragging a column's end edge, or the grip on the selected row: the size
// saved to the view (columnWidths, rowHeights), as the web's handles do.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-resize-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const viewOnDisk = async () => (await parseTable(join(bundle, "tables", "tasks"))).views.find((v) => v.id === "v1")!;

async function drag(name: string, dx: number, dy: number) {
  const handle = (await screen.findAllByName(name))[0]!;
  const gesture = getController(handle, Gtk.GestureDrag);
  await fireEvent(gesture, "drag-begin", 0, 0);
  await fireEvent(gesture, "drag-update", dx, dy);
  await fireEvent(gesture, "drag-end", dx, dy);
}

describe("resizing on Linux", () => {
  it("a column dragged wider keeps its width, saved to the view, and grows from there", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await drag("resize-column-title", 80, 0);
    let first = 0;
    await waitFor(async () => {
      first = (await viewOnDisk()).columnWidths?.title ?? 0;
      expect(first).toBeGreaterThan(80);
    });
    await drag("resize-column-title", 20, 0);
    await waitFor(async () => expect((await viewOnDisk()).columnWidths?.title).toBe(first + 20));
  });

  it("widening a column leaves the others as wide as they were, and the table scrolls sideways", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    const widthOf = async (name: string) => {
      let at: Gtk.Widget | null = await screen.findByText(name);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      return at!.getWidth();
    };
    let scroller: Gtk.Widget | null = await screen.findByText("status");
    while (scroller && !(scroller instanceof Gtk.ScrolledWindow)) scroller = scroller.getParent();
    const across = (scroller as Gtk.ScrolledWindow).getHadjustment();
    await waitFor(() => expect(across.getPageSize()).toBeGreaterThan(400));
    const before = { title: await widthOf("title"), status: await widthOf("status"), priority: await widthOf("priority") };
    // It fits: nothing to scroll.
    expect(across.getUpper()).toBe(across.getPageSize());
    await drag("resize-column-title", 120, 0);
    await waitFor(async () => expect(await widthOf("title")).toBe(before.title + 120));
    expect(await widthOf("status")).toBe(before.status);
    expect(await widthOf("priority")).toBe(before.priority);
    await waitFor(() => expect(across.getUpper()).toBe(across.getPageSize() + 120));
    // Narrower than it began gives its room to the rest, and the table fits again.
    await drag("resize-column-title", -200, 0);
    await waitFor(async () => expect(await widthOf("status")).toBeGreaterThan(before.status));
    await waitFor(() => expect(across.getUpper()).toBe(across.getPageSize()));
  });

  it("never narrower than a column can be", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await drag("resize-column-title", -1000, 0);
    await waitFor(async () => expect((await viewOnDisk()).columnWidths?.title).toBe(60));
  });

  async function selectFirstRow() {
    let w: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (w && !w.getFocusable()) w = w.getParent();
    w!.grabFocus();
  }

  it("a row has no grip until one of its cells is selected, and then only that row does", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    expect(screen.queryAllByName("resize-row-grip")).toHaveLength(0);
    await selectFirstRow();
    await waitFor(() => expect(screen.queryAllByName("resize-row-grip")).toHaveLength(1));
  });

  it("the grip hangs under the selected cell, wherever in the row it is", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    cell!.grabFocus();
    const startOf = async () => (await screen.findAllByName("resize-row"))[0]!.getMarginStart();
    await waitFor(() => expect(screen.queryAllByName("resize-row")).toHaveLength(1));
    const first = await startOf();
    // The first column is laid over the row's start (it stays put when the rest scroll): the next cell is the row's own first.
    let row: Gtk.Widget | null = cell!.getParent();
    while (row && !(row instanceof Gtk.Overlay)) row = row.getParent();
    let next: Gtk.Widget | null = (row as Gtk.Overlay).getChild()!.getFirstChild();
    while (next && !next.getFocusable()) next = next.getNextSibling();
    next!.grabFocus();
    await waitFor(async () => expect(await startOf()).toBe(first + cell!.getSizeRequest()[0]));
  });

  it("the selected row dragged taller keeps its own height, in whole lines, within bounds", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await selectFirstRow();
    await drag("resize-row-grip", 0, 20);
    await waitFor(async () => {
      const heights = (await viewOnDisk()).rowHeights ?? {};
      expect(Object.values(heights)).toEqual([64]);
    });
    expect((await viewOnDisk()).rowHeight).toBeUndefined();
    const landed = (await parseTable(join(bundle, "tables", "tasks"))).rows.find((r) => r.title === "Land .table extension")!;
    expect(Object.keys((await viewOnDisk()).rowHeights ?? {})).toEqual([landed.id]);
    await drag("resize-row-grip", 0, 1000);
    await waitFor(async () => expect(Object.values((await viewOnDisk()).rowHeights ?? {})).toEqual([224]));
  });

  it("a double click on the grip fits the row to what it holds", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await selectFirstRow();
    await drag("resize-row-grip", 0, 60);
    await waitFor(async () => expect(Object.values((await viewOnDisk()).rowHeights ?? {})).toEqual([104]));
    const grip = (await screen.findAllByName("resize-row-grip"))[0]!;
    await fireEvent(getController(grip, Gtk.GestureClick), "pressed", 1, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(Object.values((await viewOnDisk()).rowHeights ?? {})).toEqual([104]);
    await fireEvent(getController(grip, Gtk.GestureClick), "pressed", 2, 0, 0);
    // Two lines: the table's six columns give a little to fit the window, and the title wraps in what's left.
    await waitFor(async () => expect(Object.values((await viewOnDisk()).rowHeights ?? {})).toEqual([64]));
  });

  // With a pointer, a row resizes from the line under it too, as a column does from its line.
  const lines = () => screen.queryAllByName("resize-row-line");
  const tasks = async () => (await parseTable(join(bundle, "tables", "tasks"))).rows;
  /** The row a line is under: the one whose title is drawn in it. */
  const rowOf = async (line: Gtk.Widget) => {
    const texts: string[] = [];
    const walk = (w: Gtk.Widget) => {
      if (w instanceof Gtk.Label) texts.push(w.getText());
      for (let c = w.getFirstChild(); c; c = c.getNextSibling()) walk(c);
    };
    walk(line.getParent()!);
    return (await tasks()).find((r) => texts.includes(String(r.title)))!;
  };

  it("every row has a line under it to drag, selected or not, and the selected row keeps its grip", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    await waitFor(async () => expect(lines()).toHaveLength((await tasks()).length));
    expect(screen.queryAllByName("resize-row-grip")).toHaveLength(0);
    await selectFirstRow();
    await waitFor(() => expect(screen.queryAllByName("resize-row-grip")).toHaveLength(1));
    // The line is as wide as the row's cells (it stops with them, short of the "+" column), at its bottom edge.
    const line = lines()[0]!;
    const row = line.getParent() as Gtk.Overlay;
    expect(line.getWidth()).toBe(row.getChild()!.getWidth());
    expect(line.getWidth()).toBeLessThan(row.getWidth());
    const [, bounds] = line.computeBounds(row);
    expect(Math.round(bounds!.getY() + bounds!.getHeight())).toBe(row.getHeight());
    expect(Math.round(bounds!.getHeight())).toBe(6);
  });

  it("a row's line dragged resizes that row in whole lines, counting them at the row's start as it goes", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    await waitFor(async () => expect(lines()).toHaveLength((await tasks()).length));
    // The third row's, with nothing selected.
    const third = await rowOf(lines()[2]!);
    const gesture = getController(lines()[2]!, Gtk.GestureDrag);
    await fireEvent(gesture, "drag-begin", 0, 0);
    await fireEvent(gesture, "drag-update", 0, 45);
    // While it is dragged: its lines are counted, it has no grip, and nothing is saved yet.
    await screen.findByText("3 lines");
    expect(screen.queryAllByName("resize-row-grip")).toHaveLength(0);
    expect((await viewOnDisk()).rowHeights).toBeUndefined();
    await fireEvent(gesture, "drag-update", 0, 22);
    await screen.findByText("2 lines");
    await fireEvent(gesture, "drag-end", 0, 22);
    await waitFor(async () => expect((await viewOnDisk()).rowHeights).toEqual({ [third.id]: 64 }));
    await waitFor(() => expect(screen.queryByText("2 lines")).toBeNull());
  });

  it("a double click on a row's line fits the row to what it holds; a single press changes nothing", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    await waitFor(async () => expect(lines()).toHaveLength((await tasks()).length));
    const first = (await tasks()).find((r) => r.title === "Land .table extension")!;
    let at = -1;
    for (const [i, line] of lines().entries()) if ((await rowOf(line)).id === first.id) at = i;
    await drag2(lines()[at]!, 60);
    await waitFor(async () => expect((await viewOnDisk()).rowHeights).toEqual({ [first.id]: 104 }));
    const click = (presses: number) => fireEvent(getController(lines()[at]!, Gtk.GestureClick), "pressed", presses, 0, 0);
    await click(1);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect((await viewOnDisk()).rowHeights).toEqual({ [first.id]: 104 });
    await click(2);
    await waitFor(async () => expect((await viewOnDisk()).rowHeights).toEqual({ [first.id]: 64 }));
  });

  it("the line lights when it is pointed at, and while it is dragged", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    await waitFor(async () => expect(lines()).toHaveLength((await tasks()).length));
    const line = lines()[1]!;
    const drawn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return (await screenshot(line)).data;
    };
    const rest = await drawn();
    line.setStateFlags(Gtk.StateFlags.PRELIGHT, false);
    const pointed = await drawn();
    line.unsetStateFlags(Gtk.StateFlags.PRELIGHT);
    expect(pointed).not.toBe(rest);
    expect(await drawn()).toBe(rest);
    const gesture = getController(lines()[1]!, Gtk.GestureDrag);
    await fireEvent(gesture, "drag-begin", 0, 0);
    await fireEvent(gesture, "drag-update", 0, 0);
    await screen.findByText("1 line");
    expect(await (async () => (await screenshot(lines()[1]!)).data)()).toBe(pointed);
    await fireEvent(gesture, "drag-end", 0, 0);
  });
});

async function drag2(widget: Gtk.Widget, dy: number) {
  const gesture = getController(widget, Gtk.GestureDrag);
  await fireEvent(gesture, "drag-begin", 0, 0);
  await fireEvent(gesture, "drag-update", 0, dy);
  await fireEvent(gesture, "drag-end", 0, dy);
}
