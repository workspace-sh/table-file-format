import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { bundleToArchive } from "@workspace.sh/table-app";
import { openSingleFile } from "@workspace.sh/table-app/node";
import { filesOfFolder, readTableArchive } from "@workspace.sh/table-core";
import { readBundle } from "@workspace.sh/table-core/io";
import { nodeFs } from "@workspace.sh/table-core/node-fs";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";
import { clickFresh } from "./clickFresh.js";

// A single-file .table changed somewhere else while it's open here: an edit isn't saved over it, and
// it says so in place, above the table, with what can be done with the edits: kept as a copy beside
// it, or let go. Never a blocking alert for a file's state.

let dir: string;
let file: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-elsewhere-"));
  file = join(dir, "crm.table");
  const folder = join(fixturesDir()!, "crm.table");
  writeFileSync(file, await bundleToArchive("crm", { ...(await readBundle(nodeFs, folder)), files: await filesOfFolder(nodeFs, folder) }));
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const companiesIn = async (path: string) => (await readTableArchive(new Uint8Array(readFileSync(path)))).tables.companies!.rows.map((r) => r.name);

async function editAfterTheyChangedIt(): Promise<(label: string) => Promise<void>> {
  const library = await openSingleFile(file, [], { home: join(dir, "cache") });
  await render(<App library={library} initialTable="crm/companies" />);
  // Meanwhile, someone else's copy is written over the file: a company renamed.
  const theirs = await readTableArchive(new Uint8Array(readFileSync(file)));
  const renamed = theirs.tables.companies!.rows.map((r) => (r.name === "Fern Studio" ? { ...r, name: "Fern Studios Ltd" } : r));
  writeFileSync(file, await bundleToArchive("crm", { ...theirs, tables: { ...theirs.tables, companies: { ...theirs.tables.companies!, rows: renamed } } }));
  // An edit here.
  await clickFresh(async () => (await screen.findAllByText("Atlas Freight")).find((w) => w.getMapped())!);
  const entry = (await screen.findByDisplayValue("Atlas Freight")) as Gtk.Entry;
  await userEvent.clear(entry);
  await userEvent.type(entry, "Atlas Shipping");
  await userEvent.keyboard(entry, "{Enter}");
  // Said in place, with no alert.
  await waitFor(() => screen.findByText("“crm.table” was changed somewhere else"), { timeout: 15000 });
  expect(screen.queryAllByRole(Gtk.AccessibleRole.ALERT_DIALOG)).toEqual([]);
  // Not saved over.
  expect(await companiesIn(file)).toContain("Fern Studios Ltd");
  expect(await companiesIn(file)).not.toContain("Atlas Shipping");
  return async (label) => userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: label }));
}

describe("a single file changed elsewhere, on Linux", () => {
  it("keeps the edits as a copy beside it, shown, and the file read again as they left it", async () => {
    const choose = await editAfterTheyChangedIt();
    await choose("Keep my edits as a copy");
    const copy = join(dir, "crm (edited here).table");
    await waitFor(() => expect(existsSync(copy)).toBe(true), { timeout: 10000 });
    expect(await companiesIn(copy)).toContain("Atlas Shipping");
    expect(await companiesIn(file)).toContain("Fern Studios Ltd");
    expect(await companiesIn(file)).not.toContain("Atlas Shipping");
    // The file as they left it is what's held of it now.
    await waitFor(async () => expect((await screen.findAllByText("Fern Studios Ltd")).length).toBeGreaterThan(0), { timeout: 10000 });
  }, 60_000);

  it("lets the edits go, and the file is read again as they left it", async () => {
    const choose = await editAfterTheyChangedIt();
    await choose("Discard my edits");
    await waitFor(async () => expect((await screen.findAllByText("Fern Studios Ltd")).length).toBeGreaterThan(0), { timeout: 10000 });
    expect(existsSync(join(dir, "crm (edited here).table"))).toBe(false);
    expect(await companiesIn(file)).not.toContain("Atlas Shipping");
    // Answered: no longer said.
    await waitFor(() => expect(screen.queryByText("“crm.table” was changed somewhere else")).toBeNull());
  }, 60_000);
});
