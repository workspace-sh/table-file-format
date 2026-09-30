import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A file chosen for an attachment cell is copied into the table's
// attachments/ folder, and the cell saved as its name.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-attach-"));
  bundle = join(dir, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe("attaching on Linux", () => {
  it("a chosen file is copied in and the cell set to its name", async () => {
    const source = join(dir, "new-logo.svg");
    writeFileSync(source, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const library = await loadLibrary([bundle]);
    // Customers lists every field, the logo included; the file chooser is stubbed.
    await render(<App library={library} initialTable="crm/companies" initialView="customers" chooseFile={async () => source} />);
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose File" });
    await userEvent.click(buttons[0]!);
    await waitFor(async () => {
      const t = await parseTable(join(bundle, "tables", "companies"));
      expect(t.rows.some((r) => r.logo === "new-logo.svg")).toBe(true);
    });
    expect(readFileSync(join(bundle, "tables", "companies", "attachments", "new-logo.svg"), "utf8")).toContain("<svg");
  });

  it("choosing nothing changes nothing", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="crm/companies" initialView="customers" chooseFile={async () => null} />);
    await userEvent.click((await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose File" }))[0]!);
    await new Promise((r) => setTimeout(r, 800));
    // No failure was reported: cancelling isn't an error.
    const warnings = screen.queryAllByRole(Gtk.AccessibleRole.IMG).filter((w) => (w.getTooltipText() ?? "").startsWith("Not saved"));
    expect(warnings).toHaveLength(0);
    expect(existsSync(join(bundle, "tables", "companies", "attachments", "new-logo.svg"))).toBe(false);
    const t = await parseTable(join(bundle, "tables", "companies"));
    expect(t.rows.map((r) => r.logo)).toEqual(library.tables["crm/companies"]!.rows.map((r) => r.logo));
  });
});
