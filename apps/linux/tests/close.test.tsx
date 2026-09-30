import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, fireEvent, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseTable } from "@workspace.sh/table-core/parser";
import { chmodSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Closing the window writes what's still to write first, rather than
// losing an edit made within the save delay (#273).

const quit = vi.hoisted(() => vi.fn());
vi.mock("@gtkx/react", async (actual) => ({ ...(await actual<typeof import("@gtkx/react")>()), quit }));

let dir: string;
let bundle: string;

beforeEach(() => {
  quit.mockClear();
  dir = mkdtempSync(join(tmpdir(), "table-linux-close-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  chmodSync(join(bundle, "tables", "tasks"), 0o755);
  rmSync(dir, { recursive: true, force: true });
});

async function editTitle(to: string): Promise<Gtk.Window> {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
  await userEvent.click(await screen.findByText("Land .table extension"));
  const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
  await userEvent.clear(entry);
  await userEvent.type(entry, to);
  const window = entry.getRoot() as unknown as Gtk.Window;
  await userEvent.keyboard(entry, "{Enter}");
  return window;
}

const titleOnDisk = async () => (await parseTable(join(bundle, "tables", "tasks"))).rows.find((r) => r.id === "t1")?.title;

describe("closing the window on Linux", () => {
  it("writes an edit made just before, then quits", async () => {
    const window = await editTitle("Closed quickly");
    // At once: well inside the save delay.
    await fireEvent(window, "close-request");
    await waitFor(() => expect(quit).toHaveBeenCalled());
    expect(await titleOnDisk()).toBe("Closed quickly");
  });

  it("stays open and says so when it can't write; closing again quits anyway", async () => {
    const window = await editTitle("Can't be written");
    chmodSync(join(bundle, "tables", "tasks"), 0o555);
    await fireEvent(window, "close-request");
    expect(await screen.findByText("Not everything could be saved")).toBeDefined();
    expect(quit).not.toHaveBeenCalled();
    // Read and dismissed, then closed again.
    await userEvent.click(await screen.findByText("OK"));
    await fireEvent(window, "close-request");
    expect(quit).toHaveBeenCalled();
  });

  it("a failed save can be tried again, and then it's written", async () => {
    chmodSync(join(bundle, "tables", "tasks"), 0o555);
    await editTitle("Tried again");
    let retry: Gtk.Button | undefined;
    await waitFor(async () => {
      retry = (await screen.findAllByRole(Gtk.AccessibleRole.BUTTON)).find((b) => b.getTooltipText()?.startsWith("Not saved")) as Gtk.Button | undefined;
      expect(retry).toBeDefined();
    });
    chmodSync(join(bundle, "tables", "tasks"), 0o755);
    await userEvent.click(retry!);
    await waitFor(async () => expect(await titleOnDisk()).toBe("Tried again"));
  });
});

