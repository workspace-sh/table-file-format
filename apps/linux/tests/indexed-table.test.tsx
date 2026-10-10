import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { openArchive } from "@workspace.sh/table-app";
import { loadLibrary, openIndexHost, type IndexHost } from "@workspace.sh/table-app/node";
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
  // Past the first rows shown while its index is made: the view itself.
  await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
  await waitFor(() => expect(screen.queryAllByText(/rows read$/)).toHaveLength(0));
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

  it("shows the first rows as stored while the index is being made, then the view itself", async () => {
    const library = await loadLibrary([bundle], [], { indexedFrom: 1000 });
    // An index that takes as long as the test says.
    let finish = () => {};
    const held = new Promise<void>((resolve) => (finish = resolve));
    const slow = (dir: string): IndexHost => {
      const host = openIndexHost(dir);
      return {
        ...host,
        ensure: async (name, tableDir, onProgress) => {
          onProgress?.(1000, ROWS + 8);
          await held;
          return host.ensure(name, tableDir, onProgress);
        },
      };
    };
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" indexedFrom={1000} openIndex={slow} />);
    // The head of the file, in file order: t1 first, though the view sorts by priority.
    await screen.findAllByText("Land .table extension");
    await screen.findAllByText("1,000 of 3,008 rows read");
    await screen.findAllByText(/rows as stored, as they're read\. This view's sorting/);
    await screen.findAllByText("Big 5");
    // Two hundred of them, not the table: the scroller is that long.
    const upper = scrollerOf(await cellOf("Big 5")).getVadjustment().getUpper();
    expect(upper).toBeGreaterThan(199 * 45);
    expect(upper).toBeLessThan(203 * 45);
    expect(((await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry).getSensitive()).toBe(false);
    // To look at only: no cell takes the keyboard.
    const first = await cellOf("Land .table extension");
    first.grabFocus();
    expect((first.getRoot() as unknown as Gtk.Window).getFocus()).not.toBe(first);

    finish();
    await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
    await waitFor(() => expect(screen.queryAllByText(/rows read$/)).toHaveLength(0));
    expect(((await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry).getSensitive()).toBe(true);
  });

  it("while it's being read, every row read so far can be scrolled to, and the place is kept when it's done", async () => {
    const library = await loadLibrary([bundle], [], { indexedFrom: 1000 });
    let finish = () => {};
    const held = new Promise<void>((resolve) => (finish = resolve));
    // An index with all its rows in, and still saying it's reading: as a build is, near its end.
    const reading = (dir: string): IndexHost => {
      const host = openIndexHost(dir);
      return {
        ...host,
        ensure: async (name, tableDir, onProgress) => {
          const count = await host.ensure(name, tableDir);
          onProgress?.(count + 5000, count + 5000);
          await held;
          return count;
        },
      };
    };
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" indexedFrom={1000} openIndex={reading} />);
    const first = await cellOf("Land .table extension");
    const scroller = scrollerOf(first);
    const adjustment = scroller.getVadjustment();
    await waitFor(() => expect(adjustment.getUpper()).toBeGreaterThanOrEqual((ROWS + 8) * 45));
    await screen.findAllByText(/rows read$/);
    // Far past the first two hundred: read from the index as it stands.
    adjustment.setValue(adjustment.getUpper() - adjustment.getPageSize());
    await screen.findAllByText(`Big ${ROWS - 1}`);
    const at = adjustment.getValue();

    finish();
    await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
    await waitFor(() => expect(screen.queryAllByText(/rows read$/)).toHaveLength(0));
    // The same table, where it was: v1 sorts by priority, and these rows are last either way.
    expect(scroller.getVadjustment().getValue()).toBe(at);
    await screen.findAllByText(`Big ${ROWS - 1}`);
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
    const host = openIndexHost(bundle);
    let built = false;
    await host.ensure("tasks", join(bundle, "tables", "tasks"), () => (built = true));
    await host.close();
    expect(built).toBe(false);
  });

  it("an edit is undone and made again, on screen and in rows.ndjson", async () => {
    await openTasks();
    const first = await cellOf("Land .table extension");
    const window = first.getRoot() as unknown as Gtk.ApplicationWindow;
    first.grabFocus();
    await userEvent.keyboard(first, "Z");
    const entry = (await screen.findByDisplayValue("Z")) as Gtk.Entry;
    await userEvent.type(entry, "ed");
    await userEvent.keyboard(entry, "{Enter}");
    await screen.findAllByText("Zed");
    await waitFor(() => expect(rowsOnDisk().find((r) => r.id === "t1")?.title).toBe("Zed"), { timeout: 5000 });
    await waitFor(() => expect(window.getActionEnabled("undo")).toBe(true));

    window.activateAction("win.undo", null);
    await screen.findAllByText("Land .table extension");
    await waitFor(() => expect(rowsOnDisk().find((r) => r.id === "t1")?.title).toBe("Land .table extension"), { timeout: 5000 });
    expect(rowsOnDisk()).toHaveLength(ROWS + 8);
    await waitFor(() => expect(window.getActionEnabled("redo")).toBe(true));
    expect(window.getActionEnabled("undo")).toBe(false);

    window.activateAction("win.redo", null);
    await screen.findAllByText("Zed");
    await waitFor(() => expect(rowsOnDisk().find((r) => r.id === "t1")?.title).toBe("Zed"), { timeout: 5000 });
  });

  it("a field can be added: the index is made again, and the rows are all still there", async () => {
    await openTasks();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" }));
    let name: Adw.EntryRow | undefined;
    await waitFor(async () => {
      const rows = (await screen.findAllByRole(Gtk.AccessibleRole.LIST_ITEM)).filter((w) => w instanceof Adw.EntryRow) as Adw.EntryRow[];
      name = rows.find((r) => r.getTitle() === "Name");
      expect(name).toBeDefined();
    });
    await userEvent.type(name!, "Due soon");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    await screen.findAllByText("Due soon");
    const schemaOnDisk = () => JSON.parse(readFileSync(join(bundle, "tables", "tasks", "schema.json"), "utf8")) as { fields: { name: string }[] };
    await waitFor(() => expect(schemaOnDisk().fields.at(-1)?.name).toBe("due_soon"), { timeout: 5000 });
    // Made again for the new field, and answering: an edit to it is saved.
    await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
    await waitFor(() => expect(screen.queryAllByText(/rows read$/)).toHaveLength(0));
    const host = openIndexHost(bundle);
    const { queryIndex } = await import("@workspace.sh/table-core");
    await waitFor(async () => expect((await queryIndex(host, { name: "tasks", schema: schemaOnDisk() as never }))?.count).toBe(ROWS + 8), { timeout: 5000 });
    await host.close();
    expect(rowsOnDisk()).toHaveLength(ROWS + 8);
  });

  it("a layout that isn't the table's says so until a search narrows the rows, then shows them", async () => {
    // Past what such a layout is given at once.
    let more = "";
    for (let i = ROWS; i < ROWS + 3000; i++) more += `${JSON.stringify({ id: `b${i}`, title: `Big ${i}`, status: "todo", priority: 9 })}\n`;
    appendFileSync(join(bundle, "tables", "tasks", "rows.ndjson"), more);
    const library = await loadLibrary([bundle], [], { indexedFrom: 1000 });
    // v2 is the board by status.
    await render(<App library={library} initialTable="projects/tasks" initialView="v2" indexedFrom={1000} />);
    await screen.findAllByText("Too Many Rows for This Layout");
    await screen.findAllByText(/This view shows 6,008 rows\./);
    const search = (await screen.findByPlaceholderText("Search rows")) as Gtk.SearchEntry;
    await userEvent.type(search, "Big 299");
    await screen.findAllByText("Big 2999");
    expect(screen.queryAllByText("Too Many Rows for This Layout")).toHaveLength(0);
    expect(screen.queryAllByText(/^Big 299\d?$/)).toHaveLength(11);
  });

  it("exports as a .table.zip with every row", async () => {
    const out = join(dir, "out.table.zip");
    const library = await loadLibrary([bundle], [], { indexedFrom: 1000 });
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" indexedFrom={1000} chooseZipSaveAs={async () => out} />);
    await screen.findAllByText(`${ROWS + 8} of ${ROWS + 8} rows`);
    const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" });
    (button.getRoot() as unknown as Gtk.ApplicationWindow).activateAction("win.export-zip", null);
    await waitFor(() => expect(existsSync(out)).toBe(true));
    const opened = await openArchive(new Uint8Array(readFileSync(out)), []);
    expect(opened.bundle.tables.tasks!.rows).toEqual(rowsOnDisk());
    expect(opened.bundle.tables.tasks!.indexed).toBeUndefined();
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
