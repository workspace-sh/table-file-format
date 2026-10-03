import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, waitFor } from "@gtkx/testing";
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
    let next: Gtk.Widget | null = cell!.getNextSibling();
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
    await waitFor(async () => expect(Object.values((await viewOnDisk()).rowHeights ?? {})).toEqual([44]));
  });
});
