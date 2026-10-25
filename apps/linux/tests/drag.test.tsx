import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Cards dragged on a board and rows dragged in a list, read back from disk.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-drag-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** The nearest ancestor (or the widget itself) that `is`. */
function up<T extends Gtk.Widget>(widget: Gtk.Widget, is: (w: Gtk.Widget) => w is T): T {
  for (let w: Gtk.Widget | null = widget; w; w = w.getParent()) if (is(w)) return w;
  throw new Error("no such ancestor");
}
const isButton = (w: Gtk.Widget): w is Gtk.Button => w instanceof Gtk.Button;
/** A board column: the vertical box that holds its heading. */
const column = async (label: string) => {
  const heading = await screen.findByText(label);
  return heading.getParent()!.getParent()!;
};
const card = async (title: string) => up(await screen.findByText(title), isButton);
const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));

async function open(view: string) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView={view} />);
}

describe("dragging on Linux", () => {
  it("a card dropped on another column takes that column's value", async () => {
    await open("gzrqtgo1p3gfehto7tani3jzz4");
    await userEvent.dragAndDrop(await card("App icon"), await column("doing"), "abk93zgaattfxeony4hqsf457r");
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "abk93zgaattfxeony4hqsf457r")?.status).toBe("doing"));
  });

  it("a card dropped in a card's lower half goes after it in the view's order", async () => {
    await open("gzrqtgo1p3gfehto7tani3jzz4");
    const target = await card("Wire RSD + StyleX");
    await userEvent.dragAndDrop(await card("App icon"), target, "abk93zgaattfxeony4hqsf457r", { y: target.getHeight() - 1 });
    await waitFor(async () => {
      const t = await tasksOnDisk();
      expect(t.rows.find((r) => r.id === "abk93zgaattfxeony4hqsf457r")?.status).toBe("doing");
      const order = t.views.find((v) => v.id === "gzrqtgo1p3gfehto7tani3jzz4")?.order ?? [];
      expect(order.indexOf("abk93zgaattfxeony4hqsf457r")).toBe(order.indexOf("wpzuom5b9k3k4g6co658ozwerw") + 1);
    });
  });

  it("a list row dropped on another takes its place in the view's order", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/projects" initialView="u5fpdkwh5w9thdq8o368a9t4nw" />);
    // Quick list, in file order: Workspace v1 (p1) first, Web companion app (p4) fourth.
    await userEvent.dragAndDrop(await card("Web companion app"), await card("Workspace v1"), "hd7ttdzeb5z53faz9agiearrek");
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "projects"));
      expect(t.views.find((v) => v.id === "u5fpdkwh5w9thdq8o368a9t4nw")?.order?.slice(0, 2)).toEqual(["hd7ttdzeb5z53faz9agiearrek", "xsdxifzn73ohismzm8q5uri8fe"]);
    });
  });
});
