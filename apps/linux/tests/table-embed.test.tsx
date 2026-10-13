import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkScrolledWindow, GtkWindow } from "@gtkx/jsx/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { parseEditLog } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { EMBED_MAX_HEIGHT, readEmbed, TableEmbed } from "@workspace.sh/table-gtk/embed";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

// A .table drawn in a document: the folder is laid out as a workspace is,
// documents in one folder and tables in another, and each address is
// written as a document there would write it.
let root: string;
let docs: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "table-embed-"));
  docs = join(root, "notes");
  mkdirSync(docs);
  mkdirSync(join(root, "tables"));
  for (const name of ["projects.table", "crm.table"]) cpSync(join(fixturesDir()!, name), join(root, "tables", name), { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(root, { recursive: true, force: true });
});

const read = (address: string, within: string | undefined = root) => readEmbed({ address, baseDir: docs, within });

const problemOf = async (address: string, within?: string) => {
  const result = await read(address, within);
  return result.kind === "problem" ? result.text : `shown: ${result.key}`;
};

describe("what an embed's address names", () => {
  it("is the table and the view the link names", async () => {
    const result = await read("../tables/projects.table#table=tasks&view=v2&embed=1");
    expect(result.kind).toBe("shown");
    if (result.kind !== "shown") return;
    expect(result.key).toBe("projects/tasks");
    expect(result.viewId).toBe("v2");
    expect(result.library.tables[result.key]!.rows).toHaveLength(8);
    expect(Object.keys(result.library.tables).sort()).toEqual(["projects/projects", "projects/tasks"]);
    expect(result.library.paths).toEqual({ projects: join(root, "tables", "projects.table") });
  });

  it("is the table's first view when the link names none", async () => {
    const result = await read("../tables/crm.table#table=deals&embed=1");
    expect(result.kind === "shown" && result.viewId).toBe("pipeline");
  });

  it("reads a path written with percent signs", async () => {
    cpSync(join(root, "tables", "projects.table"), join(root, "tables", "my projects.table"), { recursive: true });
    const result = await read("../tables/my%20projects.table#table=tasks&embed=1");
    expect(result.kind).toBe("shown");
  });

  it("says a file isn't there", async () => {
    expect(await problemOf("../tables/nowhere.table#embed=1")).toBe("There’s no table at “../tables/nowhere.table”.");
  });

  it("says which tables a file has when the link names one it doesn't, or names none of several", async () => {
    expect(await problemOf("../tables/projects.table#table=nope&embed=1")).toBe("“projects.table” has no table named “nope”. It has “projects”, “tasks”.");
    expect(await problemOf("../tables/projects.table#embed=1")).toBe("“projects.table” holds 2 tables. The link says which with “table=”: “projects”, “tasks”.");
  });

  it("says which views a table has when the link names one it doesn't", async () => {
    expect(await problemOf("../tables/projects.table#table=tasks&view=nope&embed=1")).toBe("The table “tasks” has no view “nope”. It has “v1”, “v2”.");
  });

  it("won't read a table outside the folder that was opened, by its path or through a link", async () => {
    const outside = mkdtempSync(join(tmpdir(), "table-embed-outside-"));
    try {
      cpSync(join(fixturesDir()!, "projects.table"), join(outside, "projects.table"), { recursive: true });
      const address = `${outside}/projects.table#table=tasks&embed=1`;
      expect(await problemOf(address)).toBe(`“${outside}/projects.table” is outside the folder that’s open, so it isn’t shown.`);
      // With nothing to stay inside, the same address is read.
      expect((await readEmbed({ address, baseDir: docs })).kind).toBe("shown");
      symlinkSync(join(outside, "projects.table"), join(root, "tables", "linked.table"));
      expect(await problemOf("../tables/linked.table#table=tasks&embed=1")).toBe("“../tables/linked.table” is outside the folder that’s open, so it isn’t shown.");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("says a file that isn't a .table isn't one", async () => {
    writeFileSync(join(root, "tables", "notes.table"), "not a folder");
    mkdirSync(join(root, "tables", "empty.table"));
    expect(await problemOf("../tables/notes.table#embed=1")).toBe("“notes.table” isn’t a .table.");
    expect(await problemOf("../tables/empty.table#embed=1")).toBe("“empty.table” isn’t a .table, or it holds no tables.");
  });
});

// As a document holds it: in a window, in something that scrolls, at the text's width.
const inDocument = (embed: React.ReactNode) => (
  <GtkWindow defaultWidth={720} defaultHeight={900}>
    <GtkScrolledWindow>
      <GtkBox orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.START}>
        {embed}
      </GtkBox>
    </GtkScrolledWindow>
  </GtkWindow>
);

describe("a table drawn in a document", () => {
  it("shows the view's rows, with the caption beneath", async () => {
    await render(inDocument(<TableEmbed address="../tables/projects.table#table=tasks&view=v1&embed=1" baseDir={docs} within={root} caption="All tasks by priority" />));
    expect(await screen.findByText("Land .table extension")).toBeDefined();
    const caption = await screen.findByText("All tasks by priority");
    expect(caption.getName()).toBe("table-embed-caption");
    // The library's own table view, above the caption.
    expect(caption.getParent()!.getName()).toBe("table-embed");
    expect(caption.getPrevSibling()!.getFirstChild()).toBeInstanceOf(Gtk.ScrolledWindow);
  });

  it("is as tall as its rows when they are few, and no taller than the limit when they are many", async () => {
    await render(
      inDocument(
        <>
          <GtkBox name="few">
            <TableEmbed address="../tables/crm.table#table=companies&view=all&embed=1" baseDir={docs} within={root} />
          </GtkBox>
          <GtkBox name="many">
            <TableEmbed address="../tables/projects.table#table=projects&view=v1&embed=1" baseDir={docs} within={root} />
          </GtkBox>
        </>,
      ),
    );
    const [few, many] = await Promise.all(["few", "many"].map(async (name) => (await screen.findAllByName(name))[0]!));
    // The table's own scroller: inside the embed, inside the box that takes its keys.
    const scroller = (box: Gtk.Widget) => box.getFirstChild()!.getFirstChild()!.getFirstChild() as Gtk.ScrolledWindow;
    await waitFor(() => {
      // Six rows: all of them shown, with nothing to scroll.
      const fewDown = scroller(few).getVadjustment();
      expect(few.getHeight()).toBeGreaterThan(6 * 45 + 36);
      expect(few.getHeight()).toBeLessThan(EMBED_MAX_HEIGHT);
      expect(fewDown.getUpper()).toBe(fewDown.getPageSize());
      // Seventeen: the limit, and the rest scrolled to within it.
      const manyDown = scroller(many).getVadjustment();
      expect(many.getHeight()).toBe(EMBED_MAX_HEIGHT);
      expect(manyDown.getUpper()).toBeGreaterThan(17 * 45);
      // What holds it gives it the least it asks for (a document's text does): that is its whole height.
      expect(many.measure(Gtk.Orientation.VERTICAL, -1)[0]).toBe(EMBED_MAX_HEIGHT);
      expect(few.measure(Gtk.Orientation.VERTICAL, -1)[0]).toBe(few.getHeight());
    });
  });

  it("names a linked row in full, and hands its address to the app when it is clicked", async () => {
    const opened: string[] = [];
    const address = "../tables/projects.table#table=tasks&view=v1&embed=1";
    const first = await render(inDocument(<TableEmbed address={address} baseDir={docs} within={root} />));
    // With nowhere to go, it is the row's name, whole.
    const names = (await screen.findAllByText("Table file format spike")) as Gtk.Label[];
    expect(names.length).toBeGreaterThan(0);
    await waitFor(() => expect(names[0]!.getWidth()).toBeGreaterThan(100));
    expect(names[0]!.getLayout().isEllipsized()).toBe(false);
    await first.unmount();

    await render(inDocument(<TableEmbed address={address} baseDir={docs} within={root} onOpenLink={(to) => opened.push(to)} />));
    await userEvent.click((await screen.findAllByText("Table file format spike"))[0]!);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("row=p2");
  });

  it("draws a board for a board view", async () => {
    await render(inDocument(<TableEmbed address="../tables/projects.table#table=tasks&view=v2&embed=1" baseDir={docs} within={root} />));
    // A column for each status, each headed by it.
    expect((await screen.findAllByText("Land .table extension")).length).toBe(1);
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    expect(embed.getHeight()).toBeGreaterThan(100);
    expect(embed.getHeight()).toBeLessThanOrEqual(EMBED_MAX_HEIGHT);
  });

  it("says why in the table's place when it can't be drawn, and still shows the caption", async () => {
    await render(inDocument(<TableEmbed address="../tables/projects.table#table=nope&embed=1" baseDir={docs} within={root} caption="No such table" />));
    const why = await screen.findByText("“projects.table” has no table named “nope”. It has “projects”, “tasks”.");
    expect(why.getParent()!.getName()).toBe("table-embed-problem");
    expect(await screen.findByText("No such table")).toBeDefined();
  });
});

// It is the table, not a picture of it: what is done to it in the document
// is in the file, read back here as opening it again would.
describe("a table edited in a document", () => {
  const tasksDir = () => join(root, "tables", "projects.table", "tables", "tasks");
  const tasksOnDisk = () => parseTable(tasksDir());
  const history = () => {
    const file = join(tasksDir(), "history.ndjson");
    return existsSync(file) ? parseEditLog(readFileSync(file, "utf8")).events : [];
  };
  const tasks = () => render(inDocument(<TableEmbed address="../tables/projects.table#table=tasks&view=v1&embed=1" baseDir={docs} within={root} />));

  it("saves a cell retyped to the file, and says so in its history", async () => {
    await tasks();
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Renamed in a document");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => {
      expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Renamed in a document");
      expect(history()).toMatchObject([{ op: "set", row: "t1", field: "title", from: "Land .table extension", to: "Renamed in a document" }]);
    });
  });

  it("takes the edit back with Ctrl+Z, in the file too", async () => {
    await tasks();
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Renamed in a document");
    await userEvent.keyboard(entry, "{Enter}");
    const renamed = await screen.findByText("Renamed in a document");
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Renamed in a document"));
    await userEvent.keyboard(renamed, "{Control>}z{/Control}");
    expect(await screen.findByText("Land .table extension")).toBeDefined();
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Land .table extension"));
  });

  it("adds a row from “+ New row”, saved with what is typed", async () => {
    await tasks();
    await userEvent.click(await screen.findByText("+ New row"));
    const entry = (await screen.findAllByDisplayValue("")).find((w) => w instanceof Gtk.Entry) as Gtk.Entry;
    await userEvent.type(entry, "Added in a document");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(async () => expect((await tasksOnDisk()).rows.at(-1)?.title).toBe("Added in a document"));
  });

  it("read-only, has nothing to edit with: no editor on a click, no new row, and Ctrl+Z does nothing", async () => {
    await render(inDocument(<TableEmbed address="../tables/projects.table#table=tasks&view=v1&embed=1" baseDir={docs} within={root} readOnly />));
    const title = await screen.findByText("Land .table extension");
    await userEvent.click(title);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByDisplayValue("Land .table extension")).toBeNull();
    expect(screen.queryByText("+ New row")).toBeNull();
    const before = readFileSync(join(tasksDir(), "rows.ndjson"), "utf8");
    await cleanup();
    expect(readFileSync(join(tasksDir(), "rows.ndjson"), "utf8")).toBe(before);
    expect(history()).toEqual([]);
  });

  it("says what was typed in a row's page when the document lets go of it, as closing the page would", async () => {
    const page = join(root, "tables", "projects.table", "tables", "projects", "bodies", "p2.md");
    const pageHistory = () => {
      const file = join(root, "tables", "projects.table", "tables", "projects", "history.ndjson");
      return existsSync(file) ? parseEditLog(readFileSync(file, "utf8")).events : [];
    };
    const before = readFileSync(page, "utf8");
    await render(inDocument(<TableEmbed address="../tables/projects.table#table=projects&view=v7&embed=1" baseDir={docs} within={root} />));
    await userEvent.click(await screen.findByText("Table file format spike"));
    const text = (await screen.findAllByRole(Gtk.AccessibleRole.TEXT_BOX)).find((w) => w instanceof Gtk.TextView) as Gtk.TextView;
    await userEvent.type(text, " Typed in a document.");
    // Saved as it is typed; said in the history only once the typing is over.
    await waitFor(() => expect(readFileSync(page, "utf8")).toContain("Typed in a document."), { timeout: 5000 });
    expect(pageHistory()).toEqual([]);
    await cleanup();
    await waitFor(() => expect(pageHistory()).toMatchObject([{ op: "page", row: "p2", from: before }]));
  });
});
