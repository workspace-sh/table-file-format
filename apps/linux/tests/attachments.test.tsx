import * as Gtk from "@gtkx/gi/gtk";
import { cleanup, render, screen, waitFor } from "@gtkx/testing";
import { attachmentPath, showView } from "@workspace.sh/table-app";
import { loadLibrary } from "@workspace.sh/table-app/node";
import type { ParsedTable } from "@workspace.sh/table-core";
import { AttachmentsProvider, DisplaySettingsProvider, GalleryView } from "@workspace.sh/table-gtk";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../src/fixtures.js";

afterEach(async () => {
  await cleanup();
});

describe("attachments on Linux", () => {
  it("a gallery leads with each row's image, read from its table's attachments folder", async () => {
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    const companies: ParsedTable = library.tables["crm/companies"]!;
    const shown = showView(library.tables, "crm/companies", companies.views.find((v) => v.id === "logos")!);
    await render(
      <DisplaySettingsProvider value={{}}>
        <AttachmentsProvider value={(file) => attachmentPath(companies, file)}>
          <GalleryView view={shown.view} rows={shown.rows} schema={companies.schema} />
        </AttachmentsProvider>
      </DisplaySettingsProvider>,
    );
    await waitFor(async () => {
      const pictures = (await screen.findAllByRole(Gtk.AccessibleRole.IMG)).filter((w) => w instanceof Gtk.Picture) as Gtk.Picture[];
      expect(pictures.map((p) => p.getAlternativeText()).sort()).toEqual(companies.rows.map((r) => r.logo).sort());
      expect(pictures.every((p) => p.getPaintable() !== null)).toBe(true);
    });
  });

  it("without a way to find the files, a gallery shows the file names instead", async () => {
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    const companies = library.tables["crm/companies"]!;
    const shown = showView(library.tables, "crm/companies", companies.views.find((v) => v.id === "logos")!);
    await render(
      <DisplaySettingsProvider value={{}}>
        <GalleryView view={shown.view} rows={shown.rows} schema={companies.schema} />
      </DisplaySettingsProvider>,
    );
    expect(await screen.findByText("co-atlas.svg")).toBeDefined();
  });

  it("a missing file, or one that isn't an image, is shown by name, not drawn", async () => {
    const library = await loadLibrary([join(fixturesDir()!, "crm.table")]);
    const companies = library.tables["crm/companies"]!;
    const rows = companies.rows.slice(0, 2).map((r, i) => ({ ...r, logo: i === 0 ? "gone.png" : "contract.pdf" }));
    const shown = showView({ ...library.tables, "crm/companies": { ...companies, rows } }, "crm/companies", companies.views.find((v) => v.id === "logos")!);
    await render(
      <DisplaySettingsProvider value={{}}>
        <AttachmentsProvider value={(file) => attachmentPath(companies, file)}>
          <GalleryView view={shown.view} rows={shown.rows} schema={companies.schema} />
        </AttachmentsProvider>
      </DisplaySettingsProvider>,
    );
    expect(await screen.findByText("gone.png")).toBeDefined();
    expect(await screen.findByText("contract.pdf")).toBeDefined();
    expect(screen.queryAllByRole(Gtk.AccessibleRole.IMG).filter((w) => w instanceof Gtk.Picture)).toHaveLength(0);
  });
});
