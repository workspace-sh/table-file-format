import * as Adw from "@gtkx/gi/adw";
import * as Gio from "@gtkx/gi/gio";
import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, screenshot, waitFor } from "@gtkx/testing";
import { loadDisplay } from "@workspace.sh/table-app";
import { jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
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

  // From the row's menu: fit it to what it holds, and put a resized row back.
  async function rowMenuOf(title: string): Promise<Gtk.MenuButton> {
    let row: Gtk.Widget | null = (await screen.findAllByText(title))[0]!;
    let found: Gtk.MenuButton | undefined;
    while (row && !found) {
      for (let c = row.getFirstChild(); c; c = c.getNextSibling()) if (c instanceof Gtk.MenuButton && c.getTooltipText() === "Row Actions") found = c;
      row = row.getParent();
    }
    expect(found, `the row menu of "${title}"`).toBeDefined();
    return found!;
  }
  const menuLabels = (button: Gtk.MenuButton): string[] => {
    const out: string[] = [];
    const walk = (model: Gio.MenuModel) => {
      for (let i = 0; i < model.getNItems(); i++) {
        const label = model.getItemAttributeValue(i, "label", GLib.VariantType.new("s"));
        if (label) out.push(label.getString()[0]);
        const section = model.getItemLink(i, "section");
        if (section) walk(section);
      }
    };
    walk((button.getPopover() as Gtk.PopoverMenu).getMenuModel()!);
    return out;
  };

  it("the row menu fits a row to what it holds, and puts a resized row back to the view's height", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    const landed = (await parseTable(join(bundle, "tables", "tasks"))).rows.find((r) => r.title === "Land .table extension")!;
    const menu = () => rowMenuOf("Land .table extension");
    expect(menuLabels(await menu())).toContain("Fit Row to Content");
    expect(menuLabels(await menu())).not.toContain("Reset Row Height");
    (await menu()).activateAction("row.fit", null);
    // Two lines: its title wraps in its column, as the grip's double click finds.
    await waitFor(async () => expect((await viewOnDisk()).rowHeights).toEqual({ [landed.id]: 64 }));
    // Now it can be put back, and only it.
    await waitFor(async () => expect(menuLabels(await menu())).toContain("Reset Row Height"));
    expect(menuLabels(await rowMenuOf("Markdown editor polish"))).not.toContain("Reset Row Height");
    (await menu()).activateAction("row.reset-height", null);
    await waitFor(async () => expect((await viewOnDisk()).rowHeights).toBeUndefined());
    await waitFor(async () => expect(menuLabels(await menu())).not.toContain("Reset Row Height"));
    // A row that already fits is left as it is: nothing is written for it.
    (await rowMenuOf("App icon")).activateAction("row.fit", null);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await viewOnDisk()).rowHeights).toBeUndefined();
  });

  it("Display's Resize handles: as Grabbers the selected row's grip is a short bar centred under its cell, and that is kept", async () => {
    const settings = jsonFileStore(join(dir, "settings.json"));
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" settings={settings} />);
    await selectFirstRow();
    const grip = async () => (await screen.findAllByName("resize-row-grip"))[0]!;
    const sizeOf = async () => {
      const [, bounds] = (await grip()).computeBounds((await grip()).getParent()!);
      return [Math.round(bounds!.getWidth()), Math.round(bounds!.getHeight())];
    };
    // Pills, as it has been: with its bars.
    expect(await sizeOf()).toEqual([28, 8]);
    expect((await grip()).getFirstChild()).not.toBeNull();
    const pillAt = (await screen.findAllByName("resize-row"))[0]!.getMarginStart();
    ((await grip()).getRoot() as unknown as Gtk.ApplicationWindow).activateAction("win.display", null);
    let handles: Adw.ComboRow | undefined;
    await waitFor(async () => {
      handles = (await screen.findAllByRole(Gtk.AccessibleRole.COMBO_BOX)).find((w) => w instanceof Adw.ComboRow && w.getTitle() === "Resize handles") as Adw.ComboRow | undefined;
      expect(handles).toBeDefined();
    });
    handles!.setSelected(1);
    // Back to the table, and to the cell.
    let dialog: Gtk.Widget | null = handles!;
    while (dialog && !(dialog instanceof Adw.Dialog)) dialog = dialog.getParent();
    (dialog as Adw.Dialog).close();
    await waitFor(() => expect(screen.queryAllByRole(Gtk.AccessibleRole.COMBO_BOX).filter((w) => w instanceof Adw.ComboRow)).toHaveLength(0));
    await selectFirstRow();
    await waitFor(async () => expect(await sizeOf()).toEqual([26, 9]));
    expect((await grip()).getFirstChild()).toBeNull();
    // Centred under the cell it is on, not at its start.
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    const at = (await screen.findAllByName("resize-row"))[0]!.getMarginStart();
    expect(at).toBe(pillAt - 4 + Math.round((cell!.getSizeRequest()[0] - 26) / 2));
    expect(loadDisplay(jsonFileStore(join(dir, "settings.json")))).toEqual({ resizeHandles: "grabbers" });
    // It still resizes its row.
    await drag("resize-row-grip", 0, 20);
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

  it("the line under a row is faint when pointed at, and full only while it is dragged", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await screen.findAllByText("Land .table extension");
    await waitFor(async () => expect(lines()).toHaveLength((await tasks()).length));
    const drawn = async (pointedAt: boolean) => {
      const line = lines()[1]!;
      if (pointedAt) line.setStateFlags(Gtk.StateFlags.PRELIGHT, false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { data } = await screenshot(line);
      if (pointedAt) line.unsetStateFlags(Gtk.StateFlags.PRELIGHT);
      return data;
    };
    const rest = await drawn(false);
    const pointed = await drawn(true);
    expect(pointed).not.toBe(rest);
    expect(await drawn(false)).toBe(rest);
    const gesture = getController(lines()[1]!, Gtk.GestureDrag);
    await fireEvent(gesture, "drag-begin", 0, 0);
    await fireEvent(gesture, "drag-update", 0, 0);
    await screen.findByText("1 line");
    const dragged = await drawn(false);
    expect(dragged).not.toBe(rest);
    expect(dragged).not.toBe(pointed);
    // The pointer is on it while it's dragged: still full.
    expect(await drawn(true)).toBe(dragged);
    await fireEvent(gesture, "drag-end", 0, 0);
    await waitFor(async () => expect(await drawn(false)).toBe(rest));
  });

  it("a column's edge is faint when pointed at, and full only while it is dragged", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    const handle = async () => (await screen.findAllByName("resize-column-status"))[0]!;
    const drawn = async (pointedAt: boolean) => {
      const edge = await handle();
      if (pointedAt) edge.setStateFlags(Gtk.StateFlags.PRELIGHT, false);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // At rest the edge itself draws nothing: it is seen as part of its header.
      const { data } = await screenshot(edge.getParent()!);
      if (pointedAt) edge.unsetStateFlags(Gtk.StateFlags.PRELIGHT);
      return data;
    };
    const rest = await drawn(false);
    const pointed = await drawn(true);
    expect(pointed).not.toBe(rest);
    const gesture = getController(await handle(), Gtk.GestureDrag);
    await fireEvent(gesture, "drag-begin", 0, 0);
    // Held, not yet moved: the header is the size it was, so only the line differs.
    await fireEvent(gesture, "drag-update", 0, 0);
    const dragged = await drawn(false);
    expect(dragged).not.toBe(rest);
    expect(dragged).not.toBe(pointed);
    expect(await drawn(true)).toBe(dragged);
    await fireEvent(gesture, "drag-end", 0, 0);
    await waitFor(async () => expect(await drawn(false)).toBe(rest));
  });
});

async function drag2(widget: Gtk.Widget, dy: number) {
  const gesture = getController(widget, Gtk.GestureDrag);
  await fireEvent(gesture, "drag-begin", 0, 0);
  await fireEvent(gesture, "drag-update", 0, dy);
  await fireEvent(gesture, "drag-end", 0, dy);
}
