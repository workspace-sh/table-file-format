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
  for (let i = 0; i < ROWS; i++) more += `${JSON.stringify({ id: `b${i}`, title: `Big ${i}`, project: "xsdxifzn73ohismzm8q5uri8fe", status: "todo", priority: 9, assignee: "sam" })}\n`;
  appendFileSync(join(bundle, "tables", "tasks", "rows", "0001.ndjson"), more);
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="juycicwios88m" />);
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

  it("a cell edited from the keyboard stays closed when its row is scrolled away and back", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const adjustment = scrollerOf(first).getVadjustment();
    first.grabFocus();
    await userEvent.keyboard(first, "Z");
    const entry = (await screen.findByDisplayValue("Z")) as Gtk.Entry;
    await userEvent.type(entry, "ed");
    await userEvent.keyboard(entry, "{Enter}");
    await screen.findAllByText("Zed");
    adjustment.setValue(adjustment.getUpper() - adjustment.getPageSize());
    await screen.findAllByText(`Big ${ROWS - 1}`);
    await waitFor(() => expect(screen.queryAllByText("Zed")).toHaveLength(0));
    adjustment.setValue(0);
    // Its text, not its editor.
    await screen.findAllByText("Zed");
    expect(screen.queryAllByDisplayValue("Zed")).toHaveLength(0);
  });

  it("a jump far down takes the rows it leaves for the ones it comes to: none is made again", async () => {
    await openTasks();
    const first = await cellOf("Big 0");
    const adjustment = scrollerOf(first).getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
    // A row's widget: the one among the body's rows (the box with many children) that holds the label.
    const rowOf = (label: Gtk.Widget) => {
      let w: Gtk.Widget = label;
      const many = (box: Gtk.Widget) => {
        let n = 0;
        for (let c = box.getFirstChild(); c && n <= 5; c = c.getNextSibling()) n++;
        return n > 5;
      };
      while (w.getParent() && !many(w.getParent()!)) w = w.getParent()!;
      return w;
    };
    // Every row the body holds, marked by name as a widget's own: a widget made again has none.
    const body = rowOf(first).getParent()!;
    const rows = () => {
      const all: Gtk.Widget[] = [];
      for (let c = body.getFirstChild(); c; c = c.getNextSibling()) if (c.getName() !== "") all.push(c);
      return all.filter((row) => row.getName() !== "GtkBox");
    };
    const before = rows();
    expect(before.length).toBeGreaterThan(5);
    for (const row of before) row.setName("built-before");
    adjustment.setValue(45_000);
    await screen.findAllByText("Big 1000");
    expect(screen.queryAllByText("Big 0")).toHaveLength(0);
    const after = rows();
    expect(after.length).toBeGreaterThan(5);
    // As many as there were or are now, whichever is fewer: the top has no rows above the screen to build.
    expect(after.filter((row) => row.getName() === "built-before")).toHaveLength(Math.min(before.length, after.length));
  });

  it("a cell being edited when its row is scrolled away leaves no editor or draft in the row that takes its widgets", async () => {
    await openTasks();
    const first = await cellOf("Big 0");
    const adjustment = scrollerOf(first).getVadjustment();
    first.grabFocus();
    await userEvent.keyboard(first, "Q");
    await screen.findByDisplayValue("Q");
    adjustment.setValue(45_000);
    await screen.findAllByText("Big 1000");
    // A row now has the widgets Big 0's had: not its editor, nor what was typed.
    await waitFor(() => expect(screen.queryAllByDisplayValue("Q")).toHaveLength(0));
    expect(screen.queryAllByText("Q")).toHaveLength(0);
  });

  it("Back puts the table where it was scrolled to", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const adjustment = scrollerOf(first).getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
    adjustment.setValue(45_000);
    await screen.findAllByText("Big 1000");
    // Said once the scrolling rests.
    await new Promise((resolve) => setTimeout(resolve, 500));
    // To another table (the sidebar has the file's name and its table's: the table is the later one).
    await userEvent.click((await screen.findAllByText("Projects")).at(-1)!);
    await waitFor(() => expect(screen.queryAllByText("Big 1000")).toHaveLength(0));
    const back = (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })) as Gtk.Button;
    await waitFor(() => expect(back.getSensitive()).toBe(true));
    await userEvent.click(back);
    // The view is shown afresh, and scrolled to where it was.
    const again = scrollerOf((await screen.findAllByText("Big 1000"))[0]!).getVadjustment();
    await waitFor(() => expect(Math.abs(again.getValue() - 45_000)).toBeLessThanOrEqual(2));
    expect(screen.queryAllByText("Land .table extension")).toHaveLength(0);
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
