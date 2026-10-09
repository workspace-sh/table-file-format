import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseRowsText } from "@workspace.sh/table-core";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A table large enough to be held in the bundle's index (SPEC section 8)
// rather than in memory: its rows are read from index.sqlite a window at a
// time, edits go to the index and are saved back to rows.ndjson.

const ROWS = 3000;
let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-indexed-"));
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

const rowsOnDisk = () => parseRowsText(readFileSync(join(bundle, "tables", "tasks", "rows.ndjson"), "utf8"), []);

async function openTasks() {
  const library = await loadLibrary([bundle], [], { indexedFrom: 1000 });
  expect(library.tables["projects/tasks"]!.rows).toEqual([]);
  expect(library.tables["projects/tasks"]!.indexed).toBeDefined();
  // Small tables beside it are held in memory as ever.
  expect(library.tables["projects/projects"]!.rows.length).toBeGreaterThan(0);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" indexedFrom={1000} />);
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

describe("a table held in the index on Linux", () => {
  it("builds index.sqlite, then shows its rows and how many there are", async () => {
    await openTasks();
    await screen.findAllByText("Land .table extension");
    expect(existsSync(join(bundle, "index.sqlite"))).toBe(true);
    await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
    // A window of them, not all.
    expect(screen.queryAllByText(/^Big \d+$/).length).toBeLessThan(200);
    // Nothing was written by opening it.
    expect(rowsOnDisk()).toHaveLength(ROWS + 8);
  });

  it("scrolls to rows read from the index as they're wanted", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const adjustment = scrollerOf(first).getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
    adjustment.setValue(adjustment.getUpper() - adjustment.getPageSize());
    await screen.findAllByText(`Big ${ROWS - 1}`);
    expect(screen.queryAllByText("Big 0")).toHaveLength(0);
  });

  it("an edit shows, and is saved to rows.ndjson with every other row", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    await userEvent.keyboard(first, "Z");
    const entry = (await screen.findByDisplayValue("Z")) as Gtk.Entry;
    await userEvent.type(entry, "ed");
    await userEvent.keyboard(entry, "{Enter}");
    await screen.findAllByText("Zed");
    await waitFor(() => expect(rowsOnDisk().find((r) => r.id === "t1")?.title).toBe("Zed"), { timeout: 5000 });
    const saved = rowsOnDisk();
    expect(saved).toHaveLength(ROWS + 8);
    expect(saved.at(-1)).toEqual({ id: `b${ROWS - 1}`, title: `Big ${ROWS - 1}`, project: "p1", status: "todo", priority: 9, assignee: "sam" });
    // Saved, the index is fresh for the file: opening again builds nothing.
    const { openIndexHost } = await import("@workspace.sh/table-app/node");
    const host = openIndexHost(bundle);
    let built = false;
    await host.ensure("tasks", join(bundle, "tables", "tasks"), () => (built = true));
    await host.close();
    expect(built).toBe(false);
  });

  it("a search is answered by the index", async () => {
    await openTasks();
    await screen.findAllByText("Land .table extension");
    const search = (await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry;
    await userEvent.type(search, "Big 299");
    await screen.findAllByText("11 of 3008 matching");
    await screen.findAllByText("Big 2999");
    // The rows that don't match go once the matching ones have arrived.
    await waitFor(() => expect(screen.queryAllByText("Land .table extension")).toHaveLength(0));
  });
});
