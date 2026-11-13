import * as Adw from "@gtkx/gi/adw";
import * as Gtk from "@gtkx/gi/gtk";
import { GtkWindow } from "@gtkx/jsx/gtk";
import { cleanup, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { TableFile } from "@workspace.sh/table-gtk/embed";
import { parseTable } from "@workspace.sh/table-core/parser";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

// A .table opened as a document (Workspace's Linux app shows one this way): a cell's
// file is added, replaced and taken out, as on macOS and iOS, and a file no row names
// any more is removed once the table closes.

let root: string;
let bundle: string;
const companies = () => join(bundle, "tables", "companies");
const attachments = () => join(companies(), "attachments");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "table-file-attach-"));
  bundle = join(root, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(root, { recursive: true, force: true });
});

// Customers lists every field, the logo included.
const open = (chooseFile: () => Promise<string | null>) =>
  render(
    <GtkWindow defaultWidth={1200} defaultHeight={700}>
      <TableFile path={bundle} at={{ address: `${bundle}#table=companies&view=puifj4tbwywzp`, n: 1 }} chooseFile={chooseFile} />
    </GtkWindow>,
  );

const logos = async () => (await parseTable(companies())).rows.map((r) => r.logo);

/** The Choose File button in the cell that names `fileName`. */
async function buttonFor(fileName: string): Promise<Gtk.Button> {
  let found: Gtk.Button | undefined;
  await waitFor(async () => {
    for (const label of await screen.findAllByText(fileName)) {
      for (let w: Gtk.Widget | null = label; w && !found; w = w.getParent()) {
        const last = w.getLastChild();
        if (last instanceof Gtk.Button && last.getTooltipText() === "Choose File") found = last;
      }
    }
    expect(found).toBeDefined();
  });
  return found!;
}

/** The question a filled cell asks, once it's asked. */
async function question(heading: string): Promise<Adw.AlertDialog> {
  let asked: Adw.AlertDialog | undefined;
  await waitFor(async () => {
    asked = (await screen.findAllByRole(Gtk.AccessibleRole.ALERT_DIALOG)).find((w) => w instanceof Adw.AlertDialog) as Adw.AlertDialog | undefined;
    expect(asked?.getHeading()).toBe(heading);
  });
  return asked!;
}

const svg = (name: string) => {
  const path = join(root, name);
  writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return path;
};

describe("a cell's file, in a .table opened as a document", () => {
  it("is drawn from the table's attachments", async () => {
    await open(async () => null);
    await waitFor(async () => {
      const pictures = (await screen.findAllByRole(Gtk.AccessibleRole.IMG)).filter((w) => w instanceof Gtk.Picture && (w as Gtk.Picture).getPaintable() !== null);
      expect(pictures.length).toBeGreaterThan(0);
    });
  });

  it("an empty cell asks for a file, copies it in and names it", async () => {
    const empty = (await logos()).findIndex((l) => !l);
    expect(empty).toBeGreaterThanOrEqual(0);
    await open(async () => svg("new-logo.svg"));
    const named = (await logos()).filter(Boolean).length;
    // An empty cell's button, by elimination: the one whose cell names no file.
    const buttons = await screen.findAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose File" });
    expect(buttons.length).toBeGreaterThan(named);
    for (const b of buttons) {
      await userEvent.click(b);
      if ((await logos()).includes("new-logo.svg")) break;
      // A filled cell asked instead: left as it is.
      const asked = screen.queryAllByRole(Gtk.AccessibleRole.ALERT_DIALOG).find((w) => w instanceof Adw.AlertDialog) as Adw.AlertDialog | undefined;
      asked?.emit("response", "cancel");
      await new Promise((r) => setTimeout(r, 200));
    }
    await waitFor(async () => expect((await logos()).filter((l) => l === "new-logo.svg")).toHaveLength(1));
    expect(readFileSync(join(attachments(), "new-logo.svg"), "utf8")).toContain("<svg");
  });

  it("a filled cell's file is replaced, and the old one removed once the table closes", async () => {
    const first = (await logos()).find((l): l is string => typeof l === "string" && l !== "")!;
    const { unmount } = await open(async () => svg("replacement.svg"));
    await userEvent.click(await buttonFor(first));
    (await question(first)).emit("response", "replace");
    await waitFor(async () => expect((await logos()).includes("replacement.svg")).toBe(true));
    expect((await logos()).includes(first)).toBe(false);
    // Kept while open, so undo brings it back with its file.
    expect(existsSync(join(attachments(), first))).toBe(true);
    await unmount();
    await waitFor(() => expect(existsSync(join(attachments(), first))).toBe(false));
    expect(existsSync(join(attachments(), "replacement.svg"))).toBe(true);
  });

  it("a filled cell's file is taken out, and Cancel leaves it", async () => {
    const first = (await logos()).find((l): l is string => typeof l === "string" && l !== "")!;
    await open(async () => null);
    await userEvent.click(await buttonFor(first));
    (await question(first)).emit("response", "cancel");
    await new Promise((r) => setTimeout(r, 300));
    expect((await logos()).includes(first)).toBe(true);

    await userEvent.click(await buttonFor(first));
    (await question(first)).emit("response", "remove");
    await waitFor(async () => expect((await logos()).includes(first)).toBe(false));
  });

  it("a file in a table to look at only can't be chosen", async () => {
    await render(
      <GtkWindow defaultWidth={1200} defaultHeight={700}>
        <TableFile path={bundle} readOnly at={{ address: `${bundle}#table=companies&view=puifj4tbwywzp`, n: 1 }} chooseFile={async () => join(root, "x")} />
      </GtkWindow>,
    );
    await screen.findAllByName("table-file");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryAllByRole(Gtk.AccessibleRole.BUTTON, { name: "Choose File" })).toHaveLength(0);
  });
});
