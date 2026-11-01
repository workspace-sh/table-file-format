import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { applyView } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A view's frozen rows (D58): once the table has gone up under the window's top, the header and the
// view's first rows stay there, over the rows scrolling on beneath.

let dir: string;
let books: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-frozen-rows-"));
  cpSync(join(fixturesDir()!, "library.table"), join(dir, "library.table"), { recursive: true });
  books = join(dir, "library.table", "tables", "books");
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

function named(root: Gtk.Widget, name: string): Gtk.Widget | null {
  if (root.getName() === name) return root;
  for (let c = root.getFirstChild(); c; c = c.getNextSibling()) {
    const found = named(c, name);
    if (found) return found;
  }
  return null;
}

function labels(root: Gtk.Widget, out: string[] = []): string[] {
  if (root instanceof Gtk.Label) out.push(root.getLabel());
  for (let c = root.getFirstChild(); c; c = c.getNextSibling()) labels(c, out);
  return out;
}

describe("frozen rows on Linux", () => {
  it("scrolled down, the header and the view's first two rows stay at the window's top; at rest they're drawn once", async () => {
    const viewsFile = join(books, "views.json");
    const views = JSON.parse(readFileSync(viewsFile, "utf8")) as { id: string }[];
    writeFileSync(viewsFile, JSON.stringify(views.map((v) => (v.id === "hnmryzi51j6jz" ? { ...v, frozen: { rows: 2 } } : v))));
    const table = await parseTable(books);
    const firstTwo = applyView(table, table.views.find((v) => v.id === "hnmryzi51j6jz")!).slice(0, 2).map((r) => String(r.title));
    const library = await loadLibrary([join(dir, "library.table")]);
    await render(<App library={library} initialTable="library/books" initialView="hnmryzi51j6jz" />);
    const first = (await screen.findAllByText(firstTwo[0]!))[0]!;
    const scroller = scrollerOf(first);
    const band = named(scroller.getParent()!, "frozen-band")!;
    expect(band).not.toBeNull();
    expect(band.getVisible()).toBe(false);
    const down = scroller.getVadjustment();
    await waitFor(() => expect(down.getUpper()).toBeGreaterThan(down.getPageSize() + 3000));
    down.setValue(3000);
    await waitFor(() => expect(band.getVisible()).toBe(true));
    const shown = labels(band);
    expect(shown).toContain(firstTwo[0]);
    expect(shown).toContain(firstTwo[1]);
    // At the window's top, over the rows.
    const [found, bounds] = band.computeBounds(scroller);
    expect(found).toBe(true);
    expect(Math.round(bounds!.getY())).toBe(0);
    down.setValue(0);
    await waitFor(() => expect(band.getVisible()).toBe(false));
  });
});
