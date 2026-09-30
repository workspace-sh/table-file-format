import * as Gtk from "@gtkx/gi/gtk";
import * as Adw from "@gtkx/gi/adw";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// The field editor and "add a field", through their widgets, read back
// from the file's schema.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-fields-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const schemaOnDisk = async () => (await parseTable(join(bundle, "tables", "tasks"))).schema;

async function openTasks() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
}

/**
 * The entry row titled `title`, in whichever dialog is open, waiting for it:
 * the sidebar's rows are list items too, and are there before the dialog.
 */
async function entryRow(title: string): Promise<Adw.EntryRow> {
  let found: Adw.EntryRow | undefined;
  await waitFor(async () => {
    // An entry row is a list item to accessibility, not a text box.
    const rows = (await screen.findAllByRole(Gtk.AccessibleRole.LIST_ITEM)).filter((w) => w instanceof Adw.EntryRow) as Adw.EntryRow[];
    found = rows.find((r) => r.getTitle() === title);
    expect(found, `entry row "${title}"`).toBeDefined();
  });
  return found!;
}

describe("fields on Linux", () => {
  it("a field's title is edited from its header and saved to the schema", async () => {
    await openTasks();
    await userEvent.click(await screen.findByText("status"));
    const title = await entryRow("Title");
    await userEvent.type(title, "State");
    title.emit("apply");
    await waitFor(async () => {
      expect((await schemaOnDisk()).fields.find((f) => f.name === "status")?.title).toBe("State");
    });
  });

  it("a choice added in the editor is saved, and the schema version goes up", async () => {
    await openTasks();
    const before = (await schemaOnDisk())["schema-version"] ?? 1;
    await userEvent.click(await screen.findByText("status"));
    const add = await entryRow("Add Choice");
    await userEvent.type(add, "blocked");
    add.emit("apply");
    await waitFor(async () => {
      const schema = await schemaOnDisk();
      expect(schema.fields.find((f) => f.name === "status")?.constraints?.enum).toContain("blocked");
      expect(schema["schema-version"]).toBe(Number(before) + 1);
    });
  });

  it("a field added with a name gets a key from it and is saved", async () => {
    await openTasks();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" }));
    await userEvent.type(await entryRow("Name"), "Due soon");
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Add Field" })).at(-1)!);
    await waitFor(async () => {
      expect((await schemaOnDisk()).fields.at(-1)).toEqual({ name: "due_soon", title: "Due soon", type: "string" });
    });
  });
});
