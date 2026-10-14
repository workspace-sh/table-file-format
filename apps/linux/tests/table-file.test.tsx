import * as Gtk from "@gtkx/gi/gtk";
import { GtkWindow } from "@gtkx/jsx/gtk";
import { act, cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { TableFile } from "@workspace.sh/table-gtk/embed";
import { parseTable } from "@workspace.sh/table-core/parser";
import { bundleToArchive } from "@workspace.sh/table-app";
import { readBundle } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

// A .table opened as a document of its own: a folder, written back where it
// is, or a .table.zip, to look at.
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "table-file-"));
  for (const name of ["projects.table", "crm.table"]) cpSync(join(fixturesDir()!, name), join(root, name), { recursive: true });
});
afterEach(async () => {
  await cleanup();
  rmSync(root, { recursive: true, force: true });
});

const open = (path: string) =>
  render(
    <GtkWindow defaultWidth={1000} defaultHeight={700}>
      <TableFile path={path} />
    </GtkWindow>,
  );
const picker = async (name: string) => (await screen.findAllByName(name))[0] as Gtk.DropDown;
const pick = (dropDown: Gtk.DropDown, index: number) =>
  act(() => {
    dropDown.setSelected(index);
  });
/** A cell, once it is on screen to stay: the table builds its rows again when it learns its width. */
async function cell(text: string): Promise<Gtk.Widget> {
  let found: Gtk.Widget | null = null;
  await waitFor(async () => {
    const widget = (await screen.findAllByText(text)).find((w) => w.getRoot() !== null && w.getMapped());
    expect(widget).toBeDefined();
    found = widget!;
  });
  return found!;
}
const count = async () => ((await screen.findAllByName("table-file-count"))[0] as Gtk.Label).getLabel();

describe("a .table opened as a document", () => {
  it("opens on its first table, in that table's first view, with the file's tables and its views to choose from", async () => {
    await open(join(root, "projects.table"));
    // projects is the first table of projects.table; its first view is a table of seventeen rows.
    expect(await screen.findByText("Workspace v1")).toBeDefined();
    await waitFor(async () => expect(await count()).toBe("17 of 17 rows"));
    const tables = await picker("table-file-tables");
    const views = await picker("table-file-views");
    expect(tables.getSelected()).toBe(0);
    expect((tables.getModel() as Gtk.StringList).getNItems()).toBe(2);
    expect((views.getModel() as Gtk.StringList).getString(0)).toBe("All projects · Table");
  });

  it("goes to another table, and another view, when they are chosen", async () => {
    await open(join(root, "projects.table"));
    await screen.findByText("Workspace v1");
    await pick(await picker("table-file-tables"), 1);
    expect(await screen.findByText("Land .table extension")).toBeDefined();
    await waitFor(async () => expect(await count()).toBe("8 of 8 rows"));
    expect(await screen.findByText("+ New row")).toBeDefined();
    // The tasks table's second view is its board: cards, and no table's "+ New row".
    await pick(await picker("table-file-views"), 1);
    await waitFor(() => expect(screen.queryByText("+ New row")).toBeNull());
    expect(await screen.findByText("Land .table extension")).toBeDefined();
    expect((await picker("table-file-views")).getSelected()).toBe(1);
  });

  it("narrows to what is searched for", async () => {
    await open(join(root, "projects.table"));
    await screen.findByText("Workspace v1");
    const search = (await screen.findAllByRole(Gtk.AccessibleRole.SEARCH_BOX))[0] as Gtk.SearchEntry;
    await userEvent.type(search, "Sync engine");
    await waitFor(async () => expect(await count()).toBe("1 of 17 matching"));
    expect(screen.queryByText("Workspace v1")).toBeNull();
  });

  it("adds a view, saved to the folder, and opens a view's settings", async () => {
    await open(join(root, "projects.table"));
    await screen.findByText("Workspace v1");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "New View" }));
    await waitFor(async () => expect((await parseTable(join(root, "projects.table", "tables", "projects"))).views).toHaveLength(11));
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "View Settings" }));
    expect((await screen.findAllByText("Layout")).length).toBeGreaterThan(0);
  });

  it("saves a cell retyped to the folder", async () => {
    await open(join(root, "projects.table"));
    await userEvent.click(await cell("Workspace v1"));
    const entry = (await screen.findByDisplayValue("Workspace v1")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Workspace one");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await parseTable(join(root, "projects.table", "tables", "projects"))).rows.find((r) => r.id === "p1")?.title).toBe("Workspace one"));
  });

  it("opens a .table.zip to look at: no editor on a click, and it says why", async () => {
    const bundle = await readBundle(nodeFs, join(root, "crm.table"));
    const zip = join(root, "crm.table.zip");
    writeFileSync(zip, await bundleToArchive("crm", bundle));
    const before = readFileSync(zip);
    await open(zip);
    expect(await screen.findByText("Opened from a .table.zip: changes can’t be saved")).toBeDefined();
    await userEvent.click(await cell("Atlas Freight"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByDisplayValue("Atlas Freight")).toBeNull();
    expect(Buffer.compare(readFileSync(zip), before)).toBe(0);
  });

  it("says why when it can't be opened", async () => {
    await open(join(root, "nowhere.table"));
    expect(await screen.findByText("“nowhere.table” isn’t there any more.")).toBeDefined();
  });
});
