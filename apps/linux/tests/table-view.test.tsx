import * as Gtk from "@gtkx/gi/gtk";
import { render, screen, waitFor } from "@gtkx/testing";
import { fromBundle, showView } from "@workspace.sh/table-app";
import type { ParsedTable, Row, TableSchema, View, ViewRows } from "@workspace.sh/table-core";
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

// A sheet's row numbers: the gutter is as wide as the largest number (table-ui's rowNumberWidth).
describe("a sheet's row numbers on GTK", () => {
  const schema: TableSchema = { fields: [{ name: "title", type: "string" }] };
  const view: View = { id: "v", name: "Numbered", layout: "table", coordinates: true };
  const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` }));
  const numbers = async () => (await screen.findAllByName("row-number")) as Gtk.Label[];
  const numbered = async (text: string) => (await numbers()).find((label) => label.getLabel() === text)!;
  /** The gutter's width with its line (a widget's own width leaves its border out). */
  const widthOf = (label: Gtk.Label) => label.computeBounds(label)[1].getWidth();

  it("is the narrow gutter up to three digits", async () => {
    await render(<TableView view={view} rows={rowsOf(999)} schema={schema} relatedTables={{}} />);
    const first = await numbered("1");
    await waitFor(() => expect(widthOf(first)).toBe(32));
  });

  it("is wider for a fourth digit, from the first row down, though only the first rows are built", async () => {
    await render(<TableView view={view} rows={rowsOf(1200)} schema={schema} relatedTables={{}} />);
    const first = await numbered("1");
    // Four figures of 6.6 at 11 points, the padding and the line: 41.
    await waitFor(() => expect(widthOf(first)).toBe(41));
    for (const label of await numbers()) expect(widthOf(label)).toBe(41);
  });

  it("holds the largest number of a sheet's own numbering on one line", async () => {
    // The sheet numbers its rows itself (D41): here, into the millions.
    const rows = rowsOf(3);
    const sheet = { order: rows.map((r) => r.id), position: new Map(rows.map((r, i) => [r.id, 8_888_886 + i])), sheets: [] };
    await render(<TableView view={view} rows={rows} schema={schema} relatedTables={{}} sheet={sheet} />);
    const last = await numbered("8888888");
    await waitFor(() => expect(widthOf(last)).toBe(Math.ceil(7 * 6.6) + 14));
    // Its text needs no more room than the gutter gives it, and isn't cut short or wrapped.
    expect(last.getLayout().getPixelSize()[0]).toBeLessThanOrEqual(last.getWidth());
    expect(last.getLayout().getLineCount()).toBe(1);
    expect(last.getLayout().isEllipsized()).toBe(false);
  });
});

describe("TableView on GTK", () => {
  it("shows each row's values, and a choice as its label", async () => {
    await renderView("crm/companies", "9gcz9d8ctoqamitkgwfhiu7sru");
    expect(await screen.findByText("Northwind Traders")).toBeDefined();
    expect(await screen.findByText("Company")).toBeDefined();
    expect(await screen.findByText("Retail")).toBeDefined();
  });

  it("shows only the rows the view's filter keeps", async () => {
    await renderView("crm/companies", "surkeym1tjrn97wm3xdrg9qufr");
    expect(await screen.findByText("Atlas Freight")).toBeDefined();
    expect(screen.queryByText("Lumen Health")).toBeNull();
  });

  it("letters a sheet's columns, numbers its rows, and totals them", async () => {
    await renderView("household-budget/budget", "kifpjiq34nhz8k95rc3uezwqu5");
    expect(await screen.findByText("C  Jan")).toBeDefined();
    expect(await screen.findByText("7")).toBeDefined();
    expect(await screen.findByText("£6,387.00")).toBeDefined();
    expect(screen.getAllByText("Sum").length).toBe(4);
  });

  it("shows a formula's result, worked out from the rows", async () => {
    await renderView("household-budget/ledger", "7wxsrxd9g5oa5smry9tmfahdzs");
    // The running balance after the last entry (D41's ledger).
    expect(await screen.findByText("£4,188.00")).toBeDefined();
  });

  it("shows a related row by its title, and a choice by its label rather than its stored value", async () => {
    await renderView("crm/deals", "9gcz9d8ctoqamitkgwfhiu7sru");
    expect((await screen.findAllByText("Northwind Traders")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Negotiation")).length).toBeGreaterThan(0);
    expect(screen.queryByText("negotiation")).toBeNull();
  });
});

describe("the card views on GTK", () => {
  it("a board has a column per choice, by label, with its cards", async () => {
    await renderView("crm/deals", "oxycwiuri87bqu1s89cpt836n1", BoardView);
    expect(await screen.findByText("Negotiation")).toBeDefined();
    expect(await screen.findByText("Qualified")).toBeDefined();
    expect(await screen.findByText("Lumen: pilot")).toBeDefined();
  });

  it("a board's cards leave out the field their column already says", async () => {
    // The tasks board lists no fields, so it shows them all, less status.
    await renderView("projects/tasks", "gzrqtgo1p3gfehto7tani3jzz4", BoardView);
    expect((await screen.findAllByText("PRIORITY")).length).toBeGreaterThan(0);
    expect(screen.queryByText("STATUS")).toBeNull();
  });

  it("a gallery leads each card with its hero field and shows a page's opening", async () => {
    await renderView("projects/projects", "yxqsjf1fmbakwepxpx4ta44xks", GalleryView);
    expect(await screen.findByText("Open .table format research")).toBeDefined();
    expect((await screen.findAllByText(/^Table file format spike Open/)).length).toBe(1);
  });

  it("a list shows each row by its title, marking those with a page", async () => {
    await renderView("projects/projects", "u5fpdkwh5w9thdq8o368a9t4nw", ListView);
    expect(await screen.findByText("Plugin SDK")).toBeDefined();
    expect((await screen.findAllByText("Page")).length).toBeGreaterThan(0);
  });

  it("a calendar opens on its first dated row's month, and keeps inside its range", async () => {
    await renderView("projects/projects", "mjgwimtp1b49fgtgp5zdr5pzq9", CalendarView);
    expect(await screen.findByText("January 2026")).toBeDefined();
    expect(await screen.findByText("Workspace v1")).toBeDefined();
    const previous = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Previous month" });
    expect(previous.getSensitive()).toBe(false);
  });
});

describe("rows on their way from an index, on GTK", () => {
  it("are drawn as empty rows in the table's own columns: the grid is whole before the values arrive", async () => {
    const table = held["projects/tasks"]!;
    const view = table.views.find((v) => v.id === "ffaisc1zows4dzhy7aq5jrebkx")!;
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
