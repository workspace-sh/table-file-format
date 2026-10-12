import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { loadLibrary } from "@workspace.sh/table-app/node";
import { parseEditLog, type EditEvent } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { fixturesDir } from "../src/fixtures.js";

// Each edit made in the app is added to its table's history.ndjson (SPEC
// section 14): read back from the file, beside the rows it changed.

let dir: string;
let bundle: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "table-linux-history-"));
  bundle = join(dir, "projects.table");
  cpSync(join(fixturesDir()!, "projects.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const historyFile = (table: string) => join(bundle, "tables", table, "history.ndjson");
const history = (table: string): EditEvent[] => (existsSync(historyFile(table)) ? parseEditLog(readFileSync(historyFile(table), "utf8")).events : []);
/** Events without what differs each run. */
const said = (events: EditEvent[]) => events.map(({ id: _id, at: _at, ...rest }) => rest);
const tasksOnDisk = () => parseTable(join(bundle, "tables", "tasks"));

async function open(table: string, view: string, pageStillMs?: number) {
  const library = await loadLibrary([bundle]);
  await render(<App library={library} initialTable={`projects/${table}`} initialView={view} pageStillMs={pageStillMs} />);
  return (await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Back" })).getRoot() as unknown as Gtk.ApplicationWindow;
}

async function retype(shown: string, text: string) {
  await userEvent.click((await screen.findAllByText(shown))[0]!);
  const entry = (await screen.findByDisplayValue(shown)) as Gtk.Entry;
  await userEvent.clear(entry);
  await userEvent.type(entry, text);
  await userEvent.keyboard(entry, "{Enter}");
}

async function textView(): Promise<Gtk.TextView> {
  let view: Gtk.TextView | undefined;
  await waitFor(async () => {
    view = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.TextView) as Gtk.TextView | undefined;
    expect(view).toBeDefined();
  });
  return view!;
}

describe("edit history on Linux", () => {
  it("a table that was only looked at has no history file", async () => {
    await open("tasks", "v1");
    await screen.findAllByText("Land .table extension");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(existsSync(historyFile("tasks"))).toBe(false);
  });

  it("a cell edited is one set event, with what it held and what it holds, beside the saved row", async () => {
    await open("tasks", "v1");
    await retype("Land .table extension", "Renamed task");
    await waitFor(() => expect(said(history("tasks"))).toEqual([{ op: "set", row: "t1", field: "title", from: "Land .table extension", to: "Renamed task" }]));
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Renamed task"));
    const [event] = history("tasks");
    expect(event!.id).toMatch(/^[0-9a-z]{25}$/);
    expect(Math.abs(Date.parse(event!.at) - Date.now())).toBeLessThan(60_000);
    expect("by" in event!).toBe(false);
    // One line, ending in a newline; no other table has a history.
    expect(readFileSync(historyFile("tasks"), "utf8")).toMatch(/^\{.*\}\n$/);
    expect(existsSync(historyFile("projects"))).toBe(false);
  });

  it("undo is a new event that sets it back; the first event stays", async () => {
    const window = await open("tasks", "v1");
    await retype("Land .table extension", "Renamed task");
    await waitFor(() => expect(history("tasks")).toHaveLength(1));
    const first = readFileSync(historyFile("tasks"), "utf8");
    window.activateAction("win.undo", null);
    await waitFor(() =>
      expect(said(history("tasks"))).toEqual([
        { op: "set", row: "t1", field: "title", from: "Land .table extension", to: "Renamed task" },
        { op: "set", row: "t1", field: "title", from: "Renamed task", to: "Land .table extension" },
      ]),
    );
    // Only added to.
    expect(readFileSync(historyFile("tasks"), "utf8").startsWith(first)).toBe(true);
  });

  it("a row added is an insert, and what is typed into it a set", async () => {
    await open("tasks", "v1");
    await userEvent.click(await screen.findByText("+ New row"));
    const entry = (await screen.findAllByDisplayValue("")).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    await userEvent.type(entry, "Fresh task");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(history("tasks").map((e) => e.op)).toEqual(["insert", "set"]));
    const [insert, set] = history("tasks");
    // The row it names is the one saved.
    await waitFor(async () => expect((await tasksOnDisk()).rows.at(-1)?.id).toBe(insert!.row));
    const row = (await tasksOnDisk()).rows.at(-1)!;
    expect(insert!.op === "insert" && insert!.values.id).toBe(row.id);
    expect(said([set!])).toEqual([{ op: "set", row: row.id, field: "title", to: "Fresh task" }]);
  });

  it("a history that is already there is only added to, whatever is in it", async () => {
    const theirs = '{"id":"theirs","at":"2026-01-01T00:00:00Z","by":"someone","op":"set","row":"t1","field":"title","to":"Land .table extension"}\nnot a line this reads';
    writeFileSync(historyFile("tasks"), theirs);
    await open("tasks", "v1");
    await retype("Land .table extension", "Renamed task");
    await waitFor(() => expect(history("tasks")).toHaveLength(2));
    const text = readFileSync(historyFile("tasks"), "utf8");
    expect(text.startsWith(theirs + "\n")).toBe(true);
    expect(history("tasks")[0]!.id).toBe("theirs");
  });

  it("a page typed in is one event when it is closed, with the whole text before and after", async () => {
    await open("projects", "v7");
    const before = readFileSync(join(bundle, "tables", "projects", "bodies", "p2.md"), "utf8");
    await userEvent.click(await screen.findByText("Table file format spike"));
    const view = await textView();
    await userEvent.type(view, " One.");
    // Saved as it is typed, but not yet said.
    await waitFor(() => expect(readFileSync(join(bundle, "tables", "projects", "bodies", "p2.md"), "utf8")).toContain("One."), { timeout: 5000 });
    await userEvent.type(view, " Two.");
    await waitFor(() => expect(readFileSync(join(bundle, "tables", "projects", "bodies", "p2.md"), "utf8")).toContain("Two."), { timeout: 5000 });
    expect(history("projects")).toEqual([]);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Done" }));
    await waitFor(() => expect(history("projects")).toHaveLength(1));
    const [event] = history("projects");
    expect(event!.op).toBe("page");
    expect(event!.row).toBe("p2");
    if (event!.op !== "page") throw new Error("not a page event");
    expect(event!.from).toBe(before);
    expect(event!.to).toBe(readFileSync(join(bundle, "tables", "projects", "bodies", "p2.md"), "utf8"));
    expect(event!.to).toContain("One. Two.");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(history("projects")).toHaveLength(1);
  });

  it("a page left open and still is said without being closed", async () => {
    await open("projects", "v7", 900);
    await userEvent.click(await screen.findByText("Table file format spike"));
    await userEvent.type(await textView(), " Still.");
    await waitFor(() => expect(history("projects").map((e) => e.op)).toEqual(["page"]), { timeout: 6000 });
    // Still open.
    await textView();
  });
});
