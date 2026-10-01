import * as Gio from "@gtkx/gi/gio";
import * as GLib from "@gtkx/gi/glib";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rowActions } from "@workspace.sh/table-ui/shared";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// What a row's menu offers, by the view it's in; and a short year typed
// into a date, fixed with one click.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-menu-"));
  bundle = join(dir, "household-budget.table");
  cpSync(join(fixturesDir()!, "household-budget.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function open(table: string, view: string) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable={`household-budget/${table}`} initialView={view} />);
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

async function firstRowMenu(): Promise<string[]> {
  let found: Gtk.MenuButton | undefined;
  await waitFor(async () => {
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON);
    found = buttons.find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === "Row Actions") as Gtk.MenuButton | undefined;
    expect(found).toBeDefined();
  });
  return labels((found!.getPopover() as Gtk.PopoverMenu).getMenuModel()!);
}

describe("the row menu on Linux", () => {
  it("a sheet offers rows inserted above and below", async () => {
    await open("budget", "sheet");
    const menu = await firstRowMenu();
    expect(menu).toContain("Insert Row Above");
    // The same words as on the web, the Mac and phones: table-ui/shared's rowActions.
    const shared = rowActions("any", { onOpenBody: () => {}, hasBody: false, onInsertRow: () => {}, onDeleteRow: () => {} }).map((a) => a.label);
    expect(menu).toEqual(shared);
  });

  it("a table view that isn't a sheet doesn't", async () => {
    await open("ledger", "as-entered");
    const menu = await firstRowMenu();
    expect(menu).toContain("Delete Row");
    expect(menu).not.toContain("Insert Row Above");
  });
});

describe("a short year typed into a date", () => {
  it("says so once, and its Use 2026 icon saves the year it meant", async () => {
    await open("ledger", "as-entered");
    const cell = (await screen.findAllByText(/2026/))[0]!;
    await userEvent.click(cell);
    const entry = (await screen.findByDisplayValue("2026-01-01")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "0026-01-02");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(entry.hasCssClass("error")).toBe(true));
    expect(entry.getTooltipText()!.match(/Did you mean/g)).toHaveLength(1);
    expect(entry.getIconTooltipText(Gtk.EntryIconPosition.SECONDARY)).toBe("Use 2026");
    await fireEvent(entry, "icon-press", Gtk.EntryIconPosition.SECONDARY);
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "ledger"));
      expect(t.rows.find((r) => r.id === "opening")?.date).toBe("2026-01-02");
    });
  });
});

describe("a cell being edited", () => {
  it("keeps to its column: the next cell doesn't move", async () => {
    await open("ledger", "as-entered");
    const next = await screen.findByText("Opening balance");
    const x = () => {
      const [ok, point] = next.computeBounds(next.getRoot() as unknown as Gtk.Widget);
      return ok ? point.getX() : NaN;
    };
    await waitFor(() => expect(x()).toBeGreaterThan(0));
    const before = x();
    await userEvent.click((await screen.findAllByText("2026-01-01"))[0]!);
    await screen.findByDisplayValue("2026-01-01");
    await waitFor(() => expect(x()).toBe(before));
  });
});
