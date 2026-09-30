import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseBundle } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// New tables and .table files, named in a dialog, read back from disk.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-new-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function name(text: string) {
  const entry = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.Entry && w.getPlaceholderText() === "Name") as Gtk.Entry;
  await userEvent.type(entry, text);
  await userEvent.click(await screen.findByText("Create"));
}

describe("making tables and files on Linux", () => {
  it("a new table goes into its bundle and the manifest's order", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" newFilesIn={dir} />);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "New Table in Projects" }));
    await name("Reading list");
    await waitFor(async () => {
      const b = await parseBundle(bundle);
      expect(b.meta.tables).toEqual(["projects", "tasks", "reading-list"]);
      expect(b.tables["reading-list"]?.meta.title).toBe("Reading list");
    });
  });

  it("a new .table file is made in the new-files folder", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" newFilesIn={dir} />);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "New .table File" }));
    await name("Garden");
    await waitFor(async () => {
      expect(existsSync(join(dir, "garden.table", "meta.json"))).toBe(true);
      const b = await parseBundle(join(dir, "garden.table"));
      expect(b.meta.title).toBe("Garden");
      expect(Object.keys(b.tables)).toEqual(["garden"]);
    });
  });
});
