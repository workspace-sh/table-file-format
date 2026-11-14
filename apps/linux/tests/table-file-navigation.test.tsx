import { GtkWindow } from "@gtkx/jsx/gtk";
import { cleanup, render, waitFor } from "@gtkx/testing";
import { TableFile, type TableNavigation } from "@workspace.sh/table-gtk/embed";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

// A .table opened as a document tells the app around it where its own views can go
// Back and Forward, for the window's one pair of arrows (Workspace's Linux app).

let root: string;
let bundle: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "table-file-navigation-"));
  bundle = join(root, "crm.table");
  cpSync(join(fixturesDir()!, "crm.table"), bundle, { recursive: true });
});

afterEach(async () => {
  await cleanup();
  rmSync(root, { recursive: true, force: true });
});

const view = (id: string) => `${bundle}#table=companies&view=${id}`;

describe("a .table opened as a document", () => {
  it("says where its views can go Back and Forward, and goes", async () => {
    let told: TableNavigation | null | undefined;
    const shown = (at?: { address: string; n: number }) => (
      <GtkWindow defaultWidth={1200} defaultHeight={700}>
        <TableFile path={bundle} {...(at ? { at } : {})} onNavigation={(n) => (told = n)} />
      </GtkWindow>
    );
    // The address it opens at is where its history starts.
    const { rerender, unmount } = await render(shown({ address: view("puifj4tbwywzp"), n: 1 }));
    await waitFor(() => expect(told).toBeDefined());
    await new Promise((r) => setTimeout(r, 300));
    expect(told!.canGoBack).toBe(false);

    // One asked for later is a step.
    await rerender(shown({ address: view("hnmryzi51j6jz"), n: 2 }));
    await waitFor(() => expect(told?.canGoBack).toBe(true));
    expect(told!.canGoForward).toBe(false);

    told!.goBack();
    await waitFor(() => expect(told?.canGoForward).toBe(true));

    told!.goForward();
    await waitFor(() => expect(told?.canGoForward).toBe(false));
    expect(told!.canGoBack).toBe(true);

    await unmount();
    expect(told).toBeNull();
  });
});
