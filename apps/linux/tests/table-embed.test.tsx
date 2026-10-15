import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkScrolledWindow, GtkWindow } from "@gtkx/jsx/gtk";
import { act, cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { parseEditLog } from "@workspace.sh/table-core";
import { parseTable } from "@workspace.sh/table-core/parser";
import { EMBED_MAX_HEIGHT, indexHostUsers, readEmbed, TableEmbed, TableFile } from "@workspace.sh/table-gtk/embed";
import { openIndexHost } from "@workspace.sh/table-app/node";
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
    // Beneath the table, in the embed's foot.
    const foot = caption.getParent()!;
    expect(foot.getName()).toBe("table-embed-foot");
    expect(foot.getParent()!.getName()).toBe("table-embed");
    expect(foot.getPrevSibling()!.getFirstChild()).toBeInstanceOf(Gtk.ScrolledWindow);
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
    // As the file's address: the .table as it was read, the table and the row.
    expect(opened[0]).toBe(`${join(root, "tables", "projects.table")}#table=projects&row=p2`);
  });

  it("offers the table as a document of its own beside its caption, when the app can open one", async () => {
    const opened: string[] = [];
    const address = "../tables/projects.table#table=tasks&view=v2&embed=1";
    const first = await render(inDocument(<TableEmbed address={address} baseDir={docs} within={root} caption="Tasks by status" />));
    await screen.findByText("Tasks by status");
    expect(screen.queryAllByName("table-embed-open")).toHaveLength(0);
    await first.unmount();

    await render(inDocument(<TableEmbed address={address} baseDir={docs} within={root} caption="Tasks by status" onOpen={(to) => opened.push(to)} />));
    const open = (await screen.findAllByName("table-embed-open"))[0] as Gtk.Button;
    expect(open.getTooltipText()).toBe("Open projects.table");
    await userEvent.click(open);
    // The file, at the table and view drawn.
    expect(opened).toEqual([`${join(root, "tables", "projects.table")}#table=tasks&view=v2`]);
    // The caption is still there, centred under the table.
    expect(await screen.findByText("Tasks by status")).toBeDefined();
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

// How much of a view is shown at once is the link's to say: `rows=` and `cards=` (SPEC section 10).
describe("an embed asked for so many rows or cards", () => {
  const draw = (fragment: string) => render(inDocument(<TableEmbed address={`../tables/projects.table#${fragment}&embed=1`} baseDir={docs} within={root} />));
  // The view's own scroller: inside the embed, inside the box that takes its keys.
  const scrollerOf = async () => {
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    await waitFor(() => expect(embed.getFirstChild()?.getFirstChild()).toBeInstanceOf(Gtk.ScrolledWindow));
    return embed.getFirstChild()!.getFirstChild() as Gtk.ScrolledWindow;
  };
  const shown = (scroller: Gtk.ScrolledWindow) => scroller.getVadjustment().getPageSize();
  const all = (scroller: Gtk.ScrolledWindow) => scroller.getVadjustment().getUpper();
  /** Where a widget ends, down the scroller's own contents. */
  const bottomOf = (widget: Gtk.Widget, scroller: Gtk.ScrolledWindow) => {
    const content = scroller.getFirstChild()!.getFirstChild()!;
    const [, bounds] = widget.computeBounds(content);
    return bounds.getY() + bounds.getHeight();
  };

  it("a table shows its header and that many rows, and scrolls for the rest", async () => {
    await draw("table=tasks&view=v1&rows=3");
    const scroller = await scrollerOf();
    // The header and its rule, then three rows of 44 with theirs.
    await waitFor(() => expect(shown(scroller)).toBe(36 + 1 + 3 * 45));
    expect(all(scroller)).toBeGreaterThan(8 * 45);
    // The embed asks for exactly that much room of the document.
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    await waitFor(() => expect(embed.measure(Gtk.Orientation.VERTICAL, -1)[0]).toBe(36 + 1 + 3 * 45));
  });

  it("more rows than the usual limit holds are shown when the link asks for them", async () => {
    await draw("table=projects&view=v1&rows=12");
    const scroller = await scrollerOf();
    await waitFor(() => expect(shown(scroller)).toBe(36 + 1 + 12 * 45));
    expect(shown(scroller)).toBeGreaterThan(EMBED_MAX_HEIGHT);
    // And that much room is asked of the document, past the usual limit too.
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    await waitFor(() => expect(embed.measure(Gtk.Orientation.VERTICAL, -1)[0]).toBe(36 + 1 + 12 * 45));
  });

  it("a table with no more rows than that is shown whole", async () => {
    await draw("table=tasks&view=v1&rows=20");
    const scroller = await scrollerOf();
    await screen.findByText("OG images");
    await waitFor(() => {
      expect(shown(scroller)).toBeGreaterThan(8 * 45);
      expect(all(scroller)).toBe(shown(scroller));
    });
  });

  it("a list shows that many rows", async () => {
    await draw("table=projects&view=v7&rows=3");
    const scroller = await scrollerOf();
    await waitFor(() => {
      const rows = scroller.getFirstChild()!.getFirstChild()!;
      const third = rows.getFirstChild()!.getNextSibling()!.getNextSibling()!;
      expect(bottomOf(third, scroller)).toBeGreaterThan(60);
      expect(shown(scroller)).toBe(Math.ceil(bottomOf(third, scroller)));
      expect(all(scroller)).toBeGreaterThan(shown(scroller) * 3);
    });
  });

  it("a board shows that many cards down each column", async () => {
    const one = await draw("table=tasks&view=v2&cards=1");
    let scroller = await scrollerOf();
    let oneCard = 0;
    await waitFor(() => {
      // Each column: its heading, then its cards. The first card of every column is shown, and not the second.
      const columns = scroller.getFirstChild()!.getFirstChild()!;
      let first = 0;
      let second = Infinity;
      for (let column = columns.getFirstChild(); column; column = column.getNextSibling()) {
        const card = column.getFirstChild()!.getNextSibling()!;
        first = Math.max(first, bottomOf(card, scroller));
        if (card.getNextSibling()) second = Math.min(second, bottomOf(card.getNextSibling()!, scroller));
      }
      expect(first).toBeGreaterThan(60);
      expect(shown(scroller)).toBeGreaterThanOrEqual(first);
      expect(shown(scroller)).toBeLessThan(second);
      expect(all(scroller)).toBeGreaterThan(shown(scroller));
      oneCard = shown(scroller);
    });
    await one.unmount();

    await draw("table=tasks&view=v2&cards=2");
    scroller = await scrollerOf();
    await waitFor(() => expect(shown(scroller)).toBeGreaterThan(oneCard + 60));
  });

  it("a board with no column of more cards than that is shown whole", async () => {
    await draw("table=tasks&view=v2&cards=5");
    const scroller = await scrollerOf();
    await screen.findByText("OG images");
    await waitFor(() => {
      expect(shown(scroller)).toBeGreaterThan(200);
      expect(all(scroller)).toBe(shown(scroller));
    });
  });

  it("a gallery shows the lines that hold that many cards", async () => {
    await draw("table=projects&view=v6&cards=1");
    const scroller = await scrollerOf();
    await waitFor(() => {
      const lines = scroller.getFirstChild()!.getFirstChild()!;
      const first = lines.getFirstChild()!;
      expect(bottomOf(first, scroller)).toBeGreaterThan(60);
      expect(shown(scroller)).toBeGreaterThanOrEqual(bottomOf(first, scroller));
      expect(shown(scroller)).toBeLessThan(bottomOf(first.getNextSibling()!, scroller));
    });
  });

  it("a count of what the layout doesn't show is ignored: the usual limit", async () => {
    await draw("table=projects&view=v1&cards=2");
    const scroller = await scrollerOf();
    await waitFor(() => expect(shown(scroller)).toBe(EMBED_MAX_HEIGHT));
  });
});

// `rest=more`: only the counted rows or cards are drawn, and a line beneath shows the rest.
describe("an embed cut to its count", () => {
  const draw = (fragment: string) => render(inDocument(<TableEmbed address={`../tables/projects.table#${fragment}&embed=1`} baseDir={docs} within={root} />));
  const scrollerOf = async () => {
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    await waitFor(() => expect(embed.getFirstChild()?.getFirstChild()).toBeInstanceOf(Gtk.ScrolledWindow));
    return embed.getFirstChild()!.getFirstChild() as Gtk.ScrolledWindow;
  };
  const nothingToScroll = (scroller: Gtk.ScrolledWindow) => expect(scroller.getVadjustment().getUpper()).toBe(scroller.getVadjustment().getPageSize());

  it("a table draws only its first rows, says how many more, and shows them when asked", async () => {
    await draw("table=tasks&view=v1&rows=3&rest=more");
    const scroller = await scrollerOf();
    // Sorted by priority: these three, and not the fourth.
    for (const title of ["Land .table extension", "Markdown editor polish", "Wire RSD + StyleX"]) expect(await screen.findByText(title)).toBeDefined();
    expect(screen.queryByText("Settings panel")).toBeNull();
    expect(screen.queryByText("OG images")).toBeNull();
    await waitFor(() => nothingToScroll(scroller));
    const more = await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 5 more rows" });
    expect(more.getName()).toBe("table-embed-more");

    await userEvent.click(more);
    expect(await screen.findByText("OG images")).toBeDefined();
    expect(screen.queryByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 5 more rows" })).toBeNull();
  });

  it("a table with no more rows than its count has no line beneath", async () => {
    await draw("table=tasks&view=v1&rows=8&rest=more");
    expect(await screen.findByText("OG images")).toBeDefined();
    expect(screen.queryAllByName("table-embed-more")).toHaveLength(0);
  });

  it("a table cut to its rows still totals the whole view", async () => {
    // All deals: a count of titles and two sums, over eight rows.
    await render(inDocument(<TableEmbed address="../tables/crm.table#table=deals&view=all&rows=2&rest=more&embed=1" baseDir={docs} within={root} />));
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 6 more rows" })).toBeDefined();
    // The footer's count is of every row, not of the two drawn.
    expect((await screen.findAllByText("8")).length).toBeGreaterThan(0);
  });

  it("with rows left out, offers no place to add a row, nor an empty totals row, until the rest is shown", async () => {
    await draw("table=tasks&view=v1&rows=3&rest=more");
    const scroller = await scrollerOf();
    await screen.findByText("Wire RSD + StyleX");
    expect(screen.queryByText("+ New row")).toBeNull();
    // The frame ends with its third row: the header and its rule, three rows of 44 with theirs, and the frame's two borders.
    await waitFor(() => expect(scroller.getVadjustment().getUpper()).toBe(36 + 1 + 3 * 45 + 2));

    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 5 more rows" }));
    expect(await screen.findByText("+ New row")).toBeDefined();
  });

  it("with no rows left out, a cut table still offers a new row", async () => {
    await draw("table=tasks&view=v1&rows=8&rest=more");
    expect(await screen.findByText("+ New row")).toBeDefined();
  });

  it("a list draws only its first rows", async () => {
    await draw("table=projects&view=v7&rows=3&rest=more");
    const scroller = await scrollerOf();
    await screen.findByText("Workspace v1");
    await waitFor(() => {
      const rows = scroller.getFirstChild()!.getFirstChild()!;
      let n = 0;
      for (let row = rows.getFirstChild(); row; row = row.getNextSibling()) n++;
      expect(n).toBe(3);
      nothingToScroll(scroller);
    });
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 14 more rows" })).toBeDefined();
  });

  it("a board draws the first cards of each column, each column saying how many more it has and its whole count", async () => {
    await draw("table=tasks&view=v2&cards=1&rest=more");
    const scroller = await scrollerOf();
    await screen.findByText("Settings panel");
    await waitFor(() => {
      const columns = scroller.getFirstChild()!.getFirstChild()!;
      const cardsIn: number[] = [];
      for (let column = columns.getFirstChild(); column; column = column.getNextSibling()) {
        let n = 0;
        for (let child = column.getFirstChild(); child; child = child.getNextSibling()) if (child instanceof Gtk.Button) n++;
        cardsIn.push(n);
      }
      expect(cardsIn).toEqual([1, 1, 1]);
      nothingToScroll(scroller);
    });
    // todo 3, doing 3, done 2: two more, two more, one more.
    expect(screen.queryAllByName("board-column-more").map((label) => (label as Gtk.Label).getLabel())).toEqual(["+2 more", "+2 more", "+1 more"]);
    // A column's count is of all its cards.
    expect((await screen.findAllByText("3")).length).toBe(2);
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 5 more cards" })).toBeDefined();
  });

  it("a gallery draws only its first cards", async () => {
    await draw("table=projects&view=v6&cards=2&rest=more");
    await screen.findByText("Workspace v1");
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 15 more cards" })).toBeDefined();
    expect(screen.queryByText("iOS Pro launch")).toBeNull();
  });

  it("is as tall as what it draws, past the usual limit too, with nothing to scroll", async () => {
    const table = await draw("table=projects&view=v1&rows=12&rest=more");
    let scroller = await scrollerOf();
    await waitFor(() => {
      expect(scroller.getVadjustment().getPageSize()).toBeGreaterThan(36 + 12 * 45);
      nothingToScroll(scroller);
    });
    await table.unmount();

    // A list of all seventeen rows: taller than the limit, and whole.
    await draw("table=projects&view=v7&rows=17&rest=more");
    scroller = await scrollerOf();
    await screen.findByText("Workspace v1");
    await waitFor(() => {
      expect(scroller.getVadjustment().getPageSize()).toBeGreaterThan(EMBED_MAX_HEIGHT);
      nothingToScroll(scroller);
    });
  });

  it("rest=more with a count the layout doesn't show cuts nothing", async () => {
    await draw("table=tasks&view=v1&cards=2&rest=more");
    expect(await screen.findByText("OG images")).toBeDefined();
    expect(screen.queryAllByName("table-embed-more")).toHaveLength(0);
  });
});

// A view that scrolls sideways runs over the page's side margins to the window's edges (`gutter`).
describe("an embed in a page with margins", () => {
  const GUTTER = 32;
  // A page: its text, and so the embed, a margin in from the window's edges.
  const page = (address: string, gutter: number | "none" = GUTTER) => (
    <GtkWindow defaultWidth={1000} defaultHeight={700}>
      <GtkScrolledWindow name="page">
        <GtkBox orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.START} marginStart={GUTTER} marginEnd={GUTTER}>
          <TableEmbed address={address} baseDir={docs} within={root} {...(gutter === "none" ? {} : { gutter })} />
        </GtkBox>
      </GtkScrolledWindow>
    </GtkWindow>
  );
  const parts = async () => {
    const embed = (await screen.findAllByName("table-embed"))[0]!;
    await waitFor(() => expect(embed.getFirstChild()?.getFirstChild()).toBeInstanceOf(Gtk.ScrolledWindow));
    const scroller = embed.getFirstChild()!.getFirstChild() as Gtk.ScrolledWindow;
    // What the scroller holds: the table's frame, or the board's columns.
    const held = scroller.getFirstChild()!.getFirstChild()!;
    /** A widget's left and right, measured from the text's left edge (the embed's own). */
    const across = (widget: Gtk.Widget) => {
      const [, bounds] = widget.computeBounds(embed);
      return { left: Math.round(bounds.getX()), right: Math.round(bounds.getX() + bounds.getWidth()) };
    };
    return { embed, scroller, held, across };
  };
  const scrollTo = (scroller: Gtk.ScrolledWindow, value: number) =>
    act(() => {
      scroller.getHadjustment().setValue(value);
    });
  const DEALS = "../tables/crm.table#table=deals&view=all&rows=3&embed=1";
  const PIPELINE = "../tables/crm.table#table=deals&view=pipeline&cards=1&embed=1";

  it("a table's scroller reaches both edges of the window, and the table rests in line with the text", async () => {
    await render(page(DEALS));
    await screen.findByText("Atlas: 3-year renewal");
    const { embed, scroller, held, across } = await parts();
    await waitFor(() => {
      const text = embed.getWidth();
      expect(text).toBeGreaterThan(800);
      // A margin wider than the text on each side.
      expect(across(scroller)).toEqual({ left: -GUTTER, right: text + GUTTER });
      // The frame starts where the text does, and is wider than the window: there is something to scroll to.
      expect(across(held).left).toBe(0);
      expect(across(held).right).toBeGreaterThan(text + GUTTER);
    });
  });

  it("scrolled to its end, a table stops on the far margin", async () => {
    await render(page(DEALS));
    await screen.findByText("Atlas: 3-year renewal");
    const { embed, scroller, held, across } = await parts();
    await waitFor(() => expect(scroller.getHadjustment().getUpper()).toBeGreaterThan(scroller.getHadjustment().getPageSize()));
    await scrollTo(scroller, scroller.getHadjustment().getUpper());
    await waitFor(() => expect(across(held).right).toBe(embed.getWidth()));
    // And it began well to the left of the window by then.
    expect(across(held).left).toBeLessThan(-GUTTER);
  });

  it("a first column that stays put stays on the margin, with the page's ground over the margin beside it", async () => {
    await render(page(DEALS));
    const first = await screen.findByText("Atlas: 3-year renewal");
    const { scroller, across } = await parts();
    await waitFor(() => expect(scroller.getHadjustment().getUpper()).toBeGreaterThan(scroller.getHadjustment().getPageSize()));
    const atRest = across(first).left;
    expect(atRest).toBeGreaterThanOrEqual(0);
    expect(screen.queryAllByName("pinned-skirt").filter((skirt) => skirt.getVisible())).toHaveLength(0);

    await scrollTo(scroller, 300);
    // Where it was, to within the frame's own line; the next column has gone under it.
    await waitFor(() => expect(Math.abs(across(first).left - atRest)).toBeLessThanOrEqual(1));
    const skirts = screen.queryAllByName("pinned-skirt").filter((skirt) => skirt.getVisible());
    expect(skirts.length).toBeGreaterThan(3);
    // Each covers the margin, from the window's edge to the column.
    for (const skirt of skirts) {
      expect(across(skirt).left).toBeLessThanOrEqual(-GUTTER + 1);
      expect(skirt.getWidth()).toBe(GUTTER);
    }
  });

  it("a board's columns rest in line with the text, pass under the margin, and stop on the far margin", async () => {
    await render(page(PIPELINE));
    await screen.findByText("Fern: studio plan");
    const { embed, scroller, held, across } = await parts();
    const firstColumn = held.getFirstChild()!;
    await waitFor(() => {
      expect(across(scroller)).toEqual({ left: -GUTTER, right: embed.getWidth() + GUTTER });
      expect(across(firstColumn).left).toBe(0);
    });
    await scrollTo(scroller, 20);
    // In the margin now, and still drawn: the scroller is there too.
    await waitFor(() => expect(across(firstColumn).left).toBe(-20));
    await scrollTo(scroller, scroller.getHadjustment().getUpper());
    await waitFor(() => expect(across(held.getLastChild()!).right).toBe(embed.getWidth()));
  });

  it("with no margin given, is kept to the width it has", async () => {
    await render(page(DEALS, "none"));
    await screen.findByText("Atlas: 3-year renewal");
    const { embed, scroller, held, across } = await parts();
    await waitFor(() => {
      expect(embed.getWidth()).toBeGreaterThan(800);
      expect(across(scroller)).toEqual({ left: 0, right: embed.getWidth() });
      expect(across(held).left).toBe(0);
    });
  });
});

// A table of 50,000 rows or more, read through its bundle's index: drawn in the document, and its index
// shared with every other view of the file.
describe("a large table embedded in a document", () => {
  const big = () => {
    const tasks = join(root, "tables", "projects.table", "tables", "tasks");
    let rows = "";
    for (let i = 0; i < 50_000; i++) rows += `{"id":"b${i}","title":"Big ${i}","priority":${i}}\n`;
    writeFileSync(join(tasks, "rows", "0001.ndjson"), rows);
    return tasks;
  };
  const address = "../tables/projects.table#table=tasks&view=v1&rows=5&rest=more&embed=1";

  it("is drawn from its index: its first rows, cut to the link's count with the rest counted, and an edit written back", async () => {
    const tasks = big();
    await render(inDocument(<TableEmbed address={address} baseDir={docs} within={root} openIndex={openIndexHost} />));
    // Sorted by priority, from the index; the rest counted from every row.
    await waitFor(async () => expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 49,995 more rows" })).toBeDefined(), { timeout: 30_000 });
    await userEvent.click(await screen.findByText("Big 0"));
    const entry = (await screen.findByDisplayValue("Big 0")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Edited in a document, through the index");
    await userEvent.keyboard(entry, "{Enter}");
    await waitFor(() => expect(readFileSync(join(tasks, "rows", "0001.ndjson"), "utf8").split("\n")[0]).toContain("Edited in a document, through the index"), { timeout: 30_000 });
  }, 60_000);

  it("shares one index with the file opened beside it, and lets go of it when both have gone", async () => {
    big();
    const dir = join(root, "tables", "projects.table");
    const opened = await render(
      <GtkWindow defaultWidth={1000} defaultHeight={900}>
        <GtkBox orientation={Gtk.Orientation.VERTICAL}>
          <TableEmbed address={address} baseDir={docs} within={root} openIndex={openIndexHost} />
          <TableFile path={dir} at={{ address: `${dir}#table=tasks`, n: 1 }} openIndex={openIndexHost} />
        </GtkBox>
      </GtkWindow>,
    );
    await waitFor(async () => expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Show 49,995 more rows" })).toBeDefined(), { timeout: 30_000 });
    await waitFor(() => expect(indexHostUsers(dir)).toBe(2), { timeout: 30_000 });
    await opened.unmount();
    await waitFor(() => expect(indexHostUsers(dir)).toBe(0));
  }, 60_000);
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
    const before = readFileSync(join(tasksDir(), "rows", "0001.ndjson"), "utf8");
    await cleanup();
    expect(readFileSync(join(tasksDir(), "rows", "0001.ndjson"), "utf8")).toBe(before);
    expect(history()).toEqual([]);
  });

  it("keeps two embeds of the same file in step: an edit in one shows in the other (#514)", async () => {
    await render(
      inDocument(
        <>
          <TableEmbed address="../tables/projects.table#table=tasks&view=v1&embed=1" baseDir={docs} within={root} />
          <TableEmbed address="../tables/projects.table#table=tasks&view=v2&embed=1" baseDir={docs} within={root} />
        </>,
      ),
    );
    // In the table and on the board.
    await waitFor(async () => expect((await screen.findAllByText("Land .table extension")).length).toBe(2));
    const cells = (await screen.findAllByText("Land .table extension")).filter((w) => w.getMapped());
    await userEvent.click(cells[0]!);
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Changed in one");
    await userEvent.keyboard(entry, "{Enter}");
    // Both show it, and the file has it once.
    await waitFor(async () => expect((await screen.findAllByText("Changed in one")).length).toBe(2));
    expect(screen.queryAllByText("Land .table extension")).toHaveLength(0);
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Changed in one"));
  });

  it("keeps an edit made in the same moment the document lets go of the table", async () => {
    const first = await tasks();
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Committed as it closed");
    // The edit is committed and the view goes in one go, before React draws the edit.
    await act(() => {
      entry.emit("activate");
      void first.unmount();
    });
    await waitFor(async () => expect((await tasksOnDisk()).rows.find((r) => r.id === "t1")?.title).toBe("Committed as it closed"));
  });

  it("a file read just after an edit was let go of reads the edit", async () => {
    const first = await tasks();
    await userEvent.click(await screen.findByText("Land .table extension"));
    const entry = (await screen.findByDisplayValue("Land .table extension")) as Gtk.Entry;
    await userEvent.clear(entry);
    await userEvent.type(entry, "Read straight after");
    await userEvent.keyboard(entry, "{Enter}");
    await first.unmount();
    // At once, as switching from a document to the table opened as a document does.
    const read = await readEmbed({ address: "../tables/projects.table#table=tasks&embed=1", baseDir: docs, within: root });
    expect(read.kind === "shown" && read.library.tables[read.key]!.rows.find((r) => r.id === "t1")?.title).toBe("Read straight after");
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
