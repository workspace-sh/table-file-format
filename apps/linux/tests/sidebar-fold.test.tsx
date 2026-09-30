import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import type { KeyValueStore } from "@workspace.sh/table-app";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A .table file's tables folded away in the sidebar, as on the web and
// the Mac (sidebarPrefs.foldedFiles), and unfolded when one is opened.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-fold-"));
  for (const name of ["crm.table", "projects.table"]) cpSync(join(fixturesDir()!, name), join(dir, name), { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

function memoryStore(): KeyValueStore {
  const items = new Map<string, string>();
  return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) };
}

async function open(initialTable: string, settings: KeyValueStore) {
  const library = await loadLibrary([join(dir, "crm.table"), join(dir, "projects.table")]);
  await render(<App library={library} initialTable={initialTable} settings={settings} />);
}

describe("folding a file in the sidebar on Linux", () => {
  it("hides its tables, and stays folded next time", async () => {
    const settings = memoryStore();
    await open("projects/tasks", settings);
    expect(await screen.findByText("Companies")).toBeDefined();
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Hide Tables in CRM" }));
    await waitFor(() => expect(screen.queryByText("Companies")).toBeNull());
    await cleanup();
    await open("projects/tasks", settings);
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show Tables in CRM" })).toBeDefined();
    expect(screen.queryByText("Companies")).toBeNull();
  });

  it("opening one of its tables unfolds it", async () => {
    const settings = memoryStore();
    await open("projects/tasks", settings);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Hide Tables in CRM" }));
    await waitFor(() => expect(screen.queryByText("Companies")).toBeNull());
    await cleanup();
    await open("crm/companies", settings);
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Hide Tables in CRM" })).toBeDefined();
  });
});
