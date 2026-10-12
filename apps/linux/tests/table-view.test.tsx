import * as Gtk from "@gtkx/gi/gtk";
import { render, screen } from "@gtkx/testing";
import { fromBundle, showView } from "@workspace.sh/table-app";
import type { ParsedTable, Row, ViewRows } from "@workspace.sh/table-core";
import { bundles } from "@workspace.sh/table-fixtures";
import { BoardView, CalendarView, DisplaySettingsProvider, GalleryView, ListView, TableView, type ViewProps } from "@workspace.sh/table-gtk";
import { describe, expect, it } from "vitest";

// The fixtures every demo and test shares, keyed `bundle/table` as an app
// holds them.
const held: Record<string, ParsedTable> = Object.assign({}, ...Object.entries(bundles).map(([key, b]) => fromBundle(key, b)));

function renderView(key: string, viewId: string, View: (props: ViewProps) => React.ReactNode = TableView) {
  const table = held[key]!;
  const shown = showView(held, key, table.views.find((v) => v.id === viewId)!);
  const bundle = key.slice(0, key.indexOf("/"));
  const related = Object.fromEntries(
    Object.entries(held)
      .filter(([k]) => k.startsWith(`${bundle}/`))
      .map(([k, t]) => [k.slice(bundle.length + 1), t]),
  );
  return render(
    <DisplaySettingsProvider value={{ locale: "en-GB" }}>
      <View view={shown.view} rows={shown.rows} schema={table.schema} bodies={table.bodies} relatedTables={related} sheet={shown.sheet} />
    </DisplaySettingsProvider>,
  );
}

describe("TableView on GTK", () => {
  it("shows each row's values, and a choice as its label", async () => {
    await renderView("crm/companies", "all");
    expect(await screen.findByText("Northwind Traders")).toBeDefined();
    expect(await screen.findByText("Company")).toBeDefined();
    expect(await screen.findByText("Retail")).toBeDefined();
  });

  it("shows only the rows the view's filter keeps", async () => {
    await renderView("crm/companies", "customers");
    expect(await screen.findByText("Atlas Freight")).toBeDefined();
    expect(screen.queryByText("Lumen Health")).toBeNull();
  });

  it("letters a sheet's columns, numbers its rows, and totals them", async () => {
    await renderView("household-budget/budget", "sheet");
    expect(await screen.findByText("C  Jan")).toBeDefined();
    expect(await screen.findByText("7")).toBeDefined();
    expect(await screen.findByText("£6,387.00")).toBeDefined();
    expect(screen.getAllByText("Sum").length).toBe(4);
  });

  it("shows a formula's result, worked out from the rows", async () => {
    await renderView("household-budget/ledger", "by-date");
    // The running balance after the last entry (D41's ledger).
    expect(await screen.findByText("£4,188.00")).toBeDefined();
  });

  it("shows a related row by its title, and a choice by its label rather than its stored value", async () => {
    await renderView("crm/deals", "all");
    expect((await screen.findAllByText("Northwind Traders")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Negotiation")).length).toBeGreaterThan(0);
    expect(screen.queryByText("negotiation")).toBeNull();
  });
});

describe("the card views on GTK", () => {
  it("a board has a column per choice, by label, with its cards", async () => {
    await renderView("crm/deals", "pipeline", BoardView);
    expect(await screen.findByText("Negotiation")).toBeDefined();
    expect(await screen.findByText("Qualified")).toBeDefined();
    expect(await screen.findByText("Lumen: pilot")).toBeDefined();
  });

  it("a board's cards leave out the field their column already says", async () => {
    // The tasks board lists no fields, so it shows them all, less status.
    await renderView("projects/tasks", "v2", BoardView);
    expect((await screen.findAllByText("PRIORITY")).length).toBeGreaterThan(0);
    expect(screen.queryByText("STATUS")).toBeNull();
  });

  it("a gallery leads each card with its hero field and shows a page's opening", async () => {
    await renderView("projects/projects", "v6", GalleryView);
    expect(await screen.findByText("Open .table format research")).toBeDefined();
    expect((await screen.findAllByText(/^Table file format spike Open/)).length).toBe(1);
  });

  it("a list shows each row by its title, marking those with a page", async () => {
    await renderView("projects/projects", "v7", ListView);
    expect(await screen.findByText("Plugin SDK")).toBeDefined();
    expect((await screen.findAllByText("Page")).length).toBeGreaterThan(0);
  });

  it("a calendar opens on its first dated row's month, and keeps inside its range", async () => {
    await renderView("projects/projects", "v9", CalendarView);
    expect(await screen.findByText("January 2026")).toBeDefined();
    expect(await screen.findByText("Workspace v1")).toBeDefined();
    const previous = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Previous month" });
    expect(previous.getSensitive()).toBe(false);
  });
});

describe("rows on their way from an index, on GTK", () => {
  it("are drawn as empty rows in the table's own columns: the grid is whole before the values arrive", async () => {
    const table = held["projects/tasks"]!;
    const view = table.views.find((v) => v.id === "v1")!;
    // A source that has said how many rows there are, and none of them yet.
    const source: ViewRows = {
      count: 30,
      inView: 30,
      version: "awaited",
      rows: () => new Promise<Row[]>(() => {}),
      ids: () => new Promise<string[]>(() => {}),
      placeOf: () => -1,
      row: () => undefined,
      totals: () => ({}),
      groups: () => [],
    };
    await render(
      <DisplaySettingsProvider value={{ locale: "en-GB" }}>
        <TableView view={view} rows={[]} source={source} schema={table.schema} relatedTables={{}} />
      </DisplaySettingsProvider>,
    );
    const awaited = await screen.findAllByName("awaited-row");
    expect(awaited.length).toBeGreaterThan(5);
    // The header's columns, by their widths.
    const widthOf = async (title: string) => {
      let at: Gtk.Widget | null = await screen.findByText(title);
      while (at && !(at instanceof Gtk.Overlay)) at = at.getParent();
      return at!.getWidth();
    };
    const columns = await Promise.all(table.schema.fields.map((f) => widthOf(f.title ?? f.name)));
    // Each awaited row has a cell for each column, as wide as its column and as tall as a row.
    const cellsOf = (row: Gtk.Widget) => {
      const cells: Gtk.Widget[] = [];
      const walk = (w: Gtk.Widget) => {
        for (let c = w.getFirstChild(); c; c = c.getNextSibling()) {
          if (c.getSizeRequest()[0] > 0 && c.getSizeRequest()[1] > 0 && c.getFirstChild() === null) cells.push(c);
          else walk(c);
        }
      };
      walk(row);
      return cells;
    };
    for (const row of awaited.slice(0, 3)) {
      const cells = cellsOf(row);
      // (The first column stays put on a wide table: its cell is laid over the row's start, with room left under it.)
      const widths = cells.map((c) => c.getSizeRequest()[0]);
      const sorted = (list: number[]) => [...list].sort((a, b) => a - b);
      expect([sorted(columns), sorted([...columns, columns[0]!])]).toContainEqual(sorted(widths));
      expect(new Set(cells.map((c) => c.getSizeRequest()[1]))).toEqual(new Set([44]));
      // With its line it is as tall as a row is: nothing moves when its values arrive.
      expect(row.getHeight()).toBe(45);
      // As wide as the header's columns together: its line stops where a row's does.
      expect((row.getFirstChild() as Gtk.Widget).getWidth()).toBe(columns.reduce((a, b) => a + b, 0));
    }
  });
});
