import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { bundleToArchive, openArchive, toBundle } from "@workspace.sh/table-app";
import { copiesOf, jsonFileStore, loadLibrary } from "@workspace.sh/table-app/node";
import { parseEditLog } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { loadClosed } from "../src/closedFiles.js";
import { fixturesDir } from "../src/fixtures.js";

// Opening a .table folder or a single-file .table, exporting one, and putting the
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
  it("Open… opens a .table folder from disk, picked by its manifest, edited where it is", async () => {
    const crm = join(dir, "elsewhere", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), crm, { recursive: true });
    await openExamples({ chooseToOpen: async () => join(crm, "meta.json") });
    await run("open");
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

  it("Open… opens a single-file .table as a new .table beside the examples", async () => {
    const budget = await loadLibrary([join(fixturesDir()!, "household-budget.table")]);
    const zip = join(dir, "budget.table");
    writeFileSync(zip, await bundleToArchive("household-budget", toBundle(budget.tables, budget.bundles, "household-budget")));
    await openExamples({ chooseToOpen: async () => zip });
    await run("open");
    // The examples already hold a household-budget.table folder: the archive
    // is named apart from it, and that folder is left as it was.
    const before = readFileSync(join(examples, "household-budget.table", "meta.json"), "utf8");
    expect(await screen.findByText(/^Household budget \(household-budget-2\.table\)/)).toBeDefined();
    await waitFor(() => expect(existsSync(join(examples, "household-budget-2.table", "meta.json"))).toBe(true));
    expect(readFileSync(join(examples, "household-budget.table", "meta.json"), "utf8")).toBe(before);
  });

  it("with a folder of your own open, Open… makes a single file's .table beside it", async () => {
    const own = join(dir, "mine", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), own, { recursive: true });
    const budget = await loadLibrary([join(examples, "household-budget.table")]);
    const zip = join(dir, "budget.table");
    writeFileSync(zip, await bundleToArchive("household-budget", toBundle(budget.tables, budget.bundles, "household-budget")));
    // No examples library: the app was started on that one folder.
    const library = await loadLibrary([own]);
    await render(<App library={library} initialTable="crm/companies" chooseToOpen={async () => zip} />);
    await run("open");
    await waitFor(() => expect(existsSync(join(dir, "mine", "household-budget.table", "meta.json"))).toBe(true));
  });

  it("Open Spreadsheet… makes a CSV a new .table: its headings the columns, its lines the rows, shown and saved", async () => {
    const csv = join(dir, "Q4_invoices.csv");
    writeFileSync(csv, "Client Name,Due Date,Amount (GBP),Paid\nAda & Co,2026-11-01,1200.50,true\nGrace Ltd,2026-12-15,80,false\n");
    await openExamples({ chooseSpreadsheet: async () => csv });
    await run("open-spreadsheet");
    // On screen: the file by its name, the headings as written, the cells.
    expect(await screen.findByText(/^Q4 invoices \(q4-invoices\.table\)/)).toBeDefined();
    await screen.findByText("Client Name");
    await screen.findByText("Amount (GBP)");
    await screen.findAllByText("Ada & Co");
    await screen.findAllByText("2026-12-15");
    // And a .table folder on disk, beside the examples, that reads back as a table.
    const made = join(examples, "q4-invoices.table", "tables", "q4-invoices");
    await waitFor(() => expect(existsSync(join(made, "rows.ndjson"))).toBe(true));
    const table = await parseTable(made);
    expect(table.schema.fields.map((f) => [f.name, f.title, f.type])).toEqual([
      ["client_name", "Client Name", "string"],
      ["due_date", "Due Date", "date"],
      ["amount_gbp", "Amount (GBP)", "number"],
      ["paid", "Paid", "boolean"],
    ]);
    expect(table.rows.map(({ id: _id, ...rest }) => rest)).toEqual([
      { client_name: "Ada & Co", due_date: "2026-11-01", amount_gbp: 1200.5, paid: true },
      { client_name: "Grace Ltd", due_date: "2026-12-15", amount_gbp: 80, paid: false },
    ]);
    // The spreadsheet itself is left as it was.
    expect(readFileSync(csv, "utf8")).toContain("Ada & Co,2026-11-01");
    // It is a table like any other: a cell edited is saved.
    await userEvent.click((await screen.findAllByText("Grace Ltd"))[0]!);
    const entry = (await screen.findByDisplayValue("Grace Ltd")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Grace & Sons");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await parseTable(made)).rows.map((r) => r.client_name)).toContain("Grace & Sons"));
  });

  it("a spreadsheet from older Excel (Windows-1252, semicolons) opens with its letters and columns right; an empty one is refused", async () => {
    const old = join(dir, "kunden.csv");
    writeFileSync(old, Buffer.concat([Buffer.from("Name;Stadt;Betrag\nCaf", "latin1"), Buffer.from([0xe9]), Buffer.from(" M", "latin1"), Buffer.from([0xfc]), Buffer.from("ller;K", "latin1"), Buffer.from([0xf6]), Buffer.from("ln;12\n", "latin1")]));
    let chosen = old;
    await openExamples({ chooseSpreadsheet: async () => chosen });
    await run("open-spreadsheet");
    await screen.findAllByText("Café Müller");
    await screen.findAllByText("Köln");
    const made = join(examples, "kunden.table", "tables", "kunden");
    await waitFor(() => expect(existsSync(join(made, "rows.ndjson"))).toBe(true));
    expect((await parseTable(made)).rows.map((r) => [r.name, r.stadt, r.betrag])).toEqual([["Café Müller", "Köln", 12]]);
    const empty = join(dir, "empty.csv");
    writeFileSync(empty, "\n");
    chosen = empty;
    await run("open-spreadsheet");
    expect(await screen.findByText("Couldn't open empty.csv: there's nothing in it")).toBeDefined();
    expect(existsSync(join(examples, "empty.table"))).toBe(false);
  });

  it("a file that isn't a .table is refused, and says why", async () => {
    const junk = join(dir, "junk.table");
    writeFileSync(junk, "not a zip");
    await openExamples({ chooseToOpen: async () => junk });
    await run("open");
    expect(await screen.findByText(/^Couldn't open junk\.table: /)).toBeDefined();
  });

  it("Export as a Single File… saves the open table's .table as one file, every table in it", async () => {
    const out = join(dir, "out.table");
    let suggested = "";
    await openExamples({
      chooseSaveAs: async (name) => {
        suggested = name;
        return out;
      },
    });
    await run("export-file");
    await waitFor(() => expect(existsSync(out)).toBe(true));
    expect(suggested).toBe("projects.table");
    const opened = await openArchive(new Uint8Array(readFileSync(out)), []);
    expect(Object.keys(opened.bundle.tables).sort()).toEqual(["projects", "tasks"]);
  });

  it("a table's edit history goes out in its single file, and comes back in when the file is opened", async () => {
    const out = join(dir, "out.table");
    await openExamples({ chooseSaveAs: async () => out, chooseToOpen: async () => out });
    // An edit, so the table has a history.
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Renamed task");
    await userEvent.keyboard(entry, "{Enter}");
    // Exported at once: what is still to write is written first.
    await run("export-file");
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
    await run("open");
    const copy = join(examples, "projects-2.table", "tables", "tasks");
    await waitFor(() => expect(existsSync(join(copy, "history.ndjson"))).toBe(true));
    expect(readFileSync(join(copy, "history.ndjson"), "utf8")).toBe(onDisk);
    expect(existsSync(join(examples, "projects-2.table", "tables", "projects", "history.ndjson"))).toBe(false);
  });

  it("an edit to a table that came with a history is added after it", async () => {
    const theirs = '{"id":"theirs","at":"2026-01-01T00:00:00Z","by":"someone","op":"set","row":"t1","field":"title","to":"Land .table extension"}\n';
    const projects = await loadLibrary([join(fixturesDir()!, "projects.table")]);
    const tables = { ...projects.tables, "projects/tasks": { ...projects.tables["projects/tasks"]!, history: theirs } };
    const zip = join(dir, "with-history.table");
    writeFileSync(zip, await bundleToArchive("arrived", toBundle(Object.fromEntries(Object.entries(tables).map(([k, t]) => [k.replace("projects/", "arrived/"), t])), { arrived: projects.bundles.projects! }, "arrived")));
    await openExamples({ chooseToOpen: async () => zip });
    await run("open");
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

  // Close File: from a file's heading in the sidebar (a right-click), and from the main menu for the file on screen.
  async function fileMenu(title: string): Promise<Gtk.MenuButton | undefined> {
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON);
    return buttons.find((b) => b instanceof Gtk.MenuButton && b.getTooltipText() === `File Actions for ${title}`) as Gtk.MenuButton | undefined;
  }
  /** A question's answer: its button in the dialog asking (the window has a Close of its own). */
  const answer = async (label: string): Promise<Gtk.Button> => {
    let found: Gtk.Button | undefined;
    await waitFor(() => {
      found = screen.queryAllByRole(Gtk.AccessibleRole.BUTTON, { name: label }).find((b) => {
        for (let w: Gtk.Widget | null = b; w; w = w.getParent()) if (w instanceof Adw.AlertDialog) return true;
        return false;
      }) as Gtk.Button | undefined;
      expect(found, `the answer ${label}`).toBeDefined();
    });
    return found!;
  };
  const windowOf = async () => (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow;

  it("closing an example asks first; Close takes it out of the sidebar and removes the app's copy, and it stays closed", async () => {
    const settings = jsonFileStore(join(dir, "settings.json"));
    const library = await loadLibrary([join(examples, "projects.table"), join(examples, "crm.table")]);
    await render(<App library={library} initialTable="projects/tasks" initialView="v1" newFilesIn={examples} settings={settings} />);
    const copy = join(examples, "crm.table");
    expect(existsSync(copy)).toBe(true);
    (await fileMenu("CRM"))!.activateAction("file.close", null);
    await screen.findByText("Close “CRM”?");
    await screen.findByText("This app's copy is removed. A file you opened it from isn't touched.");
    // Cancelled, nothing changes.
    (await answer("Cancel")).activate();
    await waitFor(() => expect(screen.queryByText("Close “CRM”?")).toBeNull());
    expect(await fileMenu("CRM")).toBeDefined();
    expect(existsSync(copy)).toBe(true);

    (await fileMenu("CRM"))!.activateAction("file.close", null);
    (await answer("Close")).activate();
    await waitFor(async () => expect(await fileMenu("CRM")).toBeUndefined());
    expect(screen.queryAllByText("Companies")).toHaveLength(0);
    await waitFor(() => expect(existsSync(copy)).toBe(false));
    // The other file is as it was, on screen and on disk.
    await screen.findAllByText("Land .table extension");
    expect(existsSync(join(examples, "projects.table", "tables", "tasks", "rows.ndjson"))).toBe(true);
    // Kept with the viewer's settings, so the next launch doesn't copy the example back.
    await waitFor(() => expect(loadClosed(jsonFileStore(join(dir, "settings.json")))).toEqual(["crm"]));
    copiesOf(fixturesDir()!, examples, loadClosed(jsonFileStore(join(dir, "settings.json"))));
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(join(examples, "household-budget.table"))).toBe(true);
  });

  it("closing a folder of your own leaves the folder where it is, and says so", async () => {
    const own = join(dir, "mine", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), own, { recursive: true });
    const before = readFileSync(join(own, "tables", "companies", "rows.ndjson"), "utf8");
    const library = await loadLibrary([join(examples, "projects.table"), own]);
    await render(<App library={library} initialTable="crm/companies" newFilesIn={examples} />);
    // From the main menu: the file on screen.
    const window = await windowOf();
    expect(window.getActionEnabled("close-file")).toBe(true);
    window.activateAction("win.close-file", null);
    await screen.findByText("Close “CRM”?");
    await screen.findByText("The folder stays where it is, and can be opened again.");
    (await answer("Close")).activate();
    await waitFor(async () => expect(await fileMenu("CRM")).toBeUndefined());
    // Another file is on screen now.
    await screen.findAllByText("Projects");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(readFileSync(join(own, "tables", "companies", "rows.ndjson"), "utf8")).toBe(before);
    expect(existsSync(join(own, "meta.json"))).toBe(true);
  });

  it("with no examples library, a file made beside your folder is yours too: closing it leaves it there", async () => {
    const own = join(dir, "mine", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), own, { recursive: true });
    const library = await loadLibrary([own]);
    await render(<App library={library} initialTable="crm/companies" />);
    // A new file, made beside the folder that is open.
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "New .table File" }));
    const entry = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    await userEvent.type(entry, "Garden");
    await userEvent.keyboard(entry, "{Enter}");
    const made = join(dir, "mine", "garden.table");
    await waitFor(() => expect(existsSync(join(made, "meta.json"))).toBe(true));
    (await fileMenu("Garden"))!.activateAction("file.close", null);
    // It is a folder of the viewer's, though the app made it: it stays.
    await screen.findByText("The folder stays where it is, and can be opened again.");
    (await answer("Close")).activate();
    await waitFor(async () => expect(await fileMenu("Garden")).toBeUndefined());
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(existsSync(join(made, "meta.json"))).toBe(true);
  });

  it("the last file open can't be closed", async () => {
    await openExamples();
    expect(await fileMenu("Projects")).toBeUndefined();
    expect((await windowOf()).getActionEnabled("close-file")).toBe(false);
  });

  it("Reset Demo Data… puts the examples back, and keeps a folder opened from elsewhere", async () => {
    const crm = join(dir, "elsewhere", "crm.table");
    cpSync(join(fixturesDir()!, "crm.table"), crm, { recursive: true });
    const tasks = join(examples, "projects.table", "tables", "tasks");
    const resetExamples = (held: string[]) => {
      rmSync(examples, { recursive: true, force: true });
      return loadLibrary(copiesOf(fixturesDir()!, examples).filter((p) => p.endsWith("projects.table")), held);
    };
    await openExamples({ chooseToOpen: async () => crm, resetExamples });
    // An edit to the example, saved.
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Edited");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await parseTable(tasks)).rows.find((r) => r.id === "t1")?.title).toBe("Edited"));
    await run("open");
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
