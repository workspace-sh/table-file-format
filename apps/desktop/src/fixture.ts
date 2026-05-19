/**
 * Inline fixture for the mobile app.
 *
 * Unlike `apps/web/src/loadFixture.ts` (which uses Vite's import.meta.glob
 * to load the on-disk `fixtures/projects.table/` directory at build time),
 * the mobile app has no equivalent Metro primitive for loading arbitrary
 * non-JS files from outside the package. For the spike we inline the
 * canonical fixture rows here. A future iteration could:
 *   - bundle the fixture via metro-config asset extensions, OR
 *   - generate a TS file from the on-disk fixture at build time
 */
import type { ParsedTable } from "@workspace/table-core";

export const fixture: ParsedTable = {
  path: "fixtures/projects.table",
  schema: {
    fields: [
      { name: "title", type: "string", constraints: { required: true } },
      {
        name: "status",
        type: "string",
        constraints: { enum: ["planning", "active", "on-hold", "done"] },
      },
      { name: "owner", type: "string" },
      { name: "budget", type: "number" },
      { name: "launched", type: "date" },
      { name: "summary", type: "string", format: "markdown" },
    ],
    primaryKey: ["title"],
    "schema-version": 1,
  },
  rows: [
    {
      id: "p1",
      title: "Workspace v1",
      status: "active",
      owner: "leslie",
      budget: 80000,
      launched: "2026-01-15",
      summary: "Local-first markdown app for information workers",
    },
    {
      id: "p2",
      title: "Table file format spike",
      status: "done",
      owner: "leslie",
      budget: 0,
      launched: "2026-04-20",
      summary: "Open .table format research",
    },
    {
      id: "p3",
      title: "iOS Pro launch",
      status: "planning",
      owner: "leslie",
      budget: 25000,
      summary: "Premium tier on the App Store",
    },
    {
      id: "p4",
      title: "Web companion app",
      status: "planning",
      owner: "claude",
      budget: 15000,
      summary: "Web read-only viewer",
    },
    {
      id: "p5",
      title: "Sync engine",
      status: "on-hold",
      owner: "claude",
      budget: 40000,
      summary: "P2P sync between devices",
    },
    {
      id: "p6",
      title: "Brand redesign",
      status: "done",
      owner: "sam",
      budget: 12000,
      launched: "2026-03-01",
      summary: "Visual identity refresh",
    },
    {
      id: "p7",
      title: "Docs site",
      status: "active",
      owner: "sam",
      budget: 5000,
      launched: "2026-04-01",
      summary: "Public-facing documentation",
    },
  ],
  views: [
    {
      id: "v1",
      name: "All projects",
      layout: "table",
      fields: ["title", "status", "owner", "launched"],
    },
  ],
  meta: {
    format: "table",
    formatVersion: 1,
    title: "Projects",
    generator: "table-file-format spike fixture",
  },
};
