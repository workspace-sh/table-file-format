import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A checkbox that takes rows out of the view they're in (#598): GNOME's
// toast says so, counting them as they go, and Undo puts them all back.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-departed-"));
  bundle = join(dir, "library.table");
  cpSync(join(fixturesDir()!, "library.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const count = async () => ((await screen.findByText(/^[\d,]+ of [\d,]+ rows$/)) as Gtk.Label).getLabel();

describe("rows a checkbox takes out of the view", () => {
  it("are counted in one toast, and Undo puts them all back", async () => {
    const library = await loadLibrary([bundle]);
    await render(<App library={library} initialTable="library/books" initialView="unread" />);
    const before = await count();
    const ticks = async () => (await screen.findAllByRole(Gtk.AccessibleRole.CHECKBOX)).filter((b) => (b as Gtk.CheckButton).getTooltipText() === "read");
    // Read, one book: it leaves To read, and the toast names it.
    await userEvent.click((await ticks())[0]!);
    expect(await screen.findByText(/^“.+” left To read$/)).toBeDefined();
    // Another: the same toast counts them.
    await userEvent.click((await ticks())[0]!);
    expect(await screen.findByText("2 books left To read")).toBeDefined();
    expect(await count()).not.toBe(before);
    // Undo: both back, as one step.
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Undo" }));
    await waitFor(async () => expect(await count()).toBe(before));
  });
});
