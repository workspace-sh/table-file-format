import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A table taller than GTK can place rows exactly (some millions of pixels):
// its rows are laid out in a shorter body, and the scroller's travel is
// mapped onto the whole table. 40,000 rows at the tallest row height are
// 9.6 million pixels, past the 8 million the body is kept to.

const ROWS = 40_000;
let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-tall-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
  const tasks = join(bundle, "tables", "tasks");
  let rows = "";
  for (let i = 0; i < ROWS; i++) rows += `${JSON.stringify({ id: `b${i}`, title: `Big ${i}`, priority: 9 })}\n`;
  writeFileSync(join(tasks, "rows.ndjson"), rows);
  const views = JSON.parse(readFileSync(join(tasks, "views.json"), "utf8")) as { id: string; rowHeight?: number; sort?: unknown }[];
  views[0]!.rowHeight = 240;
  delete views[0]!.sort;
  writeFileSync(join(tasks, "views.json"), JSON.stringify(views, null, 2));
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

async function cellOf(text: string): Promise<Gtk.Widget> {
  let w: Gtk.Widget | null = (await screen.findAllByText(text))[0]!;
  while (w && !w.getFocusable()) w = w.getParent();
  return w!;
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

const shown = () => screen.queryAllByText(/^Big \d+$/).map((w) => Number((w as Gtk.Label).getLabel().slice(4)));

describe("a table taller than GTK lays out exactly", () => {
  it("is scrolled through a shorter body: the ends are the table's ends, and the middle its middle", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
    const first = await cellOf("Big 0");
    const scroller = scrollerOf(first);
    const adjustment = scroller.getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThan(7_000_000));
    // Kept to 8 million pixels, and whatever is above and below the rows.
    expect(adjustment.getUpper()).toBeLessThan(8_001_000);
    const range = adjustment.getUpper() - adjustment.getPageSize();

    adjustment.setValue(range / 2);
    await waitFor(() => {
      const rows = shown();
      expect(rows.length).toBeGreaterThan(0);
      expect(Math.abs(rows[0]! - ROWS / 2)).toBeLessThan(40);
    });

    adjustment.setValue(range);
    await screen.findAllByText(`Big ${ROWS - 1}`);

    adjustment.setValue(0);
    await screen.findAllByText("Big 0");
  });

  it.each([["in memory", undefined], ["in the index", 1000]] as const)("Ctrl+Down goes to the last row, and Ctrl+Up back to the first (held %s)", async (_how, indexedFrom) => {
    const library = await loadLibrary([bundle], [], indexedFrom === undefined ? {} : { indexedFrom });
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" {...(indexedFrom === undefined ? {} : { indexedFrom })} />);
    const first = await cellOf("Big 0");
    const scroller = scrollerOf(first);
    await waitFor(() => expect(scroller.getVadjustment().getUpper()).toBeGreaterThan(7_000_000));
    first.grabFocus();
    await userEvent.keyboard(first, "{Control>}{ArrowDown}{/Control}");
    await waitFor(() => expect(textIn(focused(scroller) ?? null)).toContain(`Big ${ROWS - 1}`));
    await userEvent.keyboard(focused(scroller)!, "{Control>}{ArrowUp}{/Control}");
    await waitFor(() => expect(textIn(focused(scroller) ?? null)).toContain("Big 0"));
  });
});
