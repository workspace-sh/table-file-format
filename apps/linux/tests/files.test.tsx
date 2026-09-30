import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// The Files side: the .table as it is on disk, and a file shown from it.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-files-"));
  bundle = join(dir, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function openFiles() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="crm/companies" initialView="all" />);
  await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.TOGGLE_BUTTON, { name: "Files" }));
}

describe("the Files side on Linux", () => {
  it("lists the open table's files, and shows one as the text on disk", async () => {
    await openFiles();
    expect(await screen.findByText("crm.table/")).toBeDefined();
    expect(await screen.findByText("6 rows")).toBeDefined();
    // The companies folder is open (the table on screen), its rows.ndjson listed.
    const rows = (await screen.findAllByText("rows.ndjson"))[0]!;
    await userEvent.click(rows);
    let view: Gtk.TextView | undefined;
    await waitFor(async () => {
      view = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.TextView) as Gtk.TextView | undefined;
      expect(view).toBeDefined();
    });
    expect(view!.getBuffer().text).toBe(readFileSync(join(bundle, "tables", "companies", "rows.ndjson"), "utf8"));
    expect(view!.getEditable()).toBe(false);
  });

  it("opens attachments/ and shows an attachment as its picture", async () => {
    await openFiles();
    await userEvent.click(await screen.findByText("attachments/"));
    await userEvent.click(await screen.findByText("co-atlas.svg"));
    await waitFor(async () => {
      const pictures = (await screen.findAllByRole(Gtk.AccessibleRole.IMG)).filter((w) => w instanceof Gtk.Picture) as Gtk.Picture[];
      expect(pictures.some((p) => p.getAlternativeText() === "co-atlas.svg" && p.getPaintable() !== null)).toBe(true);
    });
  });
});
