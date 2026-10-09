import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A table of thousands of rows: only the rows near the screen are built,
// the scroller is as long as the whole table, and the keyboard reaches a
// row that wasn't built.

const ROWS = 3000;
let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-large-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
  let more = "";
  for (let i = 0; i < ROWS; i++) more += `${JSON.stringify({ id: `b${i}`, title: `Big ${i}`, project: "p1", status: "todo", priority: 9, assignee: "sam" })}\n`;
  appendFileSync(join(bundle, "tables", "tasks", "rows.ndjson"), more);
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
}

async function cellOf(text: string): Promise<Gtk.Widget> {
  let w: Gtk.Widget | null = (await screen.findAllByText(text))[0]!;
  while (w && !w.getFocusable()) w = w.getParent();
  return w!;
}

function scrollerOf(w: Gtk.Widget): Gtk.ScrolledWindow {
  let x: Gtk.Widget | null = w;
  while (x && !(x instanceof Gtk.ScrolledWindow)) x = x.getParent();
  return x as Gtk.ScrolledWindow;
}

const focused = (w: Gtk.Widget) => (w.getRoot() as unknown as Gtk.Window).getFocus();

function textIn(w: Gtk.Widget | null): string {
  const labels: string[] = [];
  const walk = (x: Gtk.Widget | null) => {
    for (let c = x?.getFirstChild() ?? null; c; c = c.getNextSibling()) {
      if (c instanceof Gtk.Label) labels.push(c.getLabel());
      walk(c);
    }
  };
  walk(w);
  return labels.join(" ");
}

describe("a large table on Linux", () => {
  it("builds only the rows near the screen, in a scroller as long as the table", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const built = screen.queryAllByText(/^Big \d+$/).length;
    expect(built).toBeGreaterThan(5);
    expect(built).toBeLessThan(200);
    expect(screen.queryAllByText(`Big ${ROWS - 1}`)).toHaveLength(0);
    // Every row is 44 tall and ruled, built or not.
    await waitFor(() => expect(scrollerOf(first).getVadjustment().getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
  });

  it("scrolled to the end, the last rows are built and the first are not", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const adjustment = scrollerOf(first).getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
    adjustment.setValue(adjustment.getUpper() - adjustment.getPageSize());
    await screen.findAllByText(`Big ${ROWS - 1}`);
    expect(screen.queryAllByText("Big 0")).toHaveLength(0);
    expect(screen.queryAllByText(/^Big \d+$/).length).toBeLessThan(200);
  });

  it("Ctrl+Down goes to the last row, though it wasn't built", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    // The first row is gone once the last is on screen, so hold the scroller.
    const scroller = scrollerOf(first);
    first.grabFocus();
    await userEvent.keyboard(first, "{Control>}{ArrowDown}{/Control}");
    await waitFor(() => expect(textIn(focused(scroller) ?? null)).toContain(`Big ${ROWS - 1}`));
    // And back, to a row that was dropped on the way.
    await userEvent.keyboard(focused(scroller)!, "{Control>}{ArrowUp}{/Control}");
    await waitFor(() => expect(textIn(focused(scroller) ?? null)).toContain("Land .table extension"));
    expect(scroller.getVadjustment().getValue()).toBeLessThan(45);
  });
});
