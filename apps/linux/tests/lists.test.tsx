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

// A multi-select cell, edited through its popover, read back from the file.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-lists-"));
  bundle = join(dir, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe("list cells on Linux", () => {
  it("ticking a choice saves the list in the schema's order", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="crm/companies" initialView="all" />);
    // Rows in file order: Northwind, Lumen, Atlas. Atlas is enterprise, emea, priority.
    const pickers = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose Tags" });
    await userEvent.click(pickers[2]!);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.CHECKBOX, { name: "startup" }));
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "companies"));
      expect(t.rows.find((r) => r.id === "co-atlas")?.tags).toEqual(["enterprise", "startup", "emea", "priority"]);
    });
  });
});

describe("a plain list cell on Linux", () => {
  it("is typed as a, b, c and saved as a list", async () => {
    const { EditableCell, DisplaySettingsProvider } = await import("@workspace.sh/table-gtk");
    const saved: unknown[] = [];
    await render(
      <DisplaySettingsProvider value={{}}>
        <EditableCell field={{ name: "aka", type: "array" }} value={["x"]} onCommit={(v) => saved.push(v)} />
      </DisplaySettingsProvider>,
    );
    await userEvent.click(await screen.findByText("x"));
    const entry = (await screen.findByDisplayValue("x")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "a,  b ,");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(saved).toEqual([["a", "b"]]));
  });
});
