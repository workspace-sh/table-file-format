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

// Dragging a column's end edge, or a row's bottom edge: the size saved to
// the view (columnWidths, rowHeight), as the web's handles do.

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

  it("rows dragged taller keep their height, within bounds", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    await drag("resize-rows", 0, 30);
    await waitFor(async () => expect((await viewOnDisk()).rowHeight).toBe(74));
    await drag("resize-rows", 0, 1000);
    await waitFor(async () => expect((await viewOnDisk()).rowHeight).toBe(240));
  });
});
