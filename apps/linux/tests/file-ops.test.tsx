import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { bundleToArchive, openArchive, toBundle } from "@workspace.sh/table-app";
import { copiesOf, loadLibrary } from "@workspace.sh/table-app/node";
import { parseEditLog } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Opening a .table folder or a .table.zip, exporting one, and putting the
// examples back: the File menu's commands, with the file chooser's answers
// given by the test.

let dir: string;
let examples: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-files-"));
  examples = join(dir, "examples");
  copiesOf(fixturesDir()!, examples);
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** The examples, as the demo opens them: projects shown, new files made beside them. */
async function openExamples(props: Partial<Parameters<typeof App>[0]> = {}) {
  const library = await loadLibrary([join(examples, "projects.table")]);
  await render(<App library={library} initialTable="projects/tasks" initialView="v1" newFilesIn={examples} {...props} />);
}

async function run(action: string) {
  const button = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" });
  (button.getRoot() as unknown as Gtk.ApplicationWindow).activateAction(`win.${action}`, null);
}

describe("the File menu on Linux", () => {
  it("Open .table… opens a folder from disk, edited where it is", async () => {
    const crm = join(dir, "elsewhere", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), crm, { recursive: true });
    await openExamples({ chooseFolder: async () => crm });
    await run("open-folder");
    expect(await screen.findByText("CRM (crm.table) › Companies")).toBeDefined();
    // An edit to it is written where it is, not beside the examples.
    await userEvent.click(await screen.findByText("Northwind Traders"));
    const entry = (await screen.findByDisplayValue("Northwind Traders")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Northwind Ltd");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => {
      const companies = await parseTable(join(crm, "tables", "companies"));
      expect(companies.rows.some((r) => r.name === "Northwind Ltd")).toBe(true);
    });
    // The examples' own crm.table, which wasn't the one opened, is as it was.
    const example = await parseTable(join(examples, "crm.table", "tables", "companies"));
    expect(example.rows.some((r) => r.name === "Northwind Ltd")).toBe(false);
  });

  it("Open .table.zip… opens an archive as a new .table beside the examples", async () => {
    const budget = await loadLibrary([join(fixturesDir()!, "household-budget.table")]);
    const zip = join(dir, "budget.table.zip");
    writeFileSync(zip, await bundleToArchive("household-budget", toBundle(budget.tables, budget.bundles, "household-budget")));
    await openExamples({ chooseZip: async () => zip });
    await run("open-zip");
    // The examples already hold a household-budget.table folder: the archive
    // is named apart from it, and that folder is left as it was.
    const before = readFileSync(join(examples, "household-budget.table", "meta.json"), "utf8");
    expect(await screen.findByText(/^Household budget \(household-budget-2\.table\)/)).toBeDefined();
    await waitFor(() => expect(existsSync(join(examples, "household-budget-2.table", "meta.json"))).toBe(true));
    expect(readFileSync(join(examples, "household-budget.table", "meta.json"), "utf8")).toBe(before);
  });

  it("with a folder of your own open, Open .table.zip… makes the archive's .table beside it", async () => {
    const own = join(dir, "mine", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), own, { recursive: true });
    const budget = await loadLibrary([join(examples, "household-budget.table")]);
    const zip = join(dir, "budget.table.zip");
    writeFileSync(zip, await bundleToArchive("household-budget", toBundle(budget.tables, budget.bundles, "household-budget")));
    // No examples library: the app was started on that one folder.
    const library = await loadLibrary([own]);
    await render(<App library={library} initialTable="crm/companies" chooseZip={async () => zip} />);
    await run("open-zip");
    await waitFor(() => expect(existsSync(join(dir, "mine", "household-budget.table", "meta.json"))).toBe(true));
  });

  it("a file that isn't a .table.zip is refused, and says why", async () => {
    const junk = join(dir, "junk.zip");
    writeFileSync(junk, "not a zip");
    await openExamples({ chooseZip: async () => junk });
    await run("open-zip");
    expect(await screen.findByText(/^Couldn't open junk\.zip: /)).toBeDefined();
  });

  it("Export .table.zip… saves the open table's .table, every table in it", async () => {
    const out = join(dir, "out.table.zip");
    let suggested = "";
    await openExamples({
      chooseZipSaveAs: async (name) => {
        suggested = name;
        return out;
      },
    });
    await run("export-zip");
    await waitFor(() => expect(existsSync(out)).toBe(true));
    expect(suggested).toBe("projects.table.zip");
    const opened = await openArchive(new Uint8Array(readFileSync(out)), []);
    expect(Object.keys(opened.bundle.tables).sort()).toEqual(["projects", "tasks"]);
  });

  it("a table's edit history goes out in its .table.zip, and comes back in when the archive is opened", async () => {
    const out = join(dir, "out.table.zip");
    await openExamples({ chooseZipSaveAs: async () => out, chooseZip: async () => out });
    // An edit, so the table has a history.
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Renamed task");
    await userEvent.keyboard(entry, "{Enter}");
    // Exported at once: what is still to write is written first.
    await run("export-zip");
    await waitFor(() => expect(existsSync(out)).toBe(true));
    const onDisk = readFileSync(join(examples, "projects.table", "tables", "tasks", "history.ndjson"), "utf8");
    const events = parseEditLog(onDisk).events;
    expect(events.map((e) => e.op === "set" && e.to)).toEqual(["Renamed task"]);
    const opened = await openArchive(new Uint8Array(readFileSync(out)), []);
    expect(opened.bundle.tables.tasks!.history).toBe(onDisk);
    // The table that was never edited has none.
    expect("history" in opened.bundle.tables.projects!).toBe(false);
    expect(opened.bundle.tables.tasks!.rows.find((r) => r.id === "t1")?.title).toBe("Renamed task");

    // Opened again as a new .table: its folder has the history it came with.
    await run("open-zip");
    const copy = join(examples, "projects-2.table", "tables", "tasks");
    await waitFor(() => expect(existsSync(join(copy, "history.ndjson"))).toBe(true));
    expect(readFileSync(join(copy, "history.ndjson"), "utf8")).toBe(onDisk);
    expect(existsSync(join(examples, "projects-2.table", "tables", "projects", "history.ndjson"))).toBe(false);
  });

  it("an edit to a table that came with a history is added after it", async () => {
    const theirs = '{"id":"theirs","at":"2026-01-01T00:00:00Z","by":"someone","op":"set","row":"t1","field":"title","to":"Land .table extension"}\n';
    const projects = await loadLibrary([join(fixturesDir()!, "projects.table")]);
    const tables = { ...projects.tables, "projects/tasks": { ...projects.tables["projects/tasks"]!, history: theirs } };
    const zip = join(dir, "with-history.table.zip");
    writeFileSync(zip, await bundleToArchive("arrived", toBundle(Object.fromEntries(Object.entries(tables).map(([k, t]) => [k.replace("projects/", "arrived/"), t])), { arrived: projects.bundles.projects! }, "arrived")));
    await openExamples({ chooseZip: async () => zip });
    await run("open-zip");
    const file = join(examples, "arrived.table", "tables", "tasks", "history.ndjson");
    await waitFor(() => expect(existsSync(file)).toBe(true));
    expect(readFileSync(file, "utf8")).toBe(theirs);
    // The archive's table is on screen: edit it.
    await userEvent.click((await screen.findAllByText("Tasks")).at(-1)!);
    await userEvent.click(await screen.findByText("Markdown editor polish"));
    const entry = (await screen.findByDisplayValue("Markdown editor polish")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Polished");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(parseEditLog(readFileSync(file, "utf8")).events).toHaveLength(2));
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(theirs)).toBe(true);
    expect(parseEditLog(text).events.map((e) => e.id === "theirs" || (e.op === "set" && e.to))).toEqual([true, "Polished"]);
  });

  it("Reset Demo Data… puts the examples back, and keeps a folder opened from elsewhere", async () => {
    const crm = join(dir, "elsewhere", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), crm, { recursive: true });
    const tasks = join(examples, "projects.table", "tables", "tasks");
    const resetExamples = (held: string[]) => {
      rmSync(examples, { recursive: true, force: true });
      return loadLibrary(copiesOf(fixturesDir()!, examples).filter((p) => p.endsWith("projects.table")), held);
    };
    await openExamples({ chooseFolder: async () => crm, resetExamples });
    // An edit to the example, saved.
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Edited");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await parseTable(tasks)).rows.find((r) => r.id === "t1")?.title).toBe("Edited"));
    await run("open-folder");
    await screen.findByText("CRM (crm.table) › Companies");
    await run("reset-data");
    // The question says the opened folder isn't touched.
    expect(await screen.findByText(/Folders you opened from disk aren't touched\.$/)).toBeDefined();
    await userEvent.click(await screen.findByText("Reset"));
    await waitFor(async () => expect((await parseTable(tasks)).rows.find((r) => r.id === "t1")?.title).toBe("Land .table extension"));
    // Once the reset shows (the examples' first table), the opened folder is still there.
    expect(await screen.findByText("Projects (projects.table)")).toBeDefined();
    expect(await screen.findByText("Companies")).toBeDefined();
  });
});
