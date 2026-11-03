import * as Gtk from "@gtkx/gi/gtk";
import { GtkBox, GtkScrolledWindow, GtkWindow } from "@gtkx/jsx/gtk";
import { cleanup, render, screen, waitFor } from "@gtkx/testing";
import { TableEmbed } from "@workspace.sh/table-gtk/embed";
import type { EmbedCases } from "@workspace.sh/table-app";
import { openIndexHost } from "@workspace.sh/table-app/node";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

// The embed cases every platform checks (workspace-fixtures, Fixtures/markdown/*.cases.json),
// each drawn by the GTK drop-in as a document in Fixtures/markdown would draw it. The fixtures
// are copied, so nothing a case does reaches them. A plain link (`"link": true`) is the
// Markdown renderer's to tell apart, so it isn't drawn here.
const fixtures = dirname(realpathSync(fixturesDir()!));
const markdown = join(fixtures, "markdown");
const documents = readdirSync(markdown)
  .filter((name) => name.endsWith(".cases.json"))
  .map((name) => JSON.parse(readFileSync(join(markdown, name), "utf8")) as EmbedCases);

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "embed-cases-"));
  cpSync(markdown, join(root, "markdown"), { recursive: true });
  // The million-row table isn't linked from any case, and is 40 MB.
  cpSync(join(fixtures, "table"), join(root, "table"), { recursive: true, filter: (from) => !from.endsWith("big-1000000.table") });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(async () => {
  await cleanup();
});

const inDocument = (embed: React.ReactNode) => (
  <GtkWindow defaultWidth={720} defaultHeight={900}>
    <GtkScrolledWindow>
      <GtkBox orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.START}>
        {embed}
      </GtkBox>
    </GtkScrolledWindow>
  </GtkWindow>
);

const large = (address: string) => address.includes("/large/");

for (const { document, cases } of documents) {
  describe(document, () => {
    for (const c of cases) {
      const e = c.expect;
      if ("link" in e) continue;
      it(c.address, { timeout: large(c.address) ? 60_000 : 15_000 }, async () => {
        await render(inDocument(<TableEmbed address={c.address} baseDir={join(root, "markdown")} within={root} openIndex={openIndexHost} />));
        const timeout = large(c.address) ? 45_000 : 5_000;
        const shows = (seen: () => unknown[]) => waitFor(() => expect(seen().length).toBeGreaterThan(0), { timeout });
        if ("problem" in e) {
          await shows(() => screen.queryAllByText(e.problem));
          return;
        }
        for (const title of e.first) await shows(() => screen.queryAllByText(title));
        if (e.more) await shows(() => screen.queryAllByRole(Gtk.AccessibleRole.BUTTON, { name: e.more }));
        else expect(screen.queryByRole(Gtk.AccessibleRole.BUTTON, { name: /^Show [\d,]+ more (row|card)s?$/ })).toBeNull();
        for (const group of e.groups ?? []) {
          const label = new RegExp(`(^|·\\s*)${group.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
          await shows(() => screen.queryAllByText(label));
        }
      });
    }
  });
}
