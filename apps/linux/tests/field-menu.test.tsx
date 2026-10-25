import * as Adw from "@gtkx/gi/adw";
import * as Gio from "@gtkx/gi/gio";
import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { columnActions, fieldHint } from "@workspace.sh/table-ui/shared";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A column's header menu (a right-click on it), the header edge's double
// click, and New Field in the main menu: read back from the files.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-field-menu-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));
const fieldsOnDisk = async () => (await tasksOnDisk()).schema.fields.map((f) => f.name);
const widthsOnDisk = async () => (await tasksOnDisk()).views.find((v) => v.id === "ffaisc1zows4dzhy7aq5jrebkx")!.columnWidths;

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="ffaisc1zows4dzhy7aq5jrebkx" />);
}

/** Every label in a menu, sections included. */
function labels(model: Gio.MenuModel): string[] {
  const out: string[] = [];
  for (let i = 0; i < model.getNItems(); i++) {
    const label = model.getItemAttributeValue(i, "label", GLib.VariantType.new("s"));
    if (label) out.push(label.getString()[0]);
    const section = model.getItemLink(i, "section");
    if (section) out.push(...labels(section));
  }
  return out;
}

/** The header menu of the column titled `title`: the button it hangs from is laid over the header. */
async function headerMenu(title: string): Promise<Gtk.MenuButton> {
  const header = await screen.findByText(title);
  let overlay: Gtk.Widget | null = header;
  while (overlay && !(overlay instanceof Gtk.Overlay)) overlay = overlay.getParent();
  let found: Gtk.MenuButton | undefined;
  for (let c = overlay!.getFirstChild(); c; c = c.getNextSibling()) if (c instanceof Gtk.MenuButton) found = c;
  expect(found, `the header menu of "${title}"`).toBeDefined();
  return found!;
}

const menuOf = (button: Gtk.MenuButton) => labels((button.getPopover() as Gtk.PopoverMenu).getMenuModel()!);

async function entryRow(title: string): Promise<Adw.EntryRow> {
  let found: Adw.EntryRow | undefined;
  await waitFor(async () => {
    const rows = (await screen.findAllByRole(Gtk.AccessibleRole.LIST_ITEM)).filter((w) => w instanceof Adw.EntryRow) as Adw.EntryRow[];
    found = rows.find((r) => r.getTitle() === title);
    expect(found, `entry row "${title}"`).toBeDefined();
  });
  return found!;
}

async function drag(name: string, dx: number) {
  const gesture = getController((await screen.findAllByName(name))[0]!, Gtk.GestureDrag);
  await fireEvent(gesture, "drag-begin", 0, 0);
  await fireEvent(gesture, "drag-update", dx, 0);
  await fireEvent(gesture, "drag-end", dx, 0);
}

describe("a column's header menu on Linux", () => {
  it("offers what the web, the Mac and phones do, in the same words", async () => {
    await openTasks();
    const menu = menuOf(await headerMenu("status"));
    const shared = columnActions("status", { onInsertField: () => {}, onDeleteField: () => {} }).map((a) => a.label);
    // After About This Field, which the Mac and phones show for the selected cell.
    expect(menu).toEqual(["About This Field", ...shared]);
    expect(menu).toEqual(["About This Field", "Insert Field Left", "Insert Field Right", "Delete Field"]);
  });

  it("Insert Field Right puts the new field after that column", async () => {
    await openTasks();
    const before = await fieldsOnDisk();
    (await headerMenu("status")).activateAction("field.insert-right", null);
    await userEvent.type(await entryRow("Name"), "Due soon");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    const at = before.indexOf("status");
    await waitFor(async () => expect(await fieldsOnDisk()).toEqual([...before.slice(0, at + 1), "due_soon", ...before.slice(at + 1)]));
  });

  it("Insert Field Left puts it before", async () => {
    await openTasks();
    const before = await fieldsOnDisk();
    (await headerMenu("status")).activateAction("field.insert-left", null);
    await userEvent.type(await entryRow("Name"), "Due soon");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    const at = before.indexOf("status");
    await waitFor(async () => expect(await fieldsOnDisk()).toEqual([...before.slice(0, at), "due_soon", ...before.slice(at)]));
  });

  it("Reset Column Width is there only for a column that was dragged, and puts its width back", async () => {
    await openTasks();
    expect(menuOf(await headerMenu("title"))).not.toContain("Reset Column Width");
    await drag("resize-column-title", 80);
    await waitFor(async () => expect((await widthsOnDisk())?.title).toBeGreaterThan(80));
    await waitFor(async () => expect(menuOf(await headerMenu("title"))).toContain("Reset Column Width"));
    (await headerMenu("title")).activateAction("field.reset-width", null);
    await waitFor(async () => expect(await widthsOnDisk()).toBeUndefined());
  });

  it("Delete Field asks first, then removes the field from the file", async () => {
    await openTasks();
    (await headerMenu("status")).activateAction("field.delete-field", null);
    expect(await fieldsOnDisk()).toContain("status");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Delete" }));
    await waitFor(async () => expect(await fieldsOnDisk()).not.toContain("status"));
  });
});

