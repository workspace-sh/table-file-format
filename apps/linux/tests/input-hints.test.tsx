import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// A cell's editor tells an on-screen keyboard what the column takes
// (table-ui/shared's inputHints), as Gtk.InputPurpose and InputHints.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-hints-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

async function editorFor(shown: string): Promise<Gtk.Entry> {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" />);
  await userEvent.click((await screen.findAllByText(shown))[0]!);
  return (await screen.findByDisplayValue(shown)) as Gtk.Entry;
}

describe("what a cell's editor asks of the keyboard on Linux", () => {
  it("a whole number from 1 asks for digits, uncorrected", async () => {
    const entry = await editorFor("1");
    expect(entry.getInputPurpose()).toBe(Gtk.InputPurpose.DIGITS);
    expect(entry.getInputHints() & Gtk.InputHints.NO_SPELLCHECK).toBeTruthy();
  });

  it("text asks for prose: corrected, sentences capitalised", async () => {
    const entry = await editorFor("Land .table extension");
    expect(entry.getInputPurpose()).toBe(Gtk.InputPurpose.FREE_FORM);
    expect(entry.getInputHints() & Gtk.InputHints.SPELLCHECK).toBeTruthy();
    expect(entry.getInputHints() & Gtk.InputHints.UPPERCASE_SENTENCES).toBeTruthy();
  });
});
