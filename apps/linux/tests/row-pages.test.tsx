import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A row's page, opened from the quick list, edited as text, and read back
// as bodies/{id}.md.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-pages-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const page = (id: string) => join(bundle, "tables", "projects", "bodies", `${id}.md`);

async function openList() {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/projects" initialView="v7" />);
}

async function textView(): Promise<Gtk.TextView> {
  let view: Gtk.TextView | undefined;
  await waitFor(async () => {
    view = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.TextView) as Gtk.TextView | undefined;
    expect(view).toBeDefined();
  });
  return view!;
}

const dialogOf = async () => (await screen.findAllByRole(Gtk.AccessibleRole.DIALOG)).find((w) => w instanceof Adw.Dialog && !(w instanceof Adw.AlertDialog)) as Adw.Dialog;

describe("row pages on Linux", () => {
  it("a row with a page opens it, and Done leaves the edit in its file", async () => {
    await openList();
    await userEvent.click(await screen.findByText("Table file format spike"));
    const view = await textView();
    expect(view.getBuffer().text.startsWith("# Table file format spike")).toBe(true);
    await userEvent.type(view, " Edited.");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Done" }));
    await waitFor(() => expect(readFileSync(page("p2"), "utf8")).toContain("Edited."));
  });

  it("typing is saved after a pause, with the page still open", async () => {
    await openList();
    await userEvent.click(await screen.findByText("Table file format spike"));
    await userEvent.type(await textView(), " Typed.");
    await waitFor(() => expect(readFileSync(page("p2"), "utf8")).toContain("Typed."), { timeout: 5000 });
    expect(await screen.findByText("Saved")).toBeDefined();
  });

  it("a row without a page starts one, saved as a new file", async () => {
    await openList();
    expect(existsSync(page("p1"))).toBe(false);
    await userEvent.click(await screen.findByText("Workspace v1"));
    expect(await screen.findByText("bodies/p1.md · new")).toBeDefined();
    await userEvent.type(await textView(), "# Plan");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Done" }));
    await waitFor(() => expect(readFileSync(page("p1"), "utf8")).toBe("# Plan\n"));
  });

  it("closing the dialog keeps what was typed", async () => {
    await openList();
    await userEvent.click(await screen.findByText("Table file format spike"));
    await userEvent.type(await textView(), " Kept.");
    (await dialogOf()).close();
    await waitFor(() => expect(readFileSync(page("p2"), "utf8")).toContain("Kept."));
  });

  it("wiping a page isn't saved as typed; closing asks, and Keep Editing leaves the file", async () => {
    await openList();
    const before = readFileSync(page("p2"), "utf8");
    await userEvent.click(await screen.findByText("Table file format spike"));
    const view = await textView();
    view.getBuffer().text = "";
    expect(await screen.findByText("Empty, not saved")).toBeDefined();
    (await dialogOf()).close();
    expect(await screen.findByText("Delete this page?")).toBeDefined();
    await userEvent.click(await screen.findByText("Keep Editing"));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(readFileSync(page("p2"), "utf8")).toBe(before);
  });

  it("Delete Page removes the page's file", async () => {
    await openList();
    await userEvent.click(await screen.findByText("Table file format spike"));
    (await textView()).getBuffer().text = "";
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Done" }));
    expect(await screen.findByText("Delete this page?")).toBeDefined();
    await userEvent.click(await screen.findByText("Delete Page"));
    await waitFor(() => expect(existsSync(page("p2"))).toBe(false));
  });
});