describe("About This Field on Linux", () => {
  it("says what the column is, in the words its header hint uses, and leads on to its settings", async () => {
    await openTasks();
    const schema = (await tasksOnDisk()).schema;
    const hint = fieldHint({ field: schema.fields.find((f) => f.name === "status"), name: "status", schema, editable: false });
    expect(hint.facts.length).toBeGreaterThan(1);
    (await headerMenu("status")).activateAction("field.about", null);
    await screen.findByText("About This Field");
    await screen.findByText(hint.facts.join(" · "));
    // Not yet in its settings: those open from here.
    expect(screen.queryAllByRole(Gtk.AccessibleRole.LIST_ITEM).filter((w) => w instanceof Adw.EntryRow && w.getTitle() === "Title")).toHaveLength(0);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Field Settings…" }));
    await entryRow("Title");
    await waitFor(() => expect(screen.queryByText("About This Field")).toBeNull());
  });

  it("shows a formula field's formula", async () => {
    const budget = join(dir, "household-budget.table");
    cpSync(join(fixturesDir()!, "household-budget.table"), budget, { recursive: true });
    const library = await loadLibrary([budget]);
    await render(<App library={library} initialTable="household-budget/budget" initialView="wsohm6y8imnngf9dirsm38je7w" />);
    const schema = (await parseTable(join(budget, "tables", "budget"))).schema;
    const hint = fieldHint({ field: schema.fields.find((f) => f.name === "quarter"), name: "quarter", schema, editable: false });
    expect(hint.formula).toMatch(/^=/);
    (await headerMenu("Q1")).activateAction("field.about", null);
    await screen.findByText("About This Field");
    const formula = await screen.findByText(hint.formula!);
    // Coloured as where it is typed.
    expect((formula as Gtk.Label).getAttributes()?.toString()).toMatch(/ foreground #/);
    await screen.findByText(hint.storedAs!);
  });
});

describe("a column's header menu from the keyboard on Linux", () => {
  it("Alt+Down on a cell opens the menu of the column it is in, and no other", async () => {
    await openTasks();
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    cell!.grabFocus();
    const title = await headerMenu("title");
    const status = await headerMenu("status");
    expect(title.getActive()).toBe(false);
    await userEvent.keyboard(cell!, "{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => expect(title.getActive()).toBe(true));
    expect(status.getActive()).toBe(false);
  });

  it("Down alone still moves to the cell below", async () => {
    await openTasks();
    let cell: Gtk.Widget | null = (await screen.findAllByText("Land .table extension"))[0]!;
    while (cell && !cell.getFocusable()) cell = cell.getParent();
    cell!.grabFocus();
    const title = await headerMenu("title");
    await userEvent.keyboard(cell!, "{ArrowDown}");
    await waitFor(() => expect(cell!.hasFocus()).toBe(false));
    expect(title.getActive()).toBe(false);
  });
});

describe("a header's edge on Linux", () => {
  it("double-clicked, puts a dragged column back to its share; a single press changes nothing", async () => {
    await openTasks();
    const click = async (presses: number) =>
      fireEvent(getController((await screen.findAllByName("resize-column-title"))[0]!, Gtk.GestureClick), "pressed", presses, 0, 0);
    // A press that doesn't move isn't a width.
    await drag("resize-column-title", 0);
    await click(1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await widthsOnDisk()).toBeUndefined();
    await drag("resize-column-title", 80);
    await waitFor(async () => expect((await widthsOnDisk())?.title).toBeGreaterThan(80));
    await click(2);
    await waitFor(async () => expect(await widthsOnDisk()).toBeUndefined());
  });
});

describe("New Field in the main menu on Linux", () => {
  it("opens the table's new-field editor, and the field goes at the end", async () => {
    await openTasks();
    const window = (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow;
    expect(window.getActionEnabled("new-field")).toBe(true);
    window.activateAction("win.new-field", null);
    await userEvent.type(await entryRow("Name"), "Due soon");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    await waitFor(async () => expect((await fieldsOnDisk()).at(-1)).toBe("due_soon"));
  });
});
