import * as Gdk from "@gtkx/gi/gdk";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, getController, render, screen, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// The keyboard on cards, as the web's board and list have it: arrows by
// table-ui/shared's moveInColumns, Option/Alt+arrows moving the card.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-cards-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const onDisk = (table: string) => parseTable(join(bundle, "tables", table));

async function open(table: string, view: string) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable={`projects/${table}`} initialView={view} />);
}

/** The card (a button) a title is on. */
async function cardOf(title: string): Promise<Gtk.Button> {
  let w: Gtk.Widget | null = (await screen.findAllByText(title))[0]!;
  while (w && !(w instanceof Gtk.Button)) w = w.getParent();
  return w as Gtk.Button;
}

async function press(card: Gtk.Widget, keyval: number, alt = false) {
  await fireEvent(getController(card, Gtk.EventControllerKey)!, "key-pressed", keyval, 0, alt ? Gdk.ModifierType.ALT_MASK : 0);
}

const focused = (w: Gtk.Widget) => (w.getRoot() as unknown as Gtk.Window).getFocus();

describe("the keyboard on a board on Linux", () => {
  it("down stays in the column; left keeps the place in the next column", async () => {
    await open("tasks", "gzrqtgo1p3gfehto7tani3jzz4");
    // doing: t2, t3, t5; todo: t4, t6, t7.
    const wire = await cardOf("Wire RSD + StyleX");
    wire.grabFocus();
    await press(wire, Gdk.KEY_Down);
    await waitFor(async () => expect(focused(wire)).toBe(await cardOf("Fixtures + tests")));
    await press(await cardOf("Fixtures + tests"), Gdk.KEY_Left);
    await waitFor(async () => expect(focused(wire)).toBe(await cardOf("App icon")));
  });

  it("Alt+Left moves the card to the column before, and it keeps the keyboard", async () => {
    await open("tasks", "gzrqtgo1p3gfehto7tani3jzz4");
    const land = await cardOf("Land .table extension");
    land.grabFocus();
    await press(land, Gdk.KEY_Left, true);
    await waitFor(async () => expect((await onDisk("tasks")).rows.find((r) => r.id === "ytjc8tj8w8ftnbf9h86s5k9jfk")?.status).toBe("doing"));
    // Drawn again in its new column, and the keyboard followed it there.
    await waitFor(async () => {
      const now = await cardOf("Land .table extension");
      expect(focused(now)).toBe(now);
    });
  });

  it("Alt+Down swaps it with the card below, as the view's order", async () => {
    await open("tasks", "gzrqtgo1p3gfehto7tani3jzz4");
    const wire = await cardOf("Wire RSD + StyleX");
    wire.grabFocus();
    await press(wire, Gdk.KEY_Down, true);
    await waitFor(async () => {
      const order = (await onDisk("tasks")).views.find((v) => v.id === "gzrqtgo1p3gfehto7tani3jzz4")?.order ?? [];
      expect(order.indexOf("wpzuom5b9k3k4g6co658ozwerw")).toBeGreaterThan(order.indexOf("18pfutsbnrkppxrwxxn1ideokr"));
    });
  });
});

describe("the keyboard on a list on Linux", () => {
  it("Alt+Down moves the row down, as the view's order", async () => {
    await open("projects", "u5fpdkwh5w9thdq8o368a9t4nw");
    const first = (await onDisk("projects")).rows[0]!;
    const card = await cardOf(String(first.name ?? first.title));
    card.grabFocus();
    await press(card, Gdk.KEY_Down, true);
    await waitFor(async () => expect((await onDisk("projects")).views.find((v) => v.id === "u5fpdkwh5w9thdq8o368a9t4nw")?.order?.[1]).toBe(first.id));
  });
});
